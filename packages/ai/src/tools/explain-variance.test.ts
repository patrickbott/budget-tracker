import { describe, expect, it } from 'vitest';

import { explainVarianceTool } from './explain-variance.ts';
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

function entry(
  id: string,
  date: string,
  amount: string,
  catId: string,
) {
  return {
    entryId: id,
    entryDate: date,
    amountSigned: amount,
    accountId: 'acc1',
    categoryId: catId,
    isTransfer: false,
  };
}

function txnRow(
  id: string,
  date: string,
  amount: string,
  description: string,
) {
  return {
    entryId: id,
    date,
    amount,
    description,
    categoryName: 'Dining',
    accountName: 'Checking',
  };
}

describe('explainVarianceTool', () => {
  it('computes variance with driver transactions between two periods', async () => {
    // Period: April 1 → May 1 (30 days). Prior: March 2 → April 1 (30 days).
    const loaders = makeLoaders({
      loadEntries: async (window) => {
        // Current period: April
        if (window.start === '2026-04-01') {
          return [
            entry('e1', '2026-04-05', '-80.0000', 'cat-dining'),
            entry('e2', '2026-04-15', '-120.0000', 'cat-dining'),
          ];
        }
        // Prior period: March 2 → April 1
        if (window.start === '2026-03-02') {
          return [
            entry('e3', '2026-03-10', '-50.0000', 'cat-dining'),
          ];
        }
        return [];
      },
      loadTransactions: async (params) => {
        if (params.filters?.startDate === '2026-04-01') {
          return {
            rows: [
              txnRow('e1', '2026-04-05', '-80.0000', 'Fancy Restaurant'),
              txnRow('e2', '2026-04-15', '-120.0000', 'New Place'),
            ],
            total: 2,
          };
        }
        if (params.filters?.startDate === '2026-03-02') {
          return {
            rows: [
              txnRow('e3', '2026-03-10', '-50.0000', 'Fancy Restaurant'),
            ],
            total: 1,
          };
        }
        return { rows: [], total: 0 };
      },
      loadCategoryNameMap: async () =>
        new Map([['cat-dining', 'Dining']]),
    });

    const out = await explainVarianceTool(
      {
        category_id: 'cat-dining',
        period_start: '2026-04-01',
        period_end: '2026-05-01',
      },
      loaders,
    );

    expect(out.category_name).toBe('Dining');
    expect(out.current_period.total).toBe('200.00');
    expect(out.prior_period.total).toBe('50.00');
    expect(out.change_amount).toBe('150.00');
    expect(out.change_percent).toBe('300');

    // 'New Place' is a new merchant and should be flagged
    expect(out.drivers.length).toBeGreaterThanOrEqual(1);
    const newDriver = out.drivers.find((d) => d.description === 'New Place');
    expect(newDriver).toBeDefined();
    expect(newDriver!.is_new).toBe(true);
  });

  it('handles category with spending decrease', async () => {
    // Period: April 1 → May 1 (30 days). Prior: March 2 → April 1.
    const loaders = makeLoaders({
      loadEntries: async (window) => {
        if (window.start === '2026-04-01') {
          return [entry('e1', '2026-04-05', '-30.0000', 'cat-a')];
        }
        if (window.start === '2026-03-02') {
          return [entry('e2', '2026-03-10', '-100.0000', 'cat-a')];
        }
        return [];
      },
      loadTransactions: async (params) => {
        if (params.filters?.startDate === '2026-04-01') {
          return {
            rows: [txnRow('e1', '2026-04-05', '-30.0000', 'Store A')],
            total: 1,
          };
        }
        if (params.filters?.startDate === '2026-03-02') {
          return {
            rows: [txnRow('e2', '2026-03-10', '-100.0000', 'Store A')],
            total: 1,
          };
        }
        return { rows: [], total: 0 };
      },
      loadCategoryNameMap: async () => new Map([['cat-a', 'Shopping']]),
    });

    const out = await explainVarianceTool(
      {
        category_id: 'cat-a',
        period_start: '2026-04-01',
        period_end: '2026-05-01',
      },
      loaders,
    );

    expect(out.change_amount).toBe('-70.00');
    expect(out.change_percent).toBe('-70');
  });

  it('handles category with no change (both periods equal)', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        entry('e1', '2026-04-05', '-50.0000', 'cat-x'),
      ],
      loadTransactions: async () => ({
        rows: [txnRow('e1', '2026-04-05', '-50.0000', 'Same Store')],
        total: 1,
      }),
      loadCategoryNameMap: async () => new Map([['cat-x', 'TestCat']]),
    });

    const out = await explainVarianceTool(
      {
        category_id: 'cat-x',
        period_start: '2026-04-01',
        period_end: '2026-05-01',
      },
      loaders,
    );

    expect(out.change_amount).toBe('0.00');
  });

  it('handles missing category (zero spending both periods)', async () => {
    const loaders = makeLoaders({
      loadCategoryNameMap: async () => new Map([['cat-gone', 'Gone']]),
    });

    const out = await explainVarianceTool(
      {
        category_id: 'cat-gone',
        period_start: '2026-04-01',
        period_end: '2026-05-01',
      },
      loaders,
    );

    expect(out.current_period.total).toBe('0.00');
    expect(out.prior_period.total).toBe('0.00');
    expect(out.change_amount).toBe('0.00');
    expect(out.change_percent).toBeNull(); // prior is zero → null
    expect(out.drivers).toHaveLength(0);
  });

  it('excludes transfers and income from totals', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        entry('e1', '2026-04-05', '-50.0000', 'cat-a'),
        { ...entry('e2', '2026-04-06', '-30.0000', 'cat-a'), isTransfer: true },
        entry('e3', '2026-04-07', '100.0000', 'cat-a'), // income
      ],
      loadTransactions: async () => ({
        rows: [txnRow('e1', '2026-04-05', '-50.0000', 'Real Spend')],
        total: 1,
      }),
      loadCategoryNameMap: async () => new Map([['cat-a', 'Test']]),
    });

    const out = await explainVarianceTool(
      {
        category_id: 'cat-a',
        period_start: '2026-04-01',
        period_end: '2026-05-01',
      },
      loaders,
    );

    expect(out.current_period.total).toBe('50.00');
  });

  it('falls back to raw ID when category name is unknown', async () => {
    const loaders = makeLoaders({
      loadCategoryNameMap: async () => new Map(),
    });

    const out = await explainVarianceTool(
      {
        category_id: 'cat-unknown-uuid',
        period_start: '2026-04-01',
        period_end: '2026-05-01',
      },
      loaders,
    );

    expect(out.category_name).toBe('cat-unknown-uuid');
  });
});
