import { describe, expect, it } from 'vitest';

import { listCategoriesTool } from './list-categories.ts';
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

describe('listCategoriesTool', () => {
  it('returns all categories with parent names', async () => {
    const loaders = makeLoaders({
      loadCategories: async () => [
        { id: 'cat-1', name: 'Food & Drink', parentName: null },
        { id: 'cat-2', name: 'Groceries', parentName: 'Food & Drink' },
        { id: 'cat-3', name: 'Dining', parentName: 'Food & Drink' },
      ],
    });

    const out = await listCategoriesTool({}, loaders);

    expect(out.categories).toEqual([
      { id: 'cat-1', name: 'Food & Drink', parent_name: null },
      { id: 'cat-2', name: 'Groceries', parent_name: 'Food & Drink' },
      { id: 'cat-3', name: 'Dining', parent_name: 'Food & Drink' },
    ]);
  });

  it('returns empty categories array when none exist', async () => {
    const loaders = makeLoaders();

    const out = await listCategoriesTool({}, loaders);

    expect(out.categories).toEqual([]);
  });

  it('strips PII from category names', async () => {
    const loaders = makeLoaders({
      loadCategories: async () => [
        { id: 'cat-1', name: 'Customer: Jane Doe fund', parentName: null },
      ],
    });

    const out = await listCategoriesTool({}, loaders);

    expect(out.categories[0]?.name).not.toContain('Jane Doe');
    expect(out.categories[0]?.name).toContain('[name]');
  });
});
