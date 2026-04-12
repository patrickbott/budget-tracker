import { describe, expect, it } from 'vitest';

import { findTransactionsTool } from './find-transactions.ts';
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

describe('findTransactionsTool', () => {
  it('returns matching transactions from the loader', async () => {
    const loaders = makeLoaders({
      loadTransactions: async () => ({
        rows: [
          {
            entryId: 'e1',
            date: '2026-03-15',
            amount: '-42.50',
            description: 'GROCERY STORE',
            categoryName: 'Groceries',
            accountName: 'Checking',
          },
          {
            entryId: 'e2',
            date: '2026-03-16',
            amount: '-8.99',
            description: 'COFFEE SHOP',
            categoryName: 'Dining',
            accountName: 'Checking',
          },
        ],
        total: 2,
      }),
    });

    const out = await findTransactionsTool(
      { query: 'grocery', limit: 10 },
      loaders,
    );

    expect(out.transactions).toHaveLength(2);
    expect(out.transactions[0]).toEqual({
      entry_id: 'e1',
      date: '2026-03-15',
      amount: '-42.50',
      description: 'GROCERY STORE',
      category_name: 'Groceries',
      account_name: 'Checking',
    });
    expect(out.total).toBe(2);
  });

  it('clamps limit to 50 when a larger value is provided', async () => {
    let capturedLimit = 0;
    const loaders = makeLoaders({
      loadTransactions: async (params) => {
        capturedLimit = params.limit;
        return { rows: [], total: 0 };
      },
    });

    await findTransactionsTool({ limit: 200 }, loaders);
    expect(capturedLimit).toBe(50);
  });

  it('defaults limit to 50 when omitted', async () => {
    let capturedLimit = 0;
    const loaders = makeLoaders({
      loadTransactions: async (params) => {
        capturedLimit = params.limit;
        return { rows: [], total: 0 };
      },
    });

    await findTransactionsTool({}, loaders);
    expect(capturedLimit).toBe(50);
  });

  it('returns empty transactions array when no results match', async () => {
    const loaders = makeLoaders();

    const out = await findTransactionsTool(
      { query: 'nonexistent', filters: { start_date: '2026-01-01', end_date: '2026-02-01' } },
      loaders,
    );

    expect(out.transactions).toEqual([]);
    expect(out.total).toBe(0);
  });

  it('passes structured filters through to the loader', async () => {
    let capturedFilters: Record<string, unknown> = {};
    const loaders = makeLoaders({
      loadTransactions: async (params) => {
        capturedFilters = params.filters ?? {};
        return { rows: [], total: 0 };
      },
    });

    await findTransactionsTool(
      {
        filters: {
          account_id: 'acc-1',
          category_id: 'cat-1',
          start_date: '2026-03-01',
          end_date: '2026-04-01',
          min_amount: '10.00',
          max_amount: '100.00',
        },
      },
      loaders,
    );

    expect(capturedFilters).toEqual({
      accountId: 'acc-1',
      categoryId: 'cat-1',
      startDate: '2026-03-01',
      endDate: '2026-04-01',
      minAmount: '10.00',
      maxAmount: '100.00',
    });
  });

  it('strips PII from transaction descriptions', async () => {
    const loaders = makeLoaders({
      loadTransactions: async () => ({
        rows: [
          {
            entryId: 'e1',
            date: '2026-03-15',
            amount: '-10.00',
            description: 'Customer: Jane Doe payment',
            categoryName: 'Transfers',
            accountName: 'Checking',
          },
        ],
        total: 1,
      }),
    });

    const out = await findTransactionsTool({}, loaders);

    expect(out.transactions[0]?.description).not.toContain('Jane Doe');
    expect(out.transactions[0]?.description).toContain('[name]');
  });

  it('handles null category names', async () => {
    const loaders = makeLoaders({
      loadTransactions: async () => ({
        rows: [
          {
            entryId: 'e1',
            date: '2026-03-15',
            amount: '-10.00',
            description: 'UNKNOWN MERCHANT',
            categoryName: null,
            accountName: 'Checking',
          },
        ],
        total: 1,
      }),
    });

    const out = await findTransactionsTool({}, loaders);
    expect(out.transactions[0]?.category_name).toBeNull();
  });
});
