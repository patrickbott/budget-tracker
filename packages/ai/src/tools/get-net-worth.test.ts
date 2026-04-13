import { describe, expect, it } from 'vitest';

import { getNetWorthTool } from './get-net-worth.ts';
import type { ToolLoaders } from './types.ts';

function makeLoaders(overrides: Partial<ToolLoaders> = {}): ToolLoaders {
  return {
    loadEntries: async () => [],
    loadAccounts: async () => [],
    loadCategoryNameMap: async () => new Map(),
    loadAccountNameMap: async () => new Map(),
    loadTransactions: async () => ({ rows: [], total: 0 }),
    loadBudgetStatus: async () => [],
    loadRecurringStatus: async () => [],
    loadCategories: async () => [],
    loadAccountsList: async () => [],
    loadGoals: async () => [],
    runReadQuery: async () => ({ columns: [], rows: [], totalRows: 0 }),
    ...overrides,
  };
}

describe('getNetWorthTool', () => {
  it('splits assets and liabilities with the core signing convention', async () => {
    const loaders = makeLoaders({
      loadAccounts: async () => [
        { accountId: 'a1', accountType: 'depository', balance: '5000.00' },
        { accountId: 'a2', accountType: 'investment', balance: '12000.00' },
        { accountId: 'a3', accountType: 'credit_card', balance: '-2340.00' },
      ],
    });

    const out = await getNetWorthTool({ as_of: '2026-04-11' }, loaders);

    expect(out.as_of).toBe('2026-04-11');
    expect(out.asset).toBe('17000.00');
    expect(out.liability).toBe('2340.00');
    expect(out.net).toBe('14660.00');
    expect(out.by_account_type).toEqual({
      depository: '5000.00',
      investment: '12000.00',
      credit_card: '-2340.00',
    });
  });

  it('returns zero across the board when no accounts are loaded', async () => {
    const loaders = makeLoaders();

    const out = await getNetWorthTool({ as_of: '2026-04-11' }, loaders);

    expect(out.asset).toBe('0.00');
    expect(out.liability).toBe('0.00');
    expect(out.net).toBe('0.00');
    expect(out.by_account_type).toEqual({});
  });

  it('preserves seven-figure asset totals through the PII stripper', async () => {
    const loaders = makeLoaders({
      loadAccounts: async () => [
        {
          accountId: 'a1',
          accountType: 'property',
          balance: '1250000.00',
        },
      ],
    });

    const out = await getNetWorthTool({ as_of: '2026-04-11' }, loaders);

    expect(out.asset).toBe('1250000.00');
    expect(out.net).toBe('1250000.00');
  });

  it('rejects a malformed as_of date', async () => {
    const loaders = makeLoaders();

    await expect(
      getNetWorthTool({ as_of: 'yesterday' }, loaders),
    ).rejects.toThrow();
  });
});
