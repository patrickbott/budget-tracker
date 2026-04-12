import { describe, expect, it } from 'vitest';

import { proposeRuleTool } from './propose-rule.ts';
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

describe('proposeRuleTool', () => {
  it('extracts a rule from a typical merchant transaction', async () => {
    const loaders = makeLoaders({
      loadTransactions: async (params) => {
        // First call: find the example transaction (no query)
        // Second call: search for matches
        if (params.query) {
          return {
            rows: [
              {
                entryId: 'e1',
                date: '2026-04-05',
                amount: '-12.99',
                description: 'WHOLE FOODS MKT #1234',
                categoryName: null,
                accountName: 'Checking',
              },
              {
                entryId: 'e2',
                date: '2026-03-15',
                amount: '-15.47',
                description: 'WHOLE FOODS MKT #5678',
                categoryName: null,
                accountName: 'Checking',
              },
              {
                entryId: 'e3',
                date: '2026-03-02',
                amount: '-22.11',
                description: 'WHOLE FOODS MKT #1234',
                categoryName: 'Groceries',
                accountName: 'Checking',
              },
              {
                entryId: 'e4',
                date: '2026-02-20',
                amount: '-8.99',
                description: 'WHOLE FOODS MKT #9999',
                categoryName: null,
                accountName: 'Checking',
              },
            ],
            total: 4,
          };
        }
        return {
          rows: [
            {
              entryId: 'e1',
              date: '2026-04-05',
              amount: '-12.99',
              description: 'WHOLE FOODS MKT #1234',
              categoryName: null,
              accountName: 'Checking',
            },
          ],
          total: 1,
        };
      },
      loadCategoryNameMap: async () =>
        new Map([['cat-groceries', 'Groceries']]),
    });

    const out = await proposeRuleTool(
      { example_entry_id: 'e1', target_category_id: 'cat-groceries' },
      loaders,
    );

    expect(out.rule.conditions).toContainEqual({
      field: 'description',
      operator: 'contains',
      value: 'WHOLE FOODS MKT',
    });
    expect(out.rule.actions).toContainEqual({
      type: 'set_category',
      value: 'cat-groceries',
    });
    expect(out.rule.matching_count).toBe(4);
    expect(out.rule.confidence).toBe('high');
    expect(out.rule.explanation).toContain('Groceries');
  });

  it('returns low confidence when example transaction is not found', async () => {
    const loaders = makeLoaders({
      loadCategoryNameMap: async () =>
        new Map([['cat-x', 'Test Category']]),
    });

    const out = await proposeRuleTool(
      { example_entry_id: 'nonexistent', target_category_id: 'cat-x' },
      loaders,
    );

    expect(out.rule.confidence).toBe('low');
    expect(out.rule.matching_count).toBe(0);
    expect(out.rule.conditions).toHaveLength(0);
  });

  it('includes amount range condition', async () => {
    const loaders = makeLoaders({
      loadTransactions: async (params) => {
        if (!params.query) {
          return {
            rows: [
              {
                entryId: 'e1',
                date: '2026-04-05',
                amount: '-50.00',
                description: 'GYM MEMBERSHIP',
                categoryName: null,
                accountName: 'Checking',
              },
            ],
            total: 1,
          };
        }
        return {
          rows: [
            {
              entryId: 'e1',
              date: '2026-04-05',
              amount: '-50.00',
              description: 'GYM MEMBERSHIP',
              categoryName: null,
              accountName: 'Checking',
            },
          ],
          total: 1,
        };
      },
      loadCategoryNameMap: async () => new Map([['cat-fit', 'Fitness']]),
    });

    const out = await proposeRuleTool(
      { example_entry_id: 'e1', target_category_id: 'cat-fit' },
      loaders,
    );

    const amountCond = out.rule.conditions.find(
      (c) => c.field === 'amount',
    );
    expect(amountCond).toBeDefined();
    expect(amountCond!.operator).toBe('between');
    // 50.00 ± 20% = 40.00:60.00
    expect(amountCond!.value).toBe('40.00:60.00');
  });

  it('handles very short descriptions gracefully', async () => {
    const loaders = makeLoaders({
      loadTransactions: async (params) => {
        if (!params.query) {
          return {
            rows: [
              {
                entryId: 'e1',
                date: '2026-04-05',
                amount: '-5.00',
                description: 'ATM',
                categoryName: null,
                accountName: 'Checking',
              },
            ],
            total: 1,
          };
        }
        return { rows: [], total: 0 };
      },
      loadCategoryNameMap: async () => new Map([['cat-a', 'Banking']]),
    });

    const out = await proposeRuleTool(
      { example_entry_id: 'e1', target_category_id: 'cat-a' },
      loaders,
    );

    expect(out.rule.conditions).toContainEqual({
      field: 'description',
      operator: 'contains',
      value: 'ATM',
    });
  });

  it('strips trailing reference numbers from description pattern', async () => {
    const loaders = makeLoaders({
      loadTransactions: async (params) => {
        if (!params.query) {
          return {
            rows: [
              {
                entryId: 'e1',
                date: '2026-04-05',
                amount: '-25.00',
                description: 'AMAZON MARKETPLACE #REF-99887',
                categoryName: null,
                accountName: 'Checking',
              },
            ],
            total: 1,
          };
        }
        return {
          rows: [
            {
              entryId: 'e1',
              date: '2026-04-05',
              amount: '-25.00',
              description: 'AMAZON MARKETPLACE #REF-99887',
              categoryName: null,
              accountName: 'Checking',
            },
          ],
          total: 1,
        };
      },
      loadCategoryNameMap: async () =>
        new Map([['cat-shop', 'Shopping']]),
    });

    const out = await proposeRuleTool(
      { example_entry_id: 'e1', target_category_id: 'cat-shop' },
      loaders,
    );

    const descCond = out.rule.conditions.find(
      (c) => c.field === 'description',
    );
    expect(descCond!.value).toBe('AMAZON MARKETPLACE');
  });

  it('returns medium confidence with 1-3 matches', async () => {
    const loaders = makeLoaders({
      loadTransactions: async (params) => {
        const rows = [
          {
            entryId: 'e1',
            date: '2026-04-05',
            amount: '-10.00',
            description: 'SOME STORE',
            categoryName: null,
            accountName: 'Checking',
          },
          {
            entryId: 'e2',
            date: '2026-03-15',
            amount: '-12.00',
            description: 'SOME STORE',
            categoryName: null,
            accountName: 'Checking',
          },
        ];
        if (!params.query) {
          return { rows: [rows[0]!], total: 1 };
        }
        return { rows, total: 2 };
      },
      loadCategoryNameMap: async () => new Map([['cat-a', 'Test']]),
    });

    const out = await proposeRuleTool(
      { example_entry_id: 'e1', target_category_id: 'cat-a' },
      loaders,
    );

    expect(out.rule.confidence).toBe('medium');
    expect(out.rule.matching_count).toBe(2);
  });
});
