/**
 * `budget_status` — per-category budget vs actual spend for a date
 * range. The loader returns raw budget rows; this adapter computes
 * `remaining`, `percentUsed`, and a traffic-light `status` field.
 *
 * Status thresholds:
 *   - `on_track`    — percentUsed < 80
 *   - `warning`     — 80 <= percentUsed < 100
 *   - `over_budget` — percentUsed >= 100
 */

import Decimal from 'decimal.js';
import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO YYYY-MM-DD');

export const budgetStatusArgs = z.object({
  period_start: isoDate.describe('Inclusive ISO start date (YYYY-MM-DD).'),
  period_end: isoDate.describe('Exclusive ISO end date (YYYY-MM-DD).'),
});

const statusEnum = z.enum(['on_track', 'warning', 'over_budget']);

export const budgetStatusOutput = z.object({
  categories: z.array(
    z.object({
      category_name: z.string(),
      budget_mode: z.enum(['hard_cap', 'forecast']),
      budget_amount: z.string(),
      actual_spend: z.string(),
      remaining: z.string(),
      percent_used: z.number(),
      status: statusEnum,
    }),
  ),
});

export type BudgetStatusArgs = z.infer<typeof budgetStatusArgs>;
export type BudgetStatusOutput = z.infer<typeof budgetStatusOutput>;

function deriveStatus(percentUsed: number): 'on_track' | 'warning' | 'over_budget' {
  if (percentUsed >= 100) return 'over_budget';
  if (percentUsed >= 80) return 'warning';
  return 'on_track';
}

export const budgetStatusTool: ToolAdapter<
  BudgetStatusArgs,
  BudgetStatusOutput
> = async (args, loaders) => {
  const parsed = budgetStatusArgs.parse(args);

  const rows = await loaders.loadBudgetStatus(
    parsed.period_start,
    parsed.period_end,
  );

  const categories = rows.map((row) => {
    const budget = new Decimal(row.budgetAmount);
    const actual = new Decimal(row.actualSpend);
    const remaining = budget.minus(actual);
    const percentUsed = budget.isZero()
      ? actual.isZero()
        ? 0
        : 100
      : actual.div(budget).mul(100).toDecimalPlaces(1).toNumber();

    return {
      category_name: row.categoryName,
      budget_mode: row.budgetMode,
      budget_amount: row.budgetAmount,
      actual_spend: row.actualSpend,
      remaining: remaining.toFixed(2),
      percent_used: percentUsed,
      status: deriveStatus(percentUsed),
    };
  });

  return budgetStatusOutput.parse(stripPII({ categories }));
};
