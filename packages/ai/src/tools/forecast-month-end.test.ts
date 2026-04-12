import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forecastMonthEndTool } from './forecast-month-end.ts';
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
    ...overrides,
  };
}

describe('forecastMonthEndTool', () => {
  beforeEach(() => {
    // Fix "today" to April 12, 2026 for deterministic tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 12)); // month is 0-indexed
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('projects spending for a category with daily history', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        // 12 days of groceries spending ~$20/day
        ...Array.from({ length: 12 }, (_, i) => ({
          entryId: `e${i}`,
          entryDate: `2026-04-${String(i + 1).padStart(2, '0')}`,
          amountSigned: '-20.0000',
          accountId: 'acc1',
          categoryId: 'cat-groceries',
          isTransfer: false,
        })),
      ],
      loadBudgetStatus: async () => [
        {
          categoryName: 'Groceries',
          budgetMode: 'hard_cap' as const,
          budgetAmount: '500.00',
          actualSpend: '240.00',
        },
      ],
      loadCategoryNameMap: async () =>
        new Map([['cat-groceries', 'Groceries']]),
    });

    const out = await forecastMonthEndTool({}, loaders);

    expect(out.forecast_date).toBe('2026-04-30');
    expect(out.days_remaining).toBe(18);
    expect(out.categories).toHaveLength(1);

    const cat = out.categories[0]!;
    expect(cat.category_id).toBe('cat-groceries');
    expect(cat.category_name).toBe('Groceries');
    expect(cat.current_spend).toBe('240.00');
    // 12 days of $20 = $240 actual, avg daily $20, 18 days left → projected $240 + 18*$20 = $600
    expect(cat.projected_spend).toBe('600.00');
    expect(cat.confidence).toBe('medium'); // 12 days history → medium
    expect(cat.budget_amount).toBe('500.00');
    expect(cat.budget_mode).toBe('hard_cap');
    expect(cat.on_track).toBe(false); // $600 > $500
  });

  it('returns on_track true when projection is under budget', async () => {
    const loaders = makeLoaders({
      loadEntries: async () =>
        Array.from({ length: 12 }, (_, i) => ({
          entryId: `e${i}`,
          entryDate: `2026-04-${String(i + 1).padStart(2, '0')}`,
          amountSigned: '-10.0000',
          accountId: 'acc1',
          categoryId: 'cat-dining',
          isTransfer: false,
        })),
      loadBudgetStatus: async () => [
        {
          categoryName: 'Dining',
          budgetMode: 'forecast' as const,
          budgetAmount: '500.00',
          actualSpend: '120.00',
        },
      ],
      loadCategoryNameMap: async () =>
        new Map([['cat-dining', 'Dining']]),
    });

    const out = await forecastMonthEndTool({}, loaders);

    const cat = out.categories[0]!;
    // $120 actual + 18 * $10 = $300, under $500 budget
    expect(cat.projected_spend).toBe('300.00');
    expect(cat.on_track).toBe(true);
  });

  it('filters to a single category when category_id is provided', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-04-05',
          amountSigned: '-50.0000',
          accountId: 'acc1',
          categoryId: 'cat-a',
          isTransfer: false,
        },
        {
          entryId: 'e2',
          entryDate: '2026-04-05',
          amountSigned: '-30.0000',
          accountId: 'acc1',
          categoryId: 'cat-b',
          isTransfer: false,
        },
      ],
      loadCategoryNameMap: async () =>
        new Map([
          ['cat-a', 'Category A'],
          ['cat-b', 'Category B'],
        ]),
    });

    const out = await forecastMonthEndTool(
      { category_id: 'cat-a' },
      loaders,
    );

    expect(out.categories).toHaveLength(1);
    expect(out.categories[0]!.category_id).toBe('cat-a');
  });

  it('handles first day of month (no history yet)', async () => {
    vi.setSystemTime(new Date(2026, 3, 1)); // April 1

    const loaders = makeLoaders({
      loadCategoryNameMap: async () =>
        new Map([['cat-x', 'Test Category']]),
    });

    const out = await forecastMonthEndTool({}, loaders);

    expect(out.days_remaining).toBe(29);
    expect(out.categories).toHaveLength(0);
  });

  it('handles category_id with no entries (empty forecast)', async () => {
    const loaders = makeLoaders({
      loadCategoryNameMap: async () =>
        new Map([['cat-empty', 'Empty Cat']]),
    });

    const out = await forecastMonthEndTool(
      { category_id: 'cat-empty' },
      loaders,
    );

    expect(out.categories).toHaveLength(1);
    const cat = out.categories[0]!;
    expect(cat.current_spend).toBe('0.00');
    expect(cat.projected_spend).toBe('0.00');
    expect(cat.confidence).toBe('low');
    expect(cat.on_track).toBe(true); // no budget → on track
  });

  it('excludes transfers and income (positive amounts)', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-04-05',
          amountSigned: '-100.0000',
          accountId: 'acc1',
          categoryId: 'cat-a',
          isTransfer: false,
        },
        {
          entryId: 'e2',
          entryDate: '2026-04-05',
          amountSigned: '-50.0000',
          accountId: 'acc1',
          categoryId: 'cat-a',
          isTransfer: true, // transfer — should be excluded
        },
        {
          entryId: 'e3',
          entryDate: '2026-04-06',
          amountSigned: '200.0000', // income — should be excluded
          accountId: 'acc1',
          categoryId: 'cat-a',
          isTransfer: false,
        },
      ],
      loadCategoryNameMap: async () =>
        new Map([['cat-a', 'Test']]),
    });

    const out = await forecastMonthEndTool({}, loaders);

    expect(out.categories).toHaveLength(1);
    expect(out.categories[0]!.current_spend).toBe('100.00');
  });

  it('last day of month has 0 days remaining', async () => {
    vi.setSystemTime(new Date(2026, 3, 30)); // April 30

    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-04-15',
          amountSigned: '-300.0000',
          accountId: 'acc1',
          categoryId: 'cat-a',
          isTransfer: false,
        },
      ],
      loadCategoryNameMap: async () =>
        new Map([['cat-a', 'Test']]),
    });

    const out = await forecastMonthEndTool({}, loaders);

    expect(out.days_remaining).toBe(0);
    // With 0 days remaining, projected = actual
    expect(out.categories[0]!.current_spend).toBe('300.00');
    expect(out.categories[0]!.projected_spend).toBe('300.00');
  });

  it('handles December → January year rollover correctly', async () => {
    vi.setSystemTime(new Date(2026, 11, 15)); // December 15, 2026

    const loaders = makeLoaders({
      loadEntries: async () =>
        Array.from({ length: 15 }, (_, i) => ({
          entryId: `e${i}`,
          entryDate: `2026-12-${String(i + 1).padStart(2, '0')}`,
          amountSigned: '-10.0000',
          accountId: 'acc1',
          categoryId: 'cat-a',
          isTransfer: false,
        })),
      loadCategoryNameMap: async () => new Map([['cat-a', 'Test']]),
    });

    const out = await forecastMonthEndTool({}, loaders);

    expect(out.forecast_date).toBe('2026-12-31');
    expect(out.days_remaining).toBe(16);
    expect(out.categories).toHaveLength(1);
    // 15 days of $10 = $150 actual; avg $10/day; 16 days left → $150 + 16*$10 = $310
    expect(out.categories[0]!.projected_spend).toBe('310.00');
  });

  it('handles February with 28 days', async () => {
    vi.setSystemTime(new Date(2026, 1, 14)); // February 14, 2026 (non-leap)

    const loaders = makeLoaders({
      loadEntries: async () =>
        Array.from({ length: 14 }, (_, i) => ({
          entryId: `e${i}`,
          entryDate: `2026-02-${String(i + 1).padStart(2, '0')}`,
          amountSigned: '-5.0000',
          accountId: 'acc1',
          categoryId: 'cat-b',
          isTransfer: false,
        })),
      loadCategoryNameMap: async () => new Map([['cat-b', 'Short Month']]),
    });

    const out = await forecastMonthEndTool({}, loaders);

    expect(out.forecast_date).toBe('2026-02-28');
    expect(out.days_remaining).toBe(14);
    expect(out.categories).toHaveLength(1);
    // 14 days of $5 = $70; avg $5/day; 14 days left → $70 + 14*$5 = $140
    expect(out.categories[0]!.projected_spend).toBe('140.00');
  });

  it('returns empty categories when entries exist only in other categories', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-04-05',
          amountSigned: '-100.0000',
          accountId: 'acc1',
          categoryId: 'cat-other',
          isTransfer: false,
        },
      ],
      loadCategoryNameMap: async () =>
        new Map([
          ['cat-other', 'Other Category'],
          ['cat-target', 'Target'],
        ]),
    });

    // Request forecast for cat-target which has no entries
    const out = await forecastMonthEndTool(
      { category_id: 'cat-target' },
      loaders,
    );

    expect(out.categories).toHaveLength(1);
    expect(out.categories[0]!.category_id).toBe('cat-target');
    expect(out.categories[0]!.current_spend).toBe('0.00');
    expect(out.categories[0]!.projected_spend).toBe('0.00');
  });

  it('handles no budget for a category', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-04-05',
          amountSigned: '-50.0000',
          accountId: 'acc1',
          categoryId: 'cat-no-budget',
          isTransfer: false,
        },
      ],
      loadCategoryNameMap: async () =>
        new Map([['cat-no-budget', 'No Budget']]),
    });

    const out = await forecastMonthEndTool({}, loaders);

    const cat = out.categories[0]!;
    expect(cat.budget_amount).toBeNull();
    expect(cat.budget_mode).toBeNull();
    expect(cat.on_track).toBe(true); // no budget = on track
  });
});
