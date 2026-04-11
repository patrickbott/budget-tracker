/**
 * `get_cashflow` — wraps `@budget-tracker/core/reports` `cashflow` in a
 * Zod-validated, PII-stripped tool adapter.
 *
 * `granularity` is an enum the core function also enforces; we mirror
 * it here so the JSON schema the model sees lists the exact options.
 * Output keeps snake-case field names for the same reason.
 */

import { cashflow } from '@budget-tracker/core/reports';
import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO YYYY-MM-DD');

export const getCashflowArgs = z.object({
  window_start: isoDate.describe('Inclusive ISO start date (YYYY-MM-DD).'),
  window_end: isoDate.describe('Exclusive ISO end date (YYYY-MM-DD).'),
  granularity: z
    .enum(['day', 'week', 'month'])
    .describe(
      'Bucket size. Weeks start on ISO Monday in UTC; months on day 1 UTC.',
    ),
});

export const getCashflowOutput = z.object({
  window: z.object({ start: isoDate, end: isoDate }),
  granularity: z.enum(['day', 'week', 'month']),
  rows: z.array(
    z.object({
      period: z.string(),
      income: z.string(),
      expense: z.string(),
      net: z.string(),
    }),
  ),
});

export type GetCashflowArgs = z.infer<typeof getCashflowArgs>;
export type GetCashflowOutput = z.infer<typeof getCashflowOutput>;

export const getCashflowTool: ToolAdapter<
  GetCashflowArgs,
  GetCashflowOutput
> = async (args, loaders) => {
  const parsed = getCashflowArgs.parse(args);
  const window = { start: parsed.window_start, end: parsed.window_end };

  const entries = await loaders.loadEntries(window);
  const rows = cashflow({ entries, window, granularity: parsed.granularity });

  return getCashflowOutput.parse(
    stripPII({
      window,
      granularity: parsed.granularity,
      rows,
    }),
  );
};
