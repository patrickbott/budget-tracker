import { describe, expect, it } from 'vitest';

import { comparePeriodsTool } from './compare-periods.ts';
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

describe('comparePeriodsTool', () => {
  it('computes per-category deltas across two windows', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        // Window A — February
        {
          entryId: 'e1',
          entryDate: '2026-02-05',
          amountSigned: '-100.00',
          accountId: 'a1',
          categoryId: 'cat-groceries',
          isTransfer: false,
        },
        {
          entryId: 'e2',
          entryDate: '2026-02-20',
          amountSigned: '-50.00',
          accountId: 'a1',
          categoryId: 'cat-dining',
          isTransfer: false,
        },
        // Window B — March
        {
          entryId: 'e3',
          entryDate: '2026-03-05',
          amountSigned: '-250.00',
          accountId: 'a1',
          categoryId: 'cat-groceries',
          isTransfer: false,
        },
      ],
      loadCategoryNameMap: async () =>
        new Map([
          ['cat-groceries', 'Groceries'],
          ['cat-dining', 'Dining'],
        ]),
    });

    const out = await comparePeriodsTool(
      {
        window_a_start: '2026-02-01',
        window_a_end: '2026-03-01',
        window_b_start: '2026-03-01',
        window_b_end: '2026-04-01',
        dimension: 'category',
      },
      loaders,
    );

    expect(out.dimension).toBe('category');
    // Sorted by |delta| DESC: groceries (|+150|) > dining (|-50|).
    expect(out.rows).toEqual([
      {
        dimension_id: 'cat-groceries',
        dimension_name: 'Groceries',
        a: '100.00',
        b: '250.00',
        delta: '150.00',
      },
      {
        dimension_id: 'cat-dining',
        dimension_name: 'Dining',
        a: '50.00',
        b: '0.00',
        delta: '-50.00',
      },
    ]);
  });

  it('returns an empty rows array when both windows are empty', async () => {
    const loaders = makeLoaders();

    const out = await comparePeriodsTool(
      {
        window_a_start: '2026-02-01',
        window_a_end: '2026-03-01',
        window_b_start: '2026-03-01',
        window_b_end: '2026-04-01',
        dimension: 'category',
      },
      loaders,
    );

    expect(out.rows).toEqual([]);
  });

  it('uses the account name map when dimension is "account"', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-02-05',
          amountSigned: '-100.00',
          accountId: 'a1',
          categoryId: 'cat-x',
          isTransfer: false,
        },
        {
          entryId: 'e2',
          entryDate: '2026-03-10',
          amountSigned: '-80.00',
          accountId: 'a1',
          categoryId: 'cat-x',
          isTransfer: false,
        },
      ],
      loadAccountNameMap: async () => new Map([['a1', 'Chase Checking']]),
      loadCategoryNameMap: async () => new Map(), // should not be consulted
    });

    const out = await comparePeriodsTool(
      {
        window_a_start: '2026-02-01',
        window_a_end: '2026-03-01',
        window_b_start: '2026-03-01',
        window_b_end: '2026-04-01',
        dimension: 'account',
      },
      loaders,
    );

    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.dimension_id).toBe('a1');
    expect(out.rows[0]?.dimension_name).toBe('Chase Checking');
  });

  it('strips PII from a leaking account-name lookup', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-02-05',
          amountSigned: '-100.00',
          accountId: 'a1',
          categoryId: 'cat-x',
          isTransfer: false,
        },
      ],
      loadAccountNameMap: async () =>
        new Map([['a1', 'Customer: Jane Doe checking']]),
    });

    const out = await comparePeriodsTool(
      {
        window_a_start: '2026-02-01',
        window_a_end: '2026-03-01',
        window_b_start: '2026-03-01',
        window_b_end: '2026-04-01',
        dimension: 'account',
      },
      loaders,
    );

    expect(out.rows[0]?.dimension_name).not.toContain('Jane Doe');
    expect(out.rows[0]?.dimension_name).toContain('[name]');
  });
});
