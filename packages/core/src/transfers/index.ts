/**
 * `@budget-tracker/core/transfers` — heuristic transfer detection.
 *
 * Scans for opposite-sign entry pairs across owned accounts within a
 * date window and flags them as candidate transfers for user confirmation.
 *
 * Pure function — no DB access. The caller provides the entry list.
 */

import Decimal from 'decimal.js';

/** A flagged pair of entries that look like a transfer. */
export interface TransferCandidate {
  entryAId: string;
  entryBId: string;
  /** 0..1 — higher means stronger heuristic match. */
  confidence: number;
}

/** An entry as consumed by the transfer detector. */
export interface TransferDetectableEntry {
  entryId: string;
  amount: string;
  accountId: string;
  entryDate: string;
  description: string;
  /** If 'transfer', this entry is already linked and should be excluded. */
  entryableType: string;
}

/** Maximum calendar-day gap between a transfer pair. */
const MAX_DATE_GAP_DAYS = 3;

/** Maximum amount difference (absolute) to consider as the same transfer. */
const MAX_AMOUNT_DIFF = new Decimal('0.01');

/**
 * Compute the absolute difference in calendar days between two ISO dates.
 */
function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA);
  const b = new Date(dateB);
  const msPerDay = 86_400_000;
  return Math.abs(Math.round((a.getTime() - b.getTime()) / msPerDay));
}

/**
 * Compute confidence score for a potential transfer pair.
 *
 * - Exact amount match + same day = 1.0
 * - Exact amount match + 1 day = 0.9
 * - $0.01 diff or 2-3 days = 0.7
 */
function computeConfidence(amountDiff: Decimal, dayGap: number): number {
  const exactAmount = amountDiff.isZero();

  if (exactAmount && dayGap === 0) return 1.0;
  if (exactAmount && dayGap === 1) return 0.9;
  return 0.7;
}

/**
 * Detect candidate transfer pairs from a list of entries.
 *
 * Match criteria:
 *   - Entries on different accounts (both owned by the family)
 *   - Opposite signs
 *   - Amounts within $0.01 (decimal.js)
 *   - Dates within 3 calendar days
 *
 * Entries already marked as transfers (`entryableType === 'transfer'`)
 * are excluded.
 *
 * Returns candidates sorted by confidence DESC.
 */
export function detectTransferCandidates(
  entries: readonly TransferDetectableEntry[],
  accountIds: readonly string[],
): TransferCandidate[] {
  const accountSet = new Set(accountIds);

  // Filter to eligible entries: owned accounts, not already transfers
  const eligible = entries.filter(
    (e) => accountSet.has(e.accountId) && e.entryableType !== 'transfer',
  );

  // Split into positive and negative amounts for O(n*m) pairing
  const positives = eligible.filter((e) => new Decimal(e.amount).isPositive());
  const negatives = eligible.filter((e) => new Decimal(e.amount).isNegative());

  const candidates: TransferCandidate[] = [];
  const matchedIds = new Set<string>();

  for (const pos of positives) {
    for (const neg of negatives) {
      // Skip if already matched or same account
      if (matchedIds.has(pos.entryId) || matchedIds.has(neg.entryId)) continue;
      if (pos.accountId === neg.accountId) continue;

      const posAmount = new Decimal(pos.amount);
      const negAmount = new Decimal(neg.amount);
      const amountDiff = posAmount.plus(negAmount).abs(); // pos + neg should be ~0

      if (amountDiff.greaterThan(MAX_AMOUNT_DIFF)) continue;

      const dayGap = daysBetween(pos.entryDate, neg.entryDate);
      if (dayGap > MAX_DATE_GAP_DAYS) continue;

      const confidence = computeConfidence(amountDiff, dayGap);

      candidates.push({
        entryAId: pos.entryId,
        entryBId: neg.entryId,
        confidence,
      });

      // Each entry can only be part of one transfer pair
      matchedIds.add(pos.entryId);
      matchedIds.add(neg.entryId);
    }
  }

  // Sort by confidence DESC
  candidates.sort((a, b) => b.confidence - a.confidence);

  return candidates;
}
