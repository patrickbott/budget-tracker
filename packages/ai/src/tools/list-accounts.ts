/**
 * `list_accounts` — directory lookup so the model can resolve
 * natural-language account names to UUIDs before calling other tools.
 *
 * Returns every account for the family with type and visibility.
 * PII-stripped for consistency with all other tool adapters.
 */

import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

export const listAccountsArgs = z
  .object({})
  .describe('No arguments — returns all accounts for the family.');

export const listAccountsOutput = z.object({
  accounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      account_type: z.string(),
      visibility: z.enum(['household', 'personal']),
    }),
  ),
});

export type ListAccountsArgs = z.infer<typeof listAccountsArgs>;
export type ListAccountsOutput = z.infer<typeof listAccountsOutput>;

export const listAccountsTool: ToolAdapter<
  ListAccountsArgs,
  ListAccountsOutput
> = async (_args, loaders) => {
  listAccountsArgs.parse(_args);

  const rows = await loaders.loadAccountsList();

  const mapped = {
    accounts: rows.map((row) => ({
      id: row.id,
      name: row.name,
      account_type: row.accountType,
      visibility: row.visibility,
    })),
  };

  return listAccountsOutput.parse(stripPII(mapped));
};
