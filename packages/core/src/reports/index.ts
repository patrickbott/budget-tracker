/**
 * `@budget-tracker/core/reports` — pure report functions that back both
 * the dashboard widgets and the AI tool adapters in `packages/ai`.
 *
 * Framework-agnostic: every function takes pre-loaded row arrays as
 * input and returns plain JSON-friendly output. The DB-query layer
 * lives in `apps/web` server actions and `packages/jobs` helpers, not
 * here. This keeps reports unit-testable without a database, browser,
 * or network, and lets AI tool adapters wrap these functions with a
 * one-line DB fetch.
 *
 * See `docs/plan.md` Phase 3 for the AI-tool mapping.
 */

export { spendingByCategory } from './spending-by-category.ts';
export { cashflow } from './cashflow.ts';
export type { CashflowGranularity } from './cashflow.ts';
export { netWorth } from './net-worth.ts';
export { comparePeriods } from './compare-periods.ts';
export type { CompareDimension } from './compare-periods.ts';
export type {
  ReportEntryInput,
  ReportAccountInput,
  ReportWindow,
} from './types.ts';
