/**
 * Tool-adapter contract. Adapters in `packages/ai/src/tools/` are thin
 * wrappers around the pure `@budget-tracker/core/reports` functions:
 * they validate args with Zod, fetch rows through the injected loaders,
 * call the pure function, remap category IDs → display names, strip
 * PII, validate the output with Zod, and return.
 *
 * Loaders are injected (not imported from `apps/web` or `packages/db`)
 * to keep `packages/ai` framework-agnostic and unit-testable. Instance
 * A wires the real DB-backed implementation into `apps/web` server
 * actions in a subsequent round; tests here use fake loaders over
 * fixture arrays.
 */

import type {
  ReportAccountInput,
  ReportEntryInput,
  ReportWindow,
} from '@budget-tracker/core/reports';

/**
 * Dependency-injection point for tool adapters.
 *
 * A single `ToolLoaders` is built per-request (or per-test), scoped to
 * the current `family_id` through row-level security at the DB layer.
 * Adapters never reach around this — if a tool needs new data, a new
 * loader method goes here and gets implemented in `apps/web`.
 */
export interface ToolLoaders {
  /**
   * Fetch all report-shape entry rows that could fall inside `window`.
   * Implementations SHOULD pre-filter by date so adapters don't paginate
   * the full family history into memory on every call, but the pure
   * core functions re-apply the half-open window filter defensively.
   */
  loadEntries(window: ReportWindow): Promise<ReportEntryInput[]>;

  /**
   * Fetch every account's current balance as of `asOf` (ISO YYYY-MM-DD).
   * Used by `get_net_worth`. Implementations compute this from the
   * latest `entry_line` rollup per account at query time.
   */
  loadAccounts(asOf: string): Promise<ReportAccountInput[]>;

  /**
   * Directory lookup: category UUID → display name. Used so adapter
   * output says `"Groceries"` instead of `"0193-…-cat-id"` when it
   * reaches the model. Missing keys fall back to the raw ID string in
   * the adapter.
   */
  loadCategoryNameMap(): Promise<Map<string, string>>;

  /**
   * Directory lookup: account UUID → display name. Used by
   * `compare_periods` when the dimension is `'account'` so the model
   * sees human-readable labels instead of raw UUIDs. Missing keys fall
   * back to the raw ID string in the adapter.
   */
  loadAccountNameMap(): Promise<Map<string, string>>;

  /**
   * Search/filter transactions. Returns pre-shaped rows ready for the
   * `find_transactions` adapter. `query` is an optional full-text search
   * string; `filters` narrow by account, category, date range, or
   * amount range. Implementations enforce the family-scoped RLS.
   */
  loadTransactions(params: {
    query?: string;
    filters?: {
      accountId?: string;
      categoryId?: string;
      startDate?: string;
      endDate?: string;
      minAmount?: string;
      maxAmount?: string;
      entryId?: string;
    };
    limit: number;
  }): Promise<{
    rows: Array<{
      entryId: string;
      date: string;
      amount: string;
      description: string;
      categoryName: string | null;
      accountName: string;
    }>;
    total: number;
  }>;

  /**
   * Per-category budget status for a date range. Returns the budget
   * configuration alongside actual spend so the adapter can compute
   * thresholds without touching the database.
   */
  loadBudgetStatus(
    periodStart: string,
    periodEnd: string,
  ): Promise<
    Array<{
      categoryName: string;
      budgetMode: 'hard_cap' | 'forecast';
      budgetAmount: string;
      actualSpend: string;
    }>
  >;

  /**
   * All active recurring transaction series for the family. Returns
   * series-level metadata plus expected/missing date analysis so the
   * adapter can derive on_time / late / missing status.
   */
  loadRecurringStatus(): Promise<
    Array<{
      title: string;
      amount: string;
      cadence: string;
      lastSeenDate: string | null;
      nextExpectedDate: string | null;
      missingDates: string[];
    }>
  >;

  /**
   * Directory lookup: all categories for the family. Used by the
   * `list_categories` tool so the model can map natural-language
   * category names to IDs before calling other tools.
   */
  loadCategories(): Promise<
    Array<{
      id: string;
      name: string;
      parentName: string | null;
    }>
  >;

  /**
   * Directory lookup: all accounts for the family. Used by the
   * `list_accounts` tool so the model can map account names to IDs.
   */
  loadAccountsList(): Promise<
    Array<{
      id: string;
      name: string;
      accountType: string;
      visibility: 'household' | 'personal';
    }>
  >;

  /**
   * Fetch goals for the family, optionally filtered by goal ID.
   * Returns goal metadata + linked account IDs for progress computation.
   */
  loadGoals(goalId?: string): Promise<
    Array<{
      id: string;
      name: string;
      goalType: 'savings' | 'debt_payoff' | 'net_worth_target';
      targetAmount: string;
      targetDate: string | null;
      linkedAccountIds: string[];
      status: string;
      createdAt: string;
    }>
  >;

  /**
   * Execute a validated read-only SQL query within the RLS-scoped
   * transaction. Callers MUST validate the SQL is safe before calling.
   * Returns raw rows as key-value pairs.
   */
  runReadQuery(sql: string): Promise<{
    columns: string[];
    rows: Array<Record<string, unknown>>;
    totalRows: number;
  }>;
}

/**
 * The generic tool-adapter signature. `TArgs` is the Zod-validated
 * input (already parsed into its output type); `TOutput` is the
 * PII-stripped, Zod-validated return shape.
 */
export type ToolAdapter<TArgs, TOutput> = (
  args: TArgs,
  loaders: ToolLoaders,
) => Promise<TOutput>;
