/**
 * `get_net_worth` — wraps `@budget-tracker/core/reports` `netWorth` in a
 * Zod-validated, PII-stripped tool adapter.
 *
 * The core function's `byAccountType` map is surfaced verbatim (typed
 * as `Record<string, string>` in the Zod schema) so the dashboard and
 * AI model can both show "credit_card: -2340.00" lines without
 * re-signing anything. Account-balance signing convention: liability
 * types (`credit_card`, `loan`) show as negative; everything else is
 * an asset whose sign reflects real direction.
 */

import { netWorth } from '@budget-tracker/core/reports';
import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO YYYY-MM-DD');

export const getNetWorthArgs = z.object({
  as_of: isoDate.describe(
    'Snapshot date (YYYY-MM-DD). Tool returns each account\'s balance as of this date.',
  ),
});

export const getNetWorthOutput = z.object({
  as_of: isoDate,
  asset: z.string(),
  liability: z.string(),
  net: z.string(),
  by_account_type: z.record(z.string(), z.string()),
});

export type GetNetWorthArgs = z.infer<typeof getNetWorthArgs>;
export type GetNetWorthOutput = z.infer<typeof getNetWorthOutput>;

export const getNetWorthTool: ToolAdapter<
  GetNetWorthArgs,
  GetNetWorthOutput
> = async (args, loaders) => {
  const parsed = getNetWorthArgs.parse(args);

  const accounts = await loaders.loadAccounts(parsed.as_of);
  const result = netWorth({ accounts });

  return getNetWorthOutput.parse(
    stripPII({
      as_of: parsed.as_of,
      asset: result.asset,
      liability: result.liability,
      net: result.net,
      by_account_type: result.byAccountType,
    }),
  );
};
