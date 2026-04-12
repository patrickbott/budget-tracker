import { describe, expect, it } from 'vitest';

import { budgetStatusTool } from './budget-status.ts';
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

describe('budgetStatusTool', () => {
  it('returns on_track when spend is below 80%', async () => {
    const loaders = makeLoaders({
      loadBudgetStatus: async () => [
        {
          categoryName: 'Groceries',
          budgetMode: 'hard_cap' as const,
          budgetAmount: '500.00',
          actualSpend: '200.00',
        },
      ],
    });

    const out = await budgetStatusTool(
      { period_start: '2026-03-01', period_end: '2026-04-01' },
      loaders,
    );

    expect(out.categories).toHaveLength(1);
    expect(out.categories[0]).toEqual({
      category_name: 'Groceries',
      budget_mode: 'hard_cap',
      budget_amount: '500.00',
      actual_spend: '200.00',
      remaining: '300.00',
      percent_used: 40,
      status: 'on_track',
    });
  });

  it('returns warning when spend is exactly 80%', async () => {
    const loaders = makeLoaders({
      loadBudgetStatus: async () => [
        {
          categoryName: 'Dining',
          budgetMode: 'forecast' as const,
          budgetAmount: '100.00',
          actualSpend: '80.00',
        },
      ],
    });

    const out = await budgetStatusTool(
      { period_start: '2026-03-01', period_end: '2026-04-01' },
      loaders,
    );

    expect(out.categories[0]?.status).toBe('warning');
    expect(out.categories[0]?.percent_used).toBe(80);
  });

  it('returns warning when spend is between 80% and 100%', async () => {
    const loaders = makeLoaders({
      loadBudgetStatus: async () => [
        {
          categoryName: 'Entertainment',
          budgetMode: 'hard_cap' as const,
          budgetAmount: '200.00',
          actualSpend: '180.00',
        },
      ],
    });

    const out = await budgetStatusTool(
      { period_start: '2026-03-01', period_end: '2026-04-01' },
      loaders,
    );

    expect(out.categories[0]?.status).toBe('warning');
    expect(out.categories[0]?.percent_used).toBe(90);
  });

  it('returns over_budget when spend is exactly 100%', async () => {
    const loaders = makeLoaders({
      loadBudgetStatus: async () => [
        {
          categoryName: 'Transport',
          budgetMode: 'hard_cap' as const,
          budgetAmount: '150.00',
          actualSpend: '150.00',
        },
      ],
    });

    const out = await budgetStatusTool(
      { period_start: '2026-03-01', period_end: '2026-04-01' },
      loaders,
    );

    expect(out.categories[0]?.status).toBe('over_budget');
    expect(out.categories[0]?.percent_used).toBe(100);
    expect(out.categories[0]?.remaining).toBe('0.00');
  });

  it('returns over_budget when spend exceeds budget', async () => {
    const loaders = makeLoaders({
      loadBudgetStatus: async () => [
        {
          categoryName: 'Shopping',
          budgetMode: 'forecast' as const,
          budgetAmount: '300.00',
          actualSpend: '450.00',
        },
      ],
    });

    const out = await budgetStatusTool(
      { period_start: '2026-03-01', period_end: '2026-04-01' },
      loaders,
    );

    expect(out.categories[0]?.status).toBe('over_budget');
    expect(out.categories[0]?.percent_used).toBe(150);
    expect(out.categories[0]?.remaining).toBe('-150.00');
  });

  it('handles zero budget amount gracefully', async () => {
    const loaders = makeLoaders({
      loadBudgetStatus: async () => [
        {
          categoryName: 'Misc',
          budgetMode: 'hard_cap' as const,
          budgetAmount: '0.00',
          actualSpend: '25.00',
        },
      ],
    });

    const out = await budgetStatusTool(
      { period_start: '2026-03-01', period_end: '2026-04-01' },
      loaders,
    );

    expect(out.categories[0]?.percent_used).toBe(100);
    expect(out.categories[0]?.status).toBe('over_budget');
  });

  it('handles zero budget and zero spend as on_track', async () => {
    const loaders = makeLoaders({
      loadBudgetStatus: async () => [
        {
          categoryName: 'Unused',
          budgetMode: 'forecast' as const,
          budgetAmount: '0.00',
          actualSpend: '0.00',
        },
      ],
    });

    const out = await budgetStatusTool(
      { period_start: '2026-03-01', period_end: '2026-04-01' },
      loaders,
    );

    expect(out.categories[0]?.percent_used).toBe(0);
    expect(out.categories[0]?.status).toBe('on_track');
  });

  it('returns empty categories array when no budgets exist', async () => {
    const loaders = makeLoaders();

    const out = await budgetStatusTool(
      { period_start: '2026-03-01', period_end: '2026-04-01' },
      loaders,
    );

    expect(out.categories).toEqual([]);
  });

  it('strips PII from category names', async () => {
    const loaders = makeLoaders({
      loadBudgetStatus: async () => [
        {
          categoryName: 'Customer: Jane Doe expenses',
          budgetMode: 'hard_cap' as const,
          budgetAmount: '100.00',
          actualSpend: '50.00',
        },
      ],
    });

    const out = await budgetStatusTool(
      { period_start: '2026-03-01', period_end: '2026-04-01' },
      loaders,
    );

    expect(out.categories[0]?.category_name).not.toContain('Jane Doe');
    expect(out.categories[0]?.category_name).toContain('[name]');
  });
});
