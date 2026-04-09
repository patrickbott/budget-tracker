/**
 * `@budget-tracker/core/transfers` — heuristic transfer detection.
 *
 * PHASE 2 — not implemented yet. The detection heuristic scans for
 * opposite-sign entry pairs across owned accounts within a date window
 * and flags them as candidate transfers for user confirmation.
 *
 * See `docs/plan.md#phase-2-budgeting--rules` for the detection rules.
 */

/** A flagged pair of entries that look like a transfer. */
export interface TransferCandidate {
  entryAId: string;
  entryBId: string;
  /** 0..1 — higher means stronger heuristic match. */
  confidence: number;
}

export function detectTransferCandidates(
  _input: never,
): TransferCandidate[] {
  throw new Error('not implemented — phase 2+');
}
