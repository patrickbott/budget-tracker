/**
 * `@budget-tracker/core/reports` — shared input/output types.
 *
 * Reports is framework-agnostic: callers pre-load row arrays from the
 * DB (or wherever) and pass them in. Core never queries anything.
 * These shapes are the contract between the caller and every report
 * function in this directory.
 */

/**
 * Minimal account-side entry-line row for reports. Pre-loaded by the
 * caller — core never queries the DB.
 *
 * `amountSigned` follows the same convention as `entry_line` elsewhere
 * in core: positive = money into the account (income / deposit),
 * negative = money out of the account (expense / transfer out).
 */
export interface ReportEntryInput {
  entryId: string;
  /** ISO YYYY-MM-DD. */
  entryDate: string;
  /** Signed amount as a decimal string, matching NUMERIC(19,4) storage. */
  amountSigned: string;
  accountId: string;
  categoryId: string | null;
  /** `true` if this entry is `entryable_type = 'transfer'` and should
   *  be excluded from income / expense / spending reports. */
  isTransfer: boolean;
}

/** An account + its current balance, for net-worth computation. */
export interface ReportAccountInput {
  accountId: string;
  accountType:
    | 'depository'
    | 'credit_card'
    | 'investment'
    | 'loan'
    | 'property'
    | 'crypto'
    | 'other';
  /** Current balance as a decimal string. Assets positive, liabilities
   *  negative on input — we do the asset/liability split inside. */
  balance: string;
}

/** Half-open ISO date window `[start, end)` — inclusive start, exclusive end. */
export interface ReportWindow {
  /** ISO YYYY-MM-DD — inclusive. */
  start: string;
  /** ISO YYYY-MM-DD — EXCLUSIVE. */
  end: string;
}
