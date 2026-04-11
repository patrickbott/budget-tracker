/**
 * Post-ingest recurring-series detection.
 *
 * After `applyRulesToEntries` and `detectAndPersistTransferCandidates`
 * have run, the sync worker calls this helper to scan the family's
 * recent history for repeating (merchant, amount, cadence) patterns —
 * subscriptions, rent, salary deposits, etc. The result is surfaced
 * both in the sync run telemetry (so daily syncs report a count) and
 * via the same helper from the `/recurring` page (so the user sees
 * candidates without having to wait for a sync).
 *
 * Design:
 *   1. Load every entry from the last 180 days for the family,
 *      joined with its account-side `entry_line` (the leg with a
 *      non-null `account_id`). The account-side leg carries the
 *      signed amount the detector groups by.
 *   2. Reshape into the `RecurringEntryInput` shape and call
 *      `detectRecurringCandidates` from `@budget-tracker/core/recurring`
 *      (a pure function that's already unit-tested in core).
 *   3. Return the candidate array. Nothing is persisted: candidates
 *      are ephemeral and recomputed on demand. The persistent
 *      `recurring` table is reserved for user-confirmed series, which
 *      the `/recurring` page promotes via a separate insert.
 *
 * Why no persistence: detection is cheap, the `recurring_candidate`
 * table doesn't exist (and shouldn't — confirmed series have their
 * own table), and a candidate that disappears between syncs because
 * the underlying gap pattern changed is the right behavior, not a
 * bug to paper over with stale rows.
 *
 * Transactionality: like `applyRulesToEntries` and
 * `detectAndPersistTransferCandidates`, this helper does not open
 * its own DB connection. The caller (sync-connection worker, or the
 * /recurring server action) has already opened one inside
 * `withFamilyContext`, which sets the Postgres session variables the
 * RLS policies depend on. Every query in this file is therefore
 * family-scoped by default.
 */
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { entry, entryLine } from '@budget-tracker/db/schema';
import type { DatabaseTx } from '@budget-tracker/db/client';
import {
  detectRecurringCandidates,
  type RecurringCandidate,
  type RecurringEntryInput,
} from '@budget-tracker/core/recurring';

export interface DetectRecurringResult {
  candidates: RecurringCandidate[];
}

const HISTORY_WINDOW_DAYS = 180;

/**
 * Serialize a JS `Date` (or already-stringified date) into the ISO
 * `YYYY-MM-DD` form the recurring detector's date math expects.
 */
function toIsoDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/**
 * Detect recurring candidates for the given family by scanning the
 * last 180 days of entries.
 *
 * Pure-read: no rows are inserted, updated, or deleted. Safe to call
 * from request handlers as well as background workers.
 */
export async function detectRecurringCandidatesForFamily(
  tx: DatabaseTx,
  familyId: string,
): Promise<DetectRecurringResult> {
  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - HISTORY_WINDOW_DAYS);
  windowStart.setUTCHours(0, 0, 0, 0);

  const rows = await tx
    .select({
      entryId: entry.id,
      description: entry.description,
      entryDate: entry.entryDate,
      amount: entryLine.amount,
    })
    .from(entry)
    .innerJoin(
      entryLine,
      and(eq(entryLine.entryId, entry.id), isNotNull(entryLine.accountId)),
    )
    .where(and(eq(entry.familyId, familyId), gte(entry.entryDate, windowStart)));

  if (rows.length === 0) {
    return { candidates: [] };
  }

  const detectable: RecurringEntryInput[] = rows.map((row) => ({
    entryId: row.entryId,
    amount: row.amount,
    entryDate: toIsoDate(row.entryDate),
    description: row.description,
  }));

  const candidates = detectRecurringCandidates(detectable);
  return { candidates };
}
