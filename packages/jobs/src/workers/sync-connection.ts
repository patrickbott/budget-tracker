import { eq } from 'drizzle-orm';
import { connection } from '@budget-tracker/db/schema';
import { createDb, withFamilyContext } from '@budget-tracker/db/client';
import { decryptAccessUrl, fetchAccountSet } from '@budget-tracker/simplefin';

import type { SyncConnectionPayload } from '../job-names.ts';
import { findAccountBySimpleFinId } from '../ingest/account-lookup.ts';
import { findOrCreateUncategorized } from '../ingest/category-lookup.ts';
import {
  upsertEntriesForSimpleFin,
  type BuiltEntry,
} from '../ingest/upsert-entries.ts';
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

/**
 * Resolve a DATABASE_URL for the worker. Worker runs outside Next.js so
 * there's no build-phase fallback — just require the env var.
 */
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
      const accessUrl = decryptAccessUrl(conn.accessUrlEncrypted) as string;

      // 3. Compute trailing window.
      const now = new Date();
      const trailingDays = getTrailingWindowDays();
      const trailingMs = trailingDays * 24 * 60 * 60 * 1000;

      let windowStart: Date;
      if (conn.lastSyncedAt) {
        windowStart = new Date(conn.lastSyncedAt.getTime() - trailingMs);
      } else {
        // First sync: go back 90 days.
        windowStart = new Date(now.getTime() - NINETY_DAYS_MS);
      }

      // Clamp to 90 days max.
      const earliestAllowed = new Date(now.getTime() - NINETY_DAYS_MS);
      if (windowStart < earliestAllowed) {
        windowStart = earliestAllowed;
      }

      // 4. Fetch from SimpleFIN.
      const accountSet = (await fetchAccountSet(accessUrl, {
        startDate: windowStart,
        endDate: now,
      })) as {
        accounts: Array<{
          id: string;
          name: string;
          balance: string;
          currency: string;
          transactions: Array<{
            id: string;
            posted: number;
            amount: string;
            description: string;
            pending?: boolean;
            transacted_at?: number;
          }>;
        }>;
        errors: Array<{ code: string; message: string }>;
        raw: string;
      };

      const errlist = accountSet.errors.map(
        (e) => `${e.code}: ${e.message}`,
      );

      // 5. Find or create the Uncategorized category.
      const uncategorizedId = await findOrCreateUncategorized(
        tx,
        payload.familyId,
      );

      // 6. Process each account.
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalSkipped = 0;

      for (const sfAccount of accountSet.accounts) {
        const internalAccountId = await findAccountBySimpleFinId(
          tx,
          sfAccount.id,
        );

        if (!internalAccountId) {
          // No mapping — skip all transactions for this account.
          totalSkipped += sfAccount.transactions.length;
          continue;
        }

        // Build entry + line pairs for each transaction.
        const built: BuiltEntry[] = sfAccount.transactions.map((txn) => {
          const isNegative = txn.amount.startsWith('-');
          const absAmount = isNegative
            ? txn.amount.slice(1)
            : txn.amount;

          return {
            entry: {
              familyId: payload.familyId,
              entryDate: new Date(txn.posted * 1000),
              entryableType: 'transaction' as const,
              description: txn.description,
              source: 'simplefin' as const,
              isPending: txn.pending ?? false,
              externalId: txn.id,
              externalAccountId: sfAccount.id,
            },
            lines: [
              {
                // Asset/liability side: money enters or leaves the account.
                // SimpleFIN: negative = debit (money left the account).
                accountId: internalAccountId,
                categoryId: null,
                amount: txn.amount,
                memo: null,
              },
              {
                // Category side: opposite sign.
                accountId: null,
                categoryId: uncategorizedId,
                amount: isNegative ? absAmount : `-${txn.amount}`,
                memo: null,
              },
            ],
          };
        });

        const result = await upsertEntriesForSimpleFin(
          tx,
          built,
          payload.familyId,
        );
        totalCreated += result.created;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
      }

      // 7. Write sync run.
      const syncRunId = await writeSyncRun(tx, {
        connectionId: payload.connectionId,
        familyId: payload.familyId,
        requestRangeStart: windowStart,
        requestRangeEnd: now,
        rawResponseJson: accountSet.raw,
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
