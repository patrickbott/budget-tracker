import { describe, expect, it } from 'vitest';

import { getCashflowTool } from './get-cashflow.ts';
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

describe('getCashflowTool', () => {
  it('buckets income and expense by month, skipping transfers', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-03-05',
          amountSigned: '2500.00',
          accountId: 'a1',
          categoryId: 'cat-salary',
          isTransfer: false,
        },
        {
          entryId: 'e2',
          entryDate: '2026-03-10',
          amountSigned: '-500.00',
          accountId: 'a1',
          categoryId: 'cat-rent',
          isTransfer: false,
        },
        // Transfer — must not affect income or expense.
        {
          entryId: 'e3',
          entryDate: '2026-03-12',
          amountSigned: '-250.00',
          accountId: 'a1',
          categoryId: null,
          isTransfer: true,
        },
      ],
    });

    const out = await getCashflowTool(
      {
        window_start: '2026-03-01',
        window_end: '2026-04-01',
        granularity: 'month',
      },
      loaders,
    );

    expect(out.granularity).toBe('month');
    expect(out.rows).toEqual([
      { period: '2026-03-01', income: '2500.00', expense: '500.00', net: '2000.00' },
    ]);
  });

  it('returns an empty rows array when no entries fall inside the window', async () => {
    const loaders = makeLoaders();

    const out = await getCashflowTool(
      {
        window_start: '2026-03-01',
        window_end: '2026-04-01',
        granularity: 'day',
      },
      loaders,
    );

    expect(out.rows).toEqual([]);
  });

  it('preserves six-figure amounts through the stripper', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-03-05',
          amountSigned: '250000.00',
          accountId: 'a1',
          categoryId: 'cat-bonus',
          isTransfer: false,
        },
      ],
    });

    const out = await getCashflowTool(
      {
        window_start: '2026-03-01',
        window_end: '2026-04-01',
        granularity: 'month',
      },
      loaders,
    );

    expect(out.rows[0]?.income).toBe('250000.00');
  });

  it('rejects an invalid granularity value', async () => {
    const loaders = makeLoaders();

    await expect(
      getCashflowTool(
        {
          window_start: '2026-03-01',
          window_end: '2026-04-01',
          // @ts-expect-error — invalid enum value on purpose
          granularity: 'quarter',
        },
        loaders,
      ),
    ).rejects.toThrow();
  });
});
