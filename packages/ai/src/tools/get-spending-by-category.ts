/**
 * `get_spending_by_category` — wraps the pure
 * `@budget-tracker/core/reports` spending-by-category function in a
 * Zod-validated, PII-stripped adapter the model can call via
 * Anthropic `tool_use`.
 *
 * Snake-case input field names match Anthropic tool-use conventions so
 * the JSON schema the model sees reads naturally. Output shape mirrors
 * the core function plus a `category_name` field, remapped from the
 * injected `loadCategoryNameMap` lookup so the model never sees raw
 * UUIDs. Missing map entries fall back to the raw ID string rather
 * than silently dropping a category.
 */

import { spendingByCategory } from '@budget-tracker/core/reports';
import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO YYYY-MM-DD');

export const getSpendingByCategoryArgs = z.object({
  window_start: isoDate.describe('Inclusive ISO start date (YYYY-MM-DD).'),
  window_end: isoDate.describe(
    'Exclusive ISO end date (YYYY-MM-DD). Half-open window.',
  ),
});

export const getSpendingByCategoryOutput = z.object({
  window: z.object({ start: isoDate, end: isoDate }),
  rows: z.array(
    z.object({
      category_id: z.string(),
      category_name: z.string(),
      total: z.string(),
    }),
  ),
});

export type GetSpendingByCategoryArgs = z.infer<
  typeof getSpendingByCategoryArgs
>;
export type GetSpendingByCategoryOutput = z.infer<
  typeof getSpendingByCategoryOutput
>;

export const getSpendingByCategoryTool: ToolAdapter<
  GetSpendingByCategoryArgs,
  GetSpendingByCategoryOutput
> = async (args, loaders) => {
  const parsed = getSpendingByCategoryArgs.parse(args);
  const window = { start: parsed.window_start, end: parsed.window_end };

  const [entries, categoryNames] = await Promise.all([
    loaders.loadEntries(window),
    loaders.loadCategoryNameMap(),
  ]);

  const rows = spendingByCategory({ entries, window });
  const mapped = {
    window,
    rows: rows.map((row) => ({
      category_id: row.categoryId,
      category_name: categoryNames.get(row.categoryId) ?? row.categoryId,
      total: row.total,
    })),
  };

  return getSpendingByCategoryOutput.parse(stripPII(mapped));
};
