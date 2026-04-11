/**
 * Post-ingest transfer candidate detection.
 *
 * After `applyRulesToEntries` runs, the sync worker calls this helper to
 * sweep the family's recent entries for opposite-sign pairs across owned
 * accounts that look like they might be a transfer between two of the
 * user's own accounts. Matches are persisted into `transfer_candidate`
 * with `status='pending'`; the user confirms or dismisses each one from
 * the transactions UI.
 *
 * The heuristic itself lives in `@budget-tracker/core/transfers`. This
 * helper is the adapter layer: it loads the eligible entries, shapes them
 * for the core detector, and persists the returned candidates.
 *
 * Detection window: 14 days. Long enough to catch transfers where one
 * leg posts a day or two after the other; short enough that the
 * cross-join the detector runs stays small.
 *
 * Idempotency: every sync re-runs detection, and the unique
 * `(entry_a_id, entry_b_id)` index on `transfer_candidate` (created in
 * migration 0004) guarantees that pairs we've already flagged aren't
 * re-inserted. We rely on `onConflictDoNothing` to skip duplicates rather
 * than filtering pre-insert.
 *
 * Exclusions:
 *   - Entries already marked `entryable_type = 'transfer'` (already
 *     confirmed as part of another pair).
 *   - Entries already referenced by a `pending` or `confirmed`
 *     transfer_candidate row (we don't want to re-flag a pair the user
 *     has explicitly accepted, and we don't want to create multiple
 *     pending rows for the same entry).
 *
 * Transactionality: like `applyRulesToEntries`, this runs inside the
 * sync worker's `withFamilyContext` transaction. All queries here are
 * therefore family-scoped by the RLS policies in 0001_rls_policies.sql
 * and the new transfer_candidate policy in 0004_transfer_candidate.sql.
 */
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import {
  account,
  entry,
  entryLine,
  transferCandidate,
} from '@budget-tracker/db/schema';
import type { DatabaseTx } from '@budget-tracker/db/client';
import {
  detectTransferCandidates,
  type TransferDetectableEntry,
} from '@budget-tracker/core/transfers';

export interface DetectTransfersResult {
  candidatesCreated: number;
}

const DETECTION_WINDOW_DAYS = 14;

function toIsoDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/**
 * Detect and persist transfer candidates for the given family.
 *
 * Loads entries from the last 14 days that are not already transfers and
 * are not already referenced by a pending/confirmed candidate, feeds
 * them through `detectTransferCandidates`, and upserts each returned
 * pair into `transfer_candidate`.
 */
export async function detectAndPersistTransferCandidates(
  tx: DatabaseTx,
  familyId: string,
): Promise<DetectTransfersResult> {
  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - DETECTION_WINDOW_DAYS);
  windowStart.setUTCHours(0, 0, 0, 0);

  const accountRows = await tx
    .select({ id: account.id })
    .from(account)
    .where(eq(account.familyId, familyId));

  const ownedAccountIds = accountRows.map((r) => r.id);
  if (ownedAccountIds.length === 0) {
    return { candidatesCreated: 0 };
  }

  // Pull every non-transfer entry in the window together with its
  // account-side leg. The `NOT EXISTS` subquery filters out entries that
  // are already referenced by a non-dismissed candidate so the detector
  // doesn't re-flag pairs the user has already accepted.
  const rows = await tx
    .select({
      entryId: entry.id,
      description: entry.description,
      entryDate: entry.entryDate,
      entryableType: entry.entryableType,
      amount: entryLine.amount,
      accountId: entryLine.accountId,
    })
    .from(entry)
    .innerJoin(
      entryLine,
      and(eq(entryLine.entryId, entry.id), isNotNull(entryLine.accountId)),
    )
    .where(
      and(
        eq(entry.familyId, familyId),
        gte(entry.entryDate, windowStart),
        sql`${entry.entryableType} <> 'transfer'`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${transferCandidate} tc
          WHERE (tc.entry_a_id = ${entry.id} OR tc.entry_b_id = ${entry.id})
            AND tc.status IN ('pending', 'confirmed')
        )`,
      ),
    );

  if (rows.length === 0) {
    return { candidatesCreated: 0 };
  }

  const detectable: TransferDetectableEntry[] = [];
  for (const row of rows) {
    if (row.accountId === null) continue;
    detectable.push({
      entryId: row.entryId,
      amount: row.amount,
      accountId: row.accountId,
      entryDate: toIsoDate(row.entryDate),
      description: row.description,
      entryableType: row.entryableType,
    });
  }

  const candidates = detectTransferCandidates(detectable, ownedAccountIds);
  if (candidates.length === 0) {
    return { candidatesCreated: 0 };
  }

  let candidatesCreated = 0;
  for (const candidate of candidates) {
    const inserted = await tx
      .insert(transferCandidate)
      .values({
        familyId,
        entryAId: candidate.entryAId,
        entryBId: candidate.entryBId,
        confidence: candidate.confidence.toFixed(2),
      })
      .onConflictDoNothing()
      .returning({ id: transferCandidate.id });

    if (inserted.length > 0) candidatesCreated++;
  }

  return { candidatesCreated };
}
