/**
 * `@budget-tracker/core/entries` — double-entry invariant enforcement.
 *
 * Phase 0b scope: just `validateEntryLines`. The full entry-builder
 * (construct + persist) lands in Phase 1 when we have a real `packages/db`
 * handle to pass in. For now, this module exists to (a) prove the core
 * test harness works and (b) pin the double-entry invariant in code at
 * the earliest possible moment, so every subsequent phase has a trustworthy
 * helper to call from.
 *
 * The invariant: for every `entry`, SUM(entry_line.amount) = 0.
 *
 * A balanced pair is the minimum — a splash transaction has 2 lines, a
 * split has 3+, a transfer has exactly 2 legs touching two different
 * accounts, etc. This function doesn't care about the shape of the lines;
 * it only checks that the signed `amount` fields sum to exactly zero when
 * evaluated in arbitrary-precision decimal (not floating-point).
 *
 * Why arbitrary precision: a single floating-point cent of drift is a bug
 * that destroys trust in the whole app. `decimal.js` is the TypeScript-side
 * counterpart to the Postgres `NUMERIC(19,4)` column.
 */
import Decimal from 'decimal.js';

/**
 * Minimal shape required to validate an entry. Callers can pass in full
 * `entry_line` rows or just shape-matching objects — only `amount` is
 * read. The amount must be a string so it round-trips losslessly from
 * Postgres NUMERIC.
 */
export interface EntryLineInput {
  amount: string;
}

/**
 * Result of validating a set of entry lines.
 *
 * `ok` is `true` iff the signed amounts sum to exactly zero.
 * `sum` is the computed total, always returned to four decimal places so
 * callers can show the user WHY a set of lines was rejected.
 */
export interface ValidateEntryLinesResult {
  ok: boolean;
  sum: string;
}

/**
 * Sum a set of entry-line amounts in arbitrary-precision decimal and
 * report whether they balance to zero.
 *
 * Contract:
 *   - An empty `lines` array returns `{ ok: true, sum: '0.0000' }`. The
 *     caller is expected to reject empty lines separately — this function
 *     is a mathematical check, not a completeness check.
 *   - The `amount` string is parsed with `decimal.js`, which accepts any
 *     valid Postgres NUMERIC(19,4) serialization.
 *   - The returned `sum` is always formatted to four decimal places,
 *     matching the NUMERIC(19,4) column scale in `packages/db`.
 *
 * @throws Does not throw on well-formed input. Malformed numeric strings
 *   surface as `decimal.js` parse errors — callers that accept untrusted
 *   input should validate the string shape first (see
 *   `AmountSchema` in `../types/index.ts`).
 */
export function validateEntryLines(
  lines: readonly EntryLineInput[],
): ValidateEntryLinesResult {
  const sum = lines.reduce(
    (acc, line) => acc.plus(new Decimal(line.amount)),
    new Decimal(0),
  );
  return {
    ok: sum.eq(0),
    sum: sum.toFixed(4),
  };
}
