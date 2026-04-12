import { describe, expect, it } from 'vitest';

import { getSpendingByCategoryTool } from './get-spending-by-category.ts';
import type { ToolLoaders } from './types.ts';

function makeLoaders(overrides: Partial<ToolLoaders> = {}): ToolLoaders {
  return {
    loadEntries: async () => [],
    loadAccounts: async () => [],
    loadCategoryNameMap: async () => new Map(),
    loadAccountNameMap: async () => new Map(),
    ...overrides,
  };
}

describe('getSpendingByCategoryTool', () => {
  it('aggregates entries and remaps category IDs to display names', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-03-02',
          amountSigned: '-45.50',
          accountId: 'a1',
          categoryId: 'cat-groceries',
          isTransfer: false,
        },
        {
          entryId: 'e2',
          entryDate: '2026-03-15',
          amountSigned: '-12.00',
          accountId: 'a1',
          categoryId: 'cat-dining',
          isTransfer: false,
        },
        {
          entryId: 'e3',
          entryDate: '2026-03-20',
          amountSigned: '-30.00',
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

    const out = await getSpendingByCategoryTool(
      { window_start: '2026-03-01', window_end: '2026-04-01' },
      loaders,
    );

    expect(out.window).toEqual({ start: '2026-03-01', end: '2026-04-01' });
    expect(out.rows).toEqual([
      { category_id: 'cat-groceries', category_name: 'Groceries', total: '75.50' },
      { category_id: 'cat-dining', category_name: 'Dining', total: '12.00' },
    ]);
  });

  it('returns an empty rows array when the loader yields no entries', async () => {
    const loaders = makeLoaders();

    const out = await getSpendingByCategoryTool(
      { window_start: '2026-03-01', window_end: '2026-04-01' },
      loaders,
    );

    expect(out.rows).toEqual([]);
  });

  it('falls back to the raw category ID when the name map is missing it', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-03-02',
          amountSigned: '-10.00',
          accountId: 'a1',
          categoryId: 'cat-unknown',
          isTransfer: false,
        },
      ],
      loadCategoryNameMap: async () => new Map(),
    });

    const out = await getSpendingByCategoryTool(
      { window_start: '2026-03-01', window_end: '2026-04-01' },
      loaders,
    );

    expect(out.rows[0]?.category_name).toBe('cat-unknown');
  });

  it('strips PII from a leaking category-name lookup', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-03-02',
          amountSigned: '-10.00',
          accountId: 'a1',
          categoryId: 'cat-x',
          isTransfer: false,
        },
      ],
      loadCategoryNameMap: async () =>
        new Map([['cat-x', 'Customer: Jane Doe groceries']]),
    });

    const out = await getSpendingByCategoryTool(
      { window_start: '2026-03-01', window_end: '2026-04-01' },
      loaders,
    );

    expect(out.rows[0]?.category_name).not.toContain('Jane Doe');
    expect(out.rows[0]?.category_name).toContain('[name]');
  });

  it('rejects an invalid date shape at the input boundary', async () => {
    const loaders = makeLoaders();

    await expect(
      getSpendingByCategoryTool(
        { window_start: '2026-3-1', window_end: '2026-04-01' },
        loaders,
      ),
    ).rejects.toThrow();
  });
});
