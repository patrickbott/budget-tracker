/**
 * `cashflow` — income / expense / net bucketed by day, week, or month.
 *
 * Same half-open window + transfer-exclusion rules as `spendingByCategory`.
 *   - `day` bucket key = the entry's own ISO date
 *   - `week` bucket key = Monday of that week, computed in UTC (ISO week start)
 *   - `month` bucket key = first day of that month in UTC
 *
 * Buckets with zero activity are NOT emitted — a call with 3 dates in one
 * month yields 3 rows at day granularity, 1 row at month granularity, and
 * never emits empty periods for the gaps. The dashboard can fill holes on
 * render if it wants a continuous timeline.
 *
 * `income` and `expense` are both non-negative absolute totals; `net` is
 * signed (`income - expense`).
 */

import Decimal from 'decimal.js';

import type { ReportEntryInput, ReportWindow } from './types.ts';

export type CashflowGranularity = 'day' | 'week' | 'month';

export function cashflow(input: {
  entries: readonly ReportEntryInput[];
  window: ReportWindow;
  granularity: CashflowGranularity;
}): Array<{
  period: string;
  income: string;
  expense: string;
  net: string;
}> {
  const { entries, window, granularity } = input;
  const buckets = new Map<string, { income: Decimal; expense: Decimal }>();

  for (const entry of entries) {
    if (entry.isTransfer) continue;
    if (entry.entryDate < window.start) continue;
    if (entry.entryDate >= window.end) continue;

    const period = bucketStart(entry.entryDate, granularity);
    const bucket = buckets.get(period) ?? {
      income: new Decimal(0),
      expense: new Decimal(0),
    };

    const amount = new Decimal(entry.amountSigned);
    if (amount.isPositive()) {
      bucket.income = bucket.income.plus(amount);
    } else if (amount.isNegative()) {
      bucket.expense = bucket.expense.plus(amount.abs());
    }
    // zero-amount entries are no-ops on both sides.

    buckets.set(period, bucket);
  }

  const rows = [...buckets.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );

  return rows.map(([period, { income, expense }]) => ({
    period,
    income: income.toFixed(2),
    expense: expense.toFixed(2),
    net: income.minus(expense).toFixed(2),
  }));
}

function bucketStart(iso: string, granularity: CashflowGranularity): string {
  if (granularity === 'day') return iso;

  const d = new Date(`${iso}T00:00:00.000Z`);
  if (granularity === 'month') {
    d.setUTCDate(1);
  } else {
    // week → ISO Monday in UTC. getUTCDay: 0=Sun..6=Sat; Monday offset is 1.
    const daysBack = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - daysBack);
  }
  return d.toISOString().slice(0, 10);
}
