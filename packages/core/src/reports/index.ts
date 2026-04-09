/**
 * `@budget-tracker/core/reports` — query functions that back both the UI
 * and the AI tool layer.
 *
 * PHASE 3 — not implemented yet. Each function here will receive a
 * family-scoped DB handle (via `@budget-tracker/db`) in a future phase
 * and return a PII-safe aggregate shape. The AI tool adapters in
 * `packages/ai` are a thin wrapper over these same functions.
 *
 * See `docs/ai-tools.md` for the full tool list that maps onto these.
 */

export function spendingByCategory(
  _input: never,
): Array<{ categoryId: string; total: string }> {
  throw new Error('not implemented — phase 3+');
}

export function cashflow(
  _input: never,
): Array<{ period: string; income: string; expense: string; net: string }> {
  throw new Error('not implemented — phase 3+');
}

export function netWorth(
  _input: never,
): { asset: string; liability: string; net: string; byAccountType: Record<string, string> } {
  throw new Error('not implemented — phase 3+');
}

export function comparePeriods(
  _input: never,
): Array<{ dimension: string; a: string; b: string; delta: string }> {
  throw new Error('not implemented — phase 3+');
}
