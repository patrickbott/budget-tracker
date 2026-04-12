/**
 * `forecast_month_end` — linear + trend-adjusted projection of spending
 * through end of current month, optionally scoped to a single category.
 *
 * Uses the `forecastMonthEnd` pure function from `@budget-tracker/core`
 * to compute per-category daily run rates and project forward. Budget
 * data is layered on so the model can report whether each category is
 * on track.
 */

import {
  forecastMonthEnd,
  type DailySpend,
} from '@budget-tracker/core/budgets';
import Decimal from 'decimal.js';
import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

export const forecastMonthEndArgs = z.object({
  category_id: z
    .string()
    .optional()
    .describe(
      'Optional category UUID. If omitted, forecasts total spending across all categories.',
    ),
});

export const forecastMonthEndOutput = z.object({
  forecast_date: z.string(),
  days_remaining: z.number(),
  categories: z.array(
    z.object({
      category_id: z.string(),
      category_name: z.string(),
      current_spend: z.string(),
      projected_spend: z.string(),
      confidence: z.enum(['low', 'medium', 'high']),
      budget_amount: z.string().nullable(),
      budget_mode: z.enum(['hard_cap', 'forecast']).nullable(),
      on_track: z.boolean(),
    }),
  ),
});

export type ForecastMonthEndArgs = z.infer<typeof forecastMonthEndArgs>;
export type ForecastMonthEndOutput = z.infer<typeof forecastMonthEndOutput>;

/**
 * Group entries by category and aggregate into daily spend totals
 * for use with the core `forecastMonthEnd` function.
 */
function buildDailySpendByCategory(
  entries: ReadonlyArray<{
    entryDate: string;
    amountSigned: string;
    categoryId: string | null;
    isTransfer: boolean;
  }>,
): Map<string, DailySpend[]> {
  // Accumulate per-category per-day spend (expenses are negative amounts)
  const catDayMap = new Map<string, Map<string, Decimal>>();

  for (const e of entries) {
    if (e.isTransfer || e.categoryId === null) continue;
    const amount = new Decimal(e.amountSigned);
    // Only count outflows (negative amounts) as spending
    if (amount.gte(0)) continue;

    const catMap = catDayMap.get(e.categoryId) ?? new Map<string, Decimal>();
    const prev = catMap.get(e.entryDate) ?? new Decimal(0);
    catMap.set(e.entryDate, prev.plus(amount.abs()));
    catDayMap.set(e.categoryId, catMap);
  }

  // Convert to sorted DailySpend arrays
  const result = new Map<string, DailySpend[]>();
  for (const [catId, dayMap] of catDayMap) {
    const days: DailySpend[] = [];
    for (const [date, total] of dayMap) {
      days.push({ date, amount: total.toFixed(4) });
    }
    days.sort((a, b) => a.date.localeCompare(b.date));
    result.set(catId, days);
  }

  return result;
}

export const forecastMonthEndTool: ToolAdapter<
  ForecastMonthEndArgs,
  ForecastMonthEndOutput
> = async (args, loaders) => {
  const parsed = forecastMonthEndArgs.parse(args);

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-indexed

  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const todayISO = `${year}-${String(month + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Last day of month
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  // Half-open end for loadEntries: day after last day = first of next month
  const monthEndExclusive = `${month + 1 === 12 ? year + 1 : year}-${String(month + 1 === 12 ? 1 : month + 2).padStart(2, '0')}-01`;

  const daysElapsed = today.getDate();
  const daysRemaining = lastDay - daysElapsed;

  const [entries, budgetRows, categoryNames] = await Promise.all([
    loaders.loadEntries({ start: monthStart, end: monthEndExclusive }),
    loaders.loadBudgetStatus(monthStart, monthEndExclusive),
    loaders.loadCategoryNameMap(),
  ]);

  // Build budget lookup: categoryName → budget info
  const budgetByName = new Map(
    budgetRows.map((b) => [
      b.categoryName,
      { amount: b.budgetAmount, mode: b.budgetMode },
    ]),
  );

  const dailySpendByCategory = buildDailySpendByCategory(entries);

  // Collect all category IDs that have spending
  let categoryIds = [...dailySpendByCategory.keys()];

  // Filter to single category if requested
  if (parsed.category_id) {
    categoryIds = categoryIds.filter((id) => id === parsed.category_id);
    // If the requested category has no spending yet, still include it
    if (categoryIds.length === 0) {
      categoryIds = [parsed.category_id];
    }
  }

  const categories = categoryIds.map((catId) => {
    const dailySpend = dailySpendByCategory.get(catId) ?? [];
    const catName = categoryNames.get(catId) ?? catId;

    // Current spend = sum of daily spend
    const currentSpend = dailySpend.reduce(
      (sum, d) => sum.plus(new Decimal(d.amount)),
      new Decimal(0),
    );

    // Use core forecast function
    const forecast = forecastMonthEnd(dailySpend, daysRemaining);

    // Budget lookup (by display name, since that's what the loader returns)
    const budget = budgetByName.get(catName) ?? null;

    // on_track: projected <= budget (if budget exists), or true if no budget
    const onTrack = budget
      ? new Decimal(forecast.projected).lte(new Decimal(budget.amount))
      : true;

    return {
      category_id: catId,
      category_name: catName,
      current_spend: currentSpend.toFixed(2),
      projected_spend: new Decimal(forecast.projected).toFixed(2),
      confidence: forecast.confidence,
      budget_amount: budget ? budget.amount : null,
      budget_mode: budget ? budget.mode : null,
      on_track: onTrack,
    };
  });

  // Sort by projected spend descending
  categories.sort((a, b) => {
    const diff = new Decimal(b.projected_spend).minus(
      new Decimal(a.projected_spend),
    );
    return diff.isZero() ? a.category_name.localeCompare(b.category_name) : diff.isPositive() ? 1 : -1;
  });

  const result = {
    forecast_date: monthEnd,
    days_remaining: daysRemaining,
    categories,
  };

  return forecastMonthEndOutput.parse(stripPII(result));
};
