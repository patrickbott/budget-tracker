/**
 * `spendingByCategory` — total outflow per category within a half-open window.
 *
 * Backs the dashboard "spending breakdown" widget and the AI
 * `get_spending_by_category` tool. Pure function: callers pre-load the
 * entry rows and core never touches the DB.
 *
 * Filtering rules:
 *   - Half-open date window: `entryDate >= start && entryDate < end`
 *   - Transfers (`isTransfer === true`) are excluded — not real spending
 *   - `categoryId === null` entries are excluded — no group key to sum on
 *   - Non-negative amounts are excluded — spending is outflow only, and
 *     we sum the absolute value so results are positive "spent" numbers
 *
 * Output is sorted by total DESC (biggest spenders first). Amounts are
 * 2-decimal fixed strings: core storage is NUMERIC(19,4) but display /
 * report aggregates use 2 decimals to match the dashboard and AI surfaces.
 */

import Decimal from 'decimal.js';

import type { ReportEntryInput, ReportWindow } from './types.ts';

export function spendingByCategory(input: {
  entries: readonly ReportEntryInput[];
  window: ReportWindow;
}): Array<{ categoryId: string; total: string }> {
  const { entries, window } = input;
  const totals = new Map<string, Decimal>();

  for (const entry of entries) {
    if (entry.isTransfer) continue;
    if (entry.categoryId === null) continue;
    if (entry.entryDate < window.start) continue;
    if (entry.entryDate >= window.end) continue;

    const amount = new Decimal(entry.amountSigned);
    if (!amount.isNegative()) continue;

    const spent = amount.abs();
    const prev = totals.get(entry.categoryId);
    totals.set(entry.categoryId, prev ? prev.plus(spent) : spent);
  }

  const rows = [...totals.entries()].map(([categoryId, total]) => ({
    categoryId,
    total,
  }));
  rows.sort((a, b) => b.total.cmp(a.total));

  return rows.map(({ categoryId, total }) => ({
    categoryId,
    total: total.toFixed(2),
  }));
}
