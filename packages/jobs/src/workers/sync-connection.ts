import Decimal from 'decimal.js';
import { eq } from 'drizzle-orm';
import { connection } from '@budget-tracker/db/schema';
import { createDb, withFamilyContext } from '@budget-tracker/db/client';
import { validateEntryLines } from '@budget-tracker/core/entries';
// @ts-expect-error pending @budget-tracker/simplefin PR merge
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
 * Build balanced entry + entry_line pairs from a SimpleFIN transaction.
 *
 * Routes through `@budget-tracker/core/entries/validateEntryLines` to
 * enforce the double-entry invariant before persistence, as required by
 * CLAUDE.md. Uses `decimal.js` for amount negation — never string ops.
 *
 * After Instance A merges, replace this with the real
 * `buildEntriesForSimpleFinTransactions` from `@budget-tracker/core`.
 */
function buildEntryForTransaction(
  txn: {
    id: string;
    posted: number;
    amount: string;
    description: string;
    pending?: boolean;
    transacted_at?: number;
  },
  opts: {
    familyId: string;
    accountId: string;
    simplefinAccountId: string;
    uncategorizedCategoryId: string;
  },
): BuiltEntry {
  const amount = new Decimal(txn.amount);
  const negatedAmount = amount.negated();

  // Pre-validate the double-entry invariant via packages/core/entries/.
  const validation = validateEntryLines([
    { amount: amount.toFixed(4) },
    { amount: negatedAmount.toFixed(4) },
  ]);
  if (!validation.ok) {
    throw new Error(
      `Double-entry invariant violation: lines sum to ${validation.sum} for txn ${txn.id}`,
    );
  }

  // Prefer transacted_at (actual transaction date) over posted (clearing date).
  const entryDateUnix = txn.transacted_at ?? txn.posted;

  return {
    entry: {
      familyId: opts.familyId,
      entryDate: new Date(entryDateUnix * 1000),
      entryableType: 'transaction',
      description: txn.description,
      source: 'simplefin',
      isPending: txn.pending ?? false,
    },
    dedupKey: {
      externalId: txn.id,
      externalAccountId: opts.simplefinAccountId,
    },
    lines: [
      {
        accountId: opts.accountId,
        categoryId: null,
        amount: amount.toFixed(4),
      },
      {
        accountId: null,
        categoryId: opts.uncategorizedCategoryId,
        amount: negatedAmount.toFixed(4),
      },
    ],
  };
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
        windowStart = new Date(now.getTime() - NINETY_DAYS_MS);
      }

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
          totalSkipped += sfAccount.transactions.length;
          continue;
        }

        // Build entries through the core-compatible path.
        const built: BuiltEntry[] = sfAccount.transactions.map((txn) =>
          buildEntryForTransaction(txn, {
            familyId: payload.familyId,
            accountId: internalAccountId,
            simplefinAccountId: sfAccount.id,
            uncategorizedCategoryId: uncategorizedId,
          }),
        );

        const result = await upsertEntriesForSimpleFin(tx, built);
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
