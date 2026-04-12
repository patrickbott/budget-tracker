/**
 * `explain_variance` — finds the driver transactions explaining why
 * spending in a category changed vs the prior period.
 *
 * Given a category and a time window, loads entries for both the current
 * and prior period (same duration, immediately preceding), computes the
 * delta, and surfaces the top transactions that drive the change — new
 * merchants, significantly larger charges, or disappeared charges.
 */

import Decimal from 'decimal.js';
import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO YYYY-MM-DD');

export const explainVarianceArgs = z.object({
  category_id: z.string().describe('Category UUID to analyze.'),
  period_start: isoDate.describe('Inclusive ISO start of current period (YYYY-MM-DD).'),
  period_end: isoDate.describe('Exclusive ISO end of current period (YYYY-MM-DD).'),
});

export const explainVarianceOutput = z.object({
  category_name: z.string(),
  current_period: z.object({
    start: z.string(),
    end: z.string(),
    total: z.string(),
  }),
  prior_period: z.object({
    start: z.string(),
    end: z.string(),
    total: z.string(),
  }),
  change_amount: z.string(),
  change_percent: z.string().nullable(),
  drivers: z.array(
    z.object({
      description: z.string(),
      amount: z.string(),
      date: z.string(),
      is_new: z.boolean(),
    }),
  ),
});

export type ExplainVarianceArgs = z.infer<typeof explainVarianceArgs>;
export type ExplainVarianceOutput = z.infer<typeof explainVarianceOutput>;

/** Compute a prior period of the same duration immediately preceding. */
function computePriorPeriod(
  start: string,
  end: string,
): { start: string; end: string } {
  const startDate = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  const durationMs = endDate.getTime() - startDate.getTime();

  const priorEnd = startDate;
  const priorStart = new Date(priorEnd.getTime() - durationMs);

  return {
    start: priorStart.toISOString().slice(0, 10),
    end: priorEnd.toISOString().slice(0, 10),
  };
}

/** Normalize a description for merchant matching — lowercase, strip trailing digits/refs. */
function normalizeMerchant(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/\s*#\d+\s*$/g, '')
    .replace(/\s*\d{4,}\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_DRIVERS = 10;

export const explainVarianceTool: ToolAdapter<
  ExplainVarianceArgs,
  ExplainVarianceOutput
> = async (args, loaders) => {
  const parsed = explainVarianceArgs.parse(args);
  const { category_id, period_start, period_end } = parsed;

  const priorPeriod = computePriorPeriod(period_start, period_end);

  const [currentEntries, priorEntries, categoryNames] = await Promise.all([
    loaders.loadEntries({ start: period_start, end: period_end }),
    loaders.loadEntries({ start: priorPeriod.start, end: priorPeriod.end }),
    loaders.loadCategoryNameMap(),
  ]);

  const catName = categoryNames.get(category_id) ?? category_id;

  // Filter to target category, exclude transfers, only outflows
  const filterCat = (
    entries: ReadonlyArray<{
      entryId: string;
      entryDate: string;
      amountSigned: string;
      accountId: string;
      categoryId: string | null;
      isTransfer: boolean;
    }>,
  ) =>
    entries.filter(
      (e) =>
        e.categoryId === category_id &&
        !e.isTransfer &&
        new Decimal(e.amountSigned).isNegative(),
    );

  const currentFiltered = filterCat(currentEntries);
  const priorFiltered = filterCat(priorEntries);

  // Compute totals (absolute values)
  const currentTotal = currentFiltered.reduce(
    (sum, e) => sum.plus(new Decimal(e.amountSigned).abs()),
    new Decimal(0),
  );
  const priorTotal = priorFiltered.reduce(
    (sum, e) => sum.plus(new Decimal(e.amountSigned).abs()),
    new Decimal(0),
  );

  const changeAmount = currentTotal.minus(priorTotal);
  const changePercent = priorTotal.isZero()
    ? null
    : changeAmount.div(priorTotal).mul(100).toDecimalPlaces(1).toString();

  // Load transactions (which have descriptions) to identify driver merchants.
  // loadEntries doesn't carry descriptions, so we need loadTransactions for
  // the new-merchant detection and driver ranking.
  const [currentTxns, priorTxns] = await Promise.all([
    loaders.loadTransactions({
      filters: {
        categoryId: category_id,
        startDate: period_start,
        endDate: period_end,
      },
      limit: 50,
    }),
    loaders.loadTransactions({
      filters: {
        categoryId: category_id,
        startDate: priorPeriod.start,
        endDate: priorPeriod.end,
      },
      limit: 50,
    }),
  ]);

  // Build prior merchant description set (normalized)
  const priorDescriptions = new Set(
    priorTxns.rows.map((r) => normalizeMerchant(r.description)),
  );

  // Score each current transaction by its contribution to variance
  // Drivers are: new merchants + transactions sorted by absolute amount
  const drivers = currentTxns.rows
    .filter((r) => new Decimal(r.amount).isNegative())
    .map((r) => {
      const normalDesc = normalizeMerchant(r.description);
      const isNew = !priorDescriptions.has(normalDesc);
      return {
        description: r.description,
        amount: r.amount,
        date: r.date,
        is_new: isNew,
      };
    })
    // Sort: new merchants first, then by absolute amount descending
    .sort((a, b) => {
      if (a.is_new !== b.is_new) return a.is_new ? -1 : 1;
      return new Decimal(b.amount).abs().minus(new Decimal(a.amount).abs()).isPositive() ? 1 : -1;
    })
    .slice(0, MAX_DRIVERS);

  const result = {
    category_name: catName,
    current_period: {
      start: period_start,
      end: period_end,
      total: currentTotal.toFixed(2),
    },
    prior_period: {
      start: priorPeriod.start,
      end: priorPeriod.end,
      total: priorTotal.toFixed(2),
    },
    change_amount: changeAmount.toFixed(2),
    change_percent: changePercent,
    drivers,
  };

  return explainVarianceOutput.parse(stripPII(result));
};
