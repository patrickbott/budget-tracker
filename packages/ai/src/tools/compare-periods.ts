/**
 * `compare_periods` — wraps `@budget-tracker/core/reports`
 * `comparePeriods` in a Zod-validated, PII-stripped tool adapter.
 *
 * The core function's `dimension` field carries the raw key (a category
 * or account UUID); we remap it to a `dimension_id` + `dimension_name`
 * pair so the model never sees raw IDs. The lookup map depends on the
 * `dimension` arg — categories use `loadCategoryNameMap`, accounts use
 * `loadAccountNameMap`. Missing map entries fall back to the raw ID
 * string. Sort order (biggest `|delta|` first, alphabetic tiebreak) is
 * preserved from the core function.
 */

import { comparePeriods } from '@budget-tracker/core/reports';
import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter, ToolLoaders } from './types.ts';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO YYYY-MM-DD');

export const comparePeriodsArgs = z.object({
  window_a_start: isoDate.describe(
    'Window A inclusive ISO start (YYYY-MM-DD).',
  ),
  window_a_end: isoDate.describe(
    'Window A exclusive ISO end (YYYY-MM-DD).',
  ),
  window_b_start: isoDate.describe(
    'Window B inclusive ISO start (YYYY-MM-DD).',
  ),
  window_b_end: isoDate.describe(
    'Window B exclusive ISO end (YYYY-MM-DD).',
  ),
  dimension: z
    .enum(['category', 'account'])
    .describe('Group deltas by category or by account.'),
});

export const comparePeriodsOutput = z.object({
  window_a: z.object({ start: isoDate, end: isoDate }),
  window_b: z.object({ start: isoDate, end: isoDate }),
  dimension: z.enum(['category', 'account']),
  rows: z.array(
    z.object({
      dimension_id: z.string(),
      dimension_name: z.string(),
      a: z.string(),
      b: z.string(),
      delta: z.string(),
    }),
  ),
});

export type ComparePeriodsArgs = z.infer<typeof comparePeriodsArgs>;
export type ComparePeriodsOutput = z.infer<typeof comparePeriodsOutput>;

export const comparePeriodsTool: ToolAdapter<
  ComparePeriodsArgs,
  ComparePeriodsOutput
> = async (args, loaders) => {
  const parsed = comparePeriodsArgs.parse(args);

  const windowA = { start: parsed.window_a_start, end: parsed.window_a_end };
  const windowB = { start: parsed.window_b_start, end: parsed.window_b_end };

  // Load the superset of entries that could fall in either window.
  // The core function applies per-window filtering defensively, so an
  // over-wide load is safe; we pick the min/max bounds to build one
  // query the DB loader can turn into a single range scan.
  const superWindow = {
    start: windowA.start < windowB.start ? windowA.start : windowB.start,
    end: windowA.end > windowB.end ? windowA.end : windowB.end,
  };

  const [entries, nameMap] = await Promise.all([
    loaders.loadEntries(superWindow),
    loadDimensionNames(parsed.dimension, loaders),
  ]);

  const rows = comparePeriods({
    entries,
    windowA,
    windowB,
    dimension: parsed.dimension,
  });

  const mapped = {
    window_a: windowA,
    window_b: windowB,
    dimension: parsed.dimension,
    rows: rows.map((row) => ({
      dimension_id: row.dimension,
      dimension_name: nameMap.get(row.dimension) ?? row.dimension,
      a: row.a,
      b: row.b,
      delta: row.delta,
    })),
  };

  return comparePeriodsOutput.parse(stripPII(mapped));
};

async function loadDimensionNames(
  dimension: 'category' | 'account',
  loaders: ToolLoaders,
): Promise<Map<string, string>> {
  return dimension === 'category'
    ? loaders.loadCategoryNameMap()
    : loaders.loadAccountNameMap();
}
