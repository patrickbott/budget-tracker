/**
 * `@budget-tracker/core/recurring` — recurring series detection +
 * `missing_dates` computation.
 *
 * PHASE 2 — not implemented yet. See
 * `docs/plan.md#phase-2-budgeting--rules` for the detection + compute
 * strategy (Lunch-Money-style).
 */

/** A detected recurring pattern surfaced to the user for confirmation. */
export interface RecurringCandidate {
  descriptionPattern: string;
  expectedAmount: string;
  cadence: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';
  confidence: number;
}

export function detectRecurringCandidates(
  _input: never,
): RecurringCandidate[] {
  throw new Error('not implemented — phase 2+');
}

/** Compute the set of expected-but-unmatched dates for a recurring series. */
export function computeMissingDates(
  _input: never,
): string[] {
  throw new Error('not implemented — phase 2+');
}
