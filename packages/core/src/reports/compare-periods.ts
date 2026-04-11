/**
 * `comparePeriods` — category- or account-level spending across two windows.
 *
 * Runs the same outflow-only, transfer-excluded aggregation as
 * `spendingByCategory` for each window, then joins the two aggregates
 * by dimension key. Rows present in only one window are still emitted
 * with `"0.00"` on the missing side so the caller can render "new"
 * and "disappeared" buckets in the same list.
 *
 * Sorted by `|delta|` DESC so the biggest movers (in either direction)
 * surface first. A +$500 swing outranks a -$100 swing regardless of sign.
 *
 * `a` and `b` are absolute spend amounts; `delta = b - a` is signed
 * (positive means window B spent more than window A).
 */

import Decimal from 'decimal.js';

import type { ReportEntryInput, ReportWindow } from './types.ts';

export type CompareDimension = 'category' | 'account';

export function comparePeriods(input: {
  entries: readonly ReportEntryInput[];
  windowA: ReportWindow;
  windowB: ReportWindow;
  dimension: CompareDimension;
}): Array<{
  dimension: string;
  a: string;
  b: string;
  delta: string;
}> {
  const { entries, windowA, windowB, dimension } = input;

  const aggA = aggregateSpending(entries, windowA, dimension);
  const aggB = aggregateSpending(entries, windowB, dimension);

  const keys = new Set<string>([...aggA.keys(), ...aggB.keys()]);
  const rows = [...keys].map((key) => {
    const a = aggA.get(key) ?? new Decimal(0);
    const b = aggB.get(key) ?? new Decimal(0);
    return { key, a, b, delta: b.minus(a) };
  });

  rows.sort((x, y) => y.delta.abs().cmp(x.delta.abs()));

  return rows.map(({ key, a, b, delta }) => ({
    dimension: key,
    a: a.toFixed(2),
    b: b.toFixed(2),
    delta: delta.toFixed(2),
  }));
}

/**
 * Build a `key → total` map of outflow spending within `window`, using
 * the same filters as `spendingByCategory`: exclude transfers, exclude
 * non-negative amounts, exclude missing keys, sum the absolute value.
 */
function aggregateSpending(
  entries: readonly ReportEntryInput[],
  window: ReportWindow,
  dimension: CompareDimension,
): Map<string, Decimal> {
  const out = new Map<string, Decimal>();

  for (const entry of entries) {
    if (entry.isTransfer) continue;
    if (entry.entryDate < window.start) continue;
    if (entry.entryDate >= window.end) continue;

    const key =
      dimension === 'category' ? entry.categoryId : entry.accountId;
    if (key === null) continue;

    const amount = new Decimal(entry.amountSigned);
    if (!amount.isNegative()) continue;

    const spent = amount.abs();
    const prev = out.get(key);
    out.set(key, prev ? prev.plus(spent) : spent);
  }

  return out;
}
