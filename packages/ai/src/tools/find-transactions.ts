/**
 * `find_transactions` — search/filter adapter for the model to look up
 * specific transactions by text query and/or structured filters.
 *
 * The heavy lifting (full-text search, date/amount range filtering) is
 * done by the injected `loadTransactions` loader. The adapter validates
 * input, clamps the result limit to 50, PII-strips the output, and
 * validates the return shape.
 */

import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO YYYY-MM-DD');

const MAX_RESULTS = 50;

export const findTransactionsArgs = z.object({
  query: z
    .string()
    .optional()
    .describe('Optional full-text search string for transaction descriptions.'),
  filters: z
    .object({
      account_id: z.string().optional().describe('Filter by account UUID.'),
      category_id: z.string().optional().describe('Filter by category UUID.'),
      start_date: isoDate
        .optional()
        .describe('Inclusive start date (YYYY-MM-DD).'),
      end_date: isoDate
        .optional()
        .describe('Exclusive end date (YYYY-MM-DD).'),
      min_amount: z
        .string()
        .optional()
        .describe('Minimum absolute amount (decimal string).'),
      max_amount: z
        .string()
        .optional()
        .describe('Maximum absolute amount (decimal string).'),
    })
    .optional()
    .describe('Structured filters to narrow results.'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Max results to return (hard-capped at ${MAX_RESULTS}).`),
});

export const findTransactionsOutput = z.object({
  transactions: z.array(
    z.object({
      entry_id: z.string(),
      date: z.string(),
      amount: z.string(),
      description: z.string(),
      category_name: z.string().nullable(),
      account_name: z.string(),
    }),
  ),
  total: z.number(),
});

export type FindTransactionsArgs = z.infer<typeof findTransactionsArgs>;
export type FindTransactionsOutput = z.infer<typeof findTransactionsOutput>;

export const findTransactionsTool: ToolAdapter<
  FindTransactionsArgs,
  FindTransactionsOutput
> = async (args, loaders) => {
  const parsed = findTransactionsArgs.parse(args);

  const effectiveLimit = Math.min(parsed.limit ?? MAX_RESULTS, MAX_RESULTS);

  const filters = parsed.filters;
  const result = await loaders.loadTransactions({
    query: parsed.query,
    filters: filters
      ? {
          accountId: filters.account_id,
          categoryId: filters.category_id,
          startDate: filters.start_date,
          endDate: filters.end_date,
          minAmount: filters.min_amount,
          maxAmount: filters.max_amount,
        }
      : undefined,
    limit: effectiveLimit,
  });

  const mapped = {
    transactions: result.rows.map((row) => ({
      entry_id: row.entryId,
      date: row.date,
      amount: row.amount,
      description: row.description,
      category_name: row.categoryName,
      account_name: row.accountName,
    })),
    total: result.total,
  };

  return findTransactionsOutput.parse(stripPII(mapped));
};
