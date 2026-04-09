/**
 * `@budget-tracker/core/budgets` — budget status + forecasting math.
 *
 * PHASE 2 — not implemented yet. See
 * `docs/plan.md#phase-2-budgeting--rules`.
 */

/** Per-category budget status as shown on the dashboard ring widget. */
export interface BudgetStatus {
  /** The budget row id. */
  budgetId: string;
  /** `'hard_cap' | 'forecast'`, mirrors the budget row. */
  mode: 'hard_cap' | 'forecast';
  /** Budget target as a decimal string. */
  target: string;
  /** Actual spend in the period so far, as a decimal string. */
  actual: string;
  /** Remaining headroom (target - actual), signed. */
  remaining: string;
  /** Status color for the UI — computed from the mode + remaining. */
  color: 'green' | 'amber' | 'red';
}

export function computeBudgetStatus(
  _input: never,
): BudgetStatus {
  throw new Error('not implemented — phase 2+');
}

export function forecastMonthEnd(
  _input: never,
): { projected: string; confidence: 'low' | 'medium' | 'high' } {
  throw new Error('not implemented — phase 2+');
}
