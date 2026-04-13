import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { savingOpportunitiesTool } from './saving-opportunities.ts';
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

describe('savingOpportunitiesTool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 12)); // April 12, 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('detects over-budget categories', async () => {
    const loaders = makeLoaders({
      loadBudgetStatus: async () => [
        {
          categoryName: 'Dining',
          budgetMode: 'hard_cap' as const,
          budgetAmount: '200.00',
          actualSpend: '350.00',
        },
      ],
    });

    const out = await savingOpportunitiesTool({}, loaders);

    const overBudget = out.opportunities.filter(
      (o) => o.type === 'over_budget',
    );
    expect(overBudget).toHaveLength(1);
    expect(overBudget[0]!.potential_savings).toBe('150.00');
    expect(overBudget[0]!.description).toContain('Dining');
  });

  it('detects high-spend categories (>20% increase AND >$50)', async () => {
    const loaders = makeLoaders({
      loadEntries: async (window) => {
        // Current month: April
        if (window.start === '2026-04-01') {
          return [
            {
              entryId: 'e1',
              entryDate: '2026-04-05',
              amountSigned: '-400.0000',
              accountId: 'acc1',
              categoryId: 'cat-shop',
              isTransfer: false,
            },
          ];
        }
        // Prior month: March
        if (window.start === '2026-03-01') {
          return [
            {
              entryId: 'e2',
              entryDate: '2026-03-05',
              amountSigned: '-200.0000',
              accountId: 'acc1',
              categoryId: 'cat-shop',
              isTransfer: false,
            },
          ];
        }
        return [];
      },
      loadCategoryNameMap: async () =>
        new Map([['cat-shop', 'Shopping']]),
    });

    const out = await savingOpportunitiesTool({}, loaders);

    const highSpend = out.opportunities.filter(
      (o) => o.type === 'high_spend',
    );
    expect(highSpend).toHaveLength(1);
    expect(highSpend[0]!.potential_savings).toBe('200.00');
    expect(highSpend[0]!.description).toContain('Shopping');
    expect(highSpend[0]!.description).toContain('100%');
  });

  it('does NOT flag high-spend when increase is <$50', async () => {
    const loaders = makeLoaders({
      loadEntries: async (window) => {
        if (window.start === '2026-04-01') {
          return [
            {
              entryId: 'e1',
              entryDate: '2026-04-05',
              amountSigned: '-60.0000',
              accountId: 'acc1',
              categoryId: 'cat-x',
              isTransfer: false,
            },
          ];
        }
        if (window.start === '2026-03-01') {
          return [
            {
              entryId: 'e2',
              entryDate: '2026-03-05',
              amountSigned: '-30.0000',
              accountId: 'acc1',
              categoryId: 'cat-x',
              isTransfer: false,
            },
          ];
        }
        return [];
      },
      loadCategoryNameMap: async () => new Map([['cat-x', 'Small']]),
    });

    const out = await savingOpportunitiesTool({}, loaders);

    const highSpend = out.opportunities.filter(
      (o) => o.type === 'high_spend',
    );
    expect(highSpend).toHaveLength(0);
  });

  it('detects stale subscriptions', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Old Streaming',
          amount: '-12.99',
          cadence: 'monthly',
          lastSeenDate: '2026-02-01', // ~70 days ago
          nextExpectedDate: '2026-03-01',
          missingDates: ['2026-03-01'],
        },
      ],
    });

    const out = await savingOpportunitiesTool({}, loaders);

    const subs = out.opportunities.filter(
      (o) => o.type === 'stale_subscription',
    );
    expect(subs).toHaveLength(1);
    expect(subs[0]!.description).toContain('Old Streaming');
    expect(subs[0]!.potential_savings).toBe('155.88'); // 12.99 * 12
  });

  it('detects fee accumulation from transactions', async () => {
    const loaders = makeLoaders({
      loadTransactions: async () => ({
        rows: [
          {
            entryId: 'f1',
            date: '2026-04-01',
            amount: '-3.50',
            description: 'ATM Fee',
            categoryName: 'Fees',
            accountName: 'Checking',
          },
          {
            entryId: 'f2',
            date: '2026-04-05',
            amount: '-35.00',
            description: 'Overdraft fee',
            categoryName: 'Fees',
            accountName: 'Checking',
          },
        ],
        total: 2,
      }),
    });

    const out = await savingOpportunitiesTool({}, loaders);

    const fees = out.opportunities.filter(
      (o) => o.type === 'fee_accumulation',
    );
    expect(fees).toHaveLength(1);
    expect(fees[0]!.potential_savings).toBe('38.50');
    expect(fees[0]!.description).toContain('2 fee charges');
  });

  it('returns empty array when no opportunities exist', async () => {
    const loaders = makeLoaders();

    const out = await savingOpportunitiesTool({}, loaders);

    expect(out.opportunities).toEqual([]);
  });

  it('sorts opportunities by potential savings descending', async () => {
    const loaders = makeLoaders({
      loadBudgetStatus: async () => [
        {
          categoryName: 'Small Overage',
          budgetMode: 'hard_cap' as const,
          budgetAmount: '100.00',
          actualSpend: '110.00', // $10 over
        },
        {
          categoryName: 'Big Overage',
          budgetMode: 'hard_cap' as const,
          budgetAmount: '500.00',
          actualSpend: '800.00', // $300 over
        },
      ],
    });

    const out = await savingOpportunitiesTool({}, loaders);

    expect(out.opportunities).toHaveLength(2);
    expect(out.opportunities[0]!.description).toContain('Big Overage');
    expect(out.opportunities[1]!.description).toContain('Small Overage');
  });

  it('does not flag active subscriptions as stale', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Active Service',
          amount: '-9.99',
          cadence: 'monthly',
          lastSeenDate: '2026-04-01', // 11 days ago — active
          nextExpectedDate: '2026-05-01',
          missingDates: [],
        },
      ],
    });

    const out = await savingOpportunitiesTool({}, loaders);

    const subs = out.opportunities.filter(
      (o) => o.type === 'stale_subscription',
    );
    expect(subs).toHaveLength(0);
  });
});
