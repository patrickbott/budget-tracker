/**
 * `recurring_status` — surfaces every active recurring transaction
 * series along with its expected/missing date analysis.
 *
 * Status derivation:
 *   - `on_time` — no missing dates
 *   - `late`    — only the most recent expected date is missing
 *   - `missing` — more than one expected date is missing
 *
 * The loader is responsible for computing `missingDates` and
 * `nextExpectedDate` from the recurring detection engine in
 * `packages/core`. This adapter just shapes and PII-strips.
 */

import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

export const recurringStatusArgs = z.object({}).describe(
  'No arguments — returns all active recurring series.',
);

const statusEnum = z.enum(['on_time', 'late', 'missing']);

export const recurringStatusOutput = z.object({
  series: z.array(
    z.object({
      title: z.string(),
      amount: z.string(),
      cadence: z.string(),
      last_seen_date: z.string().nullable(),
      next_expected_date: z.string().nullable(),
      missing_dates: z.array(z.string()),
      status: statusEnum,
    }),
  ),
});

export type RecurringStatusArgs = z.infer<typeof recurringStatusArgs>;
export type RecurringStatusOutput = z.infer<typeof recurringStatusOutput>;

function deriveStatus(missingDates: string[]): 'on_time' | 'late' | 'missing' {
  if (missingDates.length === 0) return 'on_time';
  if (missingDates.length === 1) return 'late';
  return 'missing';
}

export const recurringStatusTool: ToolAdapter<
  RecurringStatusArgs,
  RecurringStatusOutput
> = async (_args, loaders) => {
  recurringStatusArgs.parse(_args);

  const rows = await loaders.loadRecurringStatus();

  const series = rows.map((row) => ({
    title: row.title,
    amount: row.amount,
    cadence: row.cadence,
    last_seen_date: row.lastSeenDate,
    next_expected_date: row.nextExpectedDate,
    missing_dates: row.missingDates,
    status: deriveStatus(row.missingDates),
  }));

  return recurringStatusOutput.parse(stripPII({ series }));
};
