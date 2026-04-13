import { describe, expect, it } from 'vitest';

import { listAccountsTool } from './list-accounts.ts';
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

describe('listAccountsTool', () => {
  it('returns all accounts with type and visibility', async () => {
    const loaders = makeLoaders({
      loadAccountsList: async () => [
        { id: 'acc-1', name: 'Checking', accountType: 'depository', visibility: 'household' as const },
        { id: 'acc-2', name: 'Credit Card', accountType: 'credit_card', visibility: 'household' as const },
        { id: 'acc-3', name: 'Side Hustle', accountType: 'depository', visibility: 'personal' as const },
      ],
    });

    const out = await listAccountsTool({}, loaders);

    expect(out.accounts).toEqual([
      { id: 'acc-1', name: 'Checking', account_type: 'depository', visibility: 'household' },
      { id: 'acc-2', name: 'Credit Card', account_type: 'credit_card', visibility: 'household' },
      { id: 'acc-3', name: 'Side Hustle', account_type: 'depository', visibility: 'personal' },
    ]);
  });

  it('returns empty accounts array when none exist', async () => {
    const loaders = makeLoaders();

    const out = await listAccountsTool({}, loaders);

    expect(out.accounts).toEqual([]);
  });

  it('strips PII from account names', async () => {
    const loaders = makeLoaders({
      loadAccountsList: async () => [
        { id: 'acc-1', name: 'Customer: Jane Doe checking', accountType: 'depository', visibility: 'household' as const },
      ],
    });

    const out = await listAccountsTool({}, loaders);

    expect(out.accounts[0]?.name).not.toContain('Jane Doe');
    expect(out.accounts[0]?.name).toContain('[name]');
  });

  it('handles all account types', async () => {
    const loaders = makeLoaders({
      loadAccountsList: async () => [
        { id: 'acc-1', name: 'Savings', accountType: 'depository', visibility: 'household' as const },
        { id: 'acc-2', name: 'Visa', accountType: 'credit_card', visibility: 'household' as const },
        { id: 'acc-3', name: 'Brokerage', accountType: 'investment', visibility: 'personal' as const },
        { id: 'acc-4', name: 'Mortgage', accountType: 'loan', visibility: 'household' as const },
        { id: 'acc-5', name: 'House', accountType: 'property', visibility: 'household' as const },
      ],
    });

    const out = await listAccountsTool({}, loaders);

    expect(out.accounts).toHaveLength(5);
    expect(out.accounts.map((a) => a.account_type)).toEqual([
      'depository', 'credit_card', 'investment', 'loan', 'property',
    ]);
  });
});
