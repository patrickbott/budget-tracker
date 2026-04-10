import { eq } from 'drizzle-orm';
import { account, connection } from '@budget-tracker/db/schema';
import { createDb, withFamilyContext } from '@budget-tracker/db/client';
import { buildEntriesForSimpleFinTransactions } from '@budget-tracker/core/entries';
import { decryptAccessUrl, fetchAccountSet } from '@budget-tracker/simplefin';

import type { SyncConnectionPayload } from '../job-names.ts';
import { findOrCreateAccountBySimpleFinId } from '../ingest/account-lookup.ts';
import { findOrCreateUncategorized } from '../ingest/category-lookup.ts';
import { upsertEntriesForSimpleFin } from '../ingest/upsert-entries.ts';
import { writeSyncRun } from '../ingest/write-sync-run.ts';

export interface SyncConnectionResult {
  syncRunId: string;
  transactionsCreated: number;
  transactionsUpdated: number;
  transactionsSkipped: number;
  errlist: string[];
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function getTrailingWindowDays(): number {
  const envVal = process.env.SIMPLEFIN_TRAILING_WINDOW_DAYS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 7;
}

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

let _db: ReturnType<typeof createDb> | undefined;
function getDb() {
  if (!_db) _db = createDb(getDatabaseUrl());
  return _db.db;
}

/**
 * Core sync worker. Pulls transactions from SimpleFIN for a single
 * connection, deduplicates, and upserts entries with balanced
 * double-entry lines.
 *
 * This is a plain async function — pg-boss registration happens in
 * boss.ts. Testable without starting pg-boss.
 */
export async function syncConnection(
  payload: SyncConnectionPayload,
): Promise<SyncConnectionResult> {
  const db = getDb();

  return withFamilyContext(
    db,
    payload.familyId,
    payload.userId,
    async (tx) => {
      // 1. Load connection (RLS scopes to family).
      const [conn] = await tx
        .select()
        .from(connection)
        .where(eq(connection.id, payload.connectionId))
        .limit(1);

      if (!conn) {
        throw new Error(`Connection ${payload.connectionId} not found`);
      }

      // 2. Decrypt access URL.
      const accessUrl = decryptAccessUrl(conn.accessUrlEncrypted);

      // 3. Compute trailing window.
      const now = new Date();
      const trailingDays = getTrailingWindowDays();
      const trailingMs = trailingDays * 24 * 60 * 60 * 1000;

      let windowStart: Date;
      if (conn.lastSyncedAt) {
        windowStart = new Date(conn.lastSyncedAt.getTime() - trailingMs);
      } else {
        windowStart = new Date(now.getTime() - NINETY_DAYS_MS);
      }

      const earliestAllowed = new Date(now.getTime() - NINETY_DAYS_MS);
      if (windowStart < earliestAllowed) {
        windowStart = earliestAllowed;
      }

      // 4. Fetch from SimpleFIN.
      const accountSet = await fetchAccountSet(accessUrl, {
        startDate: windowStart,
        endDate: now,
      });

      const errlist = accountSet.errors.map(
        (e) => `${e.code}: ${e.message}`,
      );

      // 5. Find or create the Uncategorized category.
      const uncategorizedId = await findOrCreateUncategorized(
        tx,
        payload.familyId,
      );

      // 6. Process each account via core's canonical entry builder.
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalSkipped = 0;

      for (const sfAccount of accountSet.accounts) {
        // Auto-create account if this is a new SimpleFIN account we
        // haven't seen before.
        const internalAccountId = await findOrCreateAccountBySimpleFinId(tx, {
          simplefinId: sfAccount.simplefinId,
          name: sfAccount.name,
          currency: sfAccount.currency,
          balance: sfAccount.balance,
          balanceDate: sfAccount.balanceDate,
          familyId: payload.familyId,
          connectionId: payload.connectionId,
        });

        // SimpleFIN's parsed types already match core's BuildEntriesInput
        // shape (Decimal amounts, Date objects, simplefinId field names).
        const { built, skipped } = buildEntriesForSimpleFinTransactions({
          transactions: sfAccount.transactions,
          accountId: internalAccountId,
          simplefinAccountId: sfAccount.simplefinId,
          familyId: payload.familyId,
          uncategorizedCategoryId: uncategorizedId,
        });

        totalSkipped += skipped.length;

        const result = await upsertEntriesForSimpleFin(tx, built);
        totalCreated += result.created;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;

        // Update account balance from SimpleFIN snapshot. Only update if
        // the SimpleFIN balance date is newer than what we have stored
        // (or if we have no stored date yet).
        const [currentAccount] = await tx
          .select({ balanceAsOf: account.balanceAsOf })
          .from(account)
          .where(eq(account.id, internalAccountId))
          .limit(1);

        const shouldUpdate =
          !currentAccount?.balanceAsOf ||
          sfAccount.balanceDate > currentAccount.balanceAsOf;

        if (shouldUpdate) {
          await tx
            .update(account)
            .set({
              balance: sfAccount.balance.toFixed(4),
              balanceAsOf: sfAccount.balanceDate,
              updatedAt: now,
            })
            .where(eq(account.id, internalAccountId));
        }
      }

      // 7. Write sync run. Serialize the parsed account set for the audit log
      // (the raw HTTP response is not preserved through the parse pipeline).
      const syncRunId = await writeSyncRun(tx, {
        connectionId: payload.connectionId,
        familyId: payload.familyId,
        requestRangeStart: windowStart,
        requestRangeEnd: now,
        rawResponseJson: JSON.stringify(accountSet),
        errlist,
        status: errlist.length > 0 ? 'failed' : 'success',
        transactionsCreated: totalCreated,
        transactionsUpdated: totalUpdated,
      });

      // 8. Update connection status.
      await tx
        .update(connection)
        .set({
          lastSyncedAt: now,
          lastError: errlist.length > 0 ? errlist[0]! : null,
          lastErrlist: errlist.length > 0 ? errlist : null,
          status: errlist.length > 0 ? 'needs_reauth' : 'active',
          updatedAt: now,
        })
        .where(eq(connection.id, payload.connectionId));

      return {
        syncRunId,
        transactionsCreated: totalCreated,
        transactionsUpdated: totalUpdated,
        transactionsSkipped: totalSkipped,
        errlist,
      };
    },
  );
}
