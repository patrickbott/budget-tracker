import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const txnRow = (
  id: string,
  date: string,
  amount: string,
  description: string,
) => ({
  entryId: id,
  date,
  amount,
  description,
  categoryName: null as string | null,
  accountName: 'Checking',
});

describe('proposeRuleTool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 12)); // April 12, 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('extracts a rule from a typical merchant transaction', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-04-05',
          amountSigned: '-12.9900',
          accountId: 'acc1',
          categoryId: 'cat-groceries',
          isTransfer: false,
        },
      ],
      loadTransactions: async (params) => {
        // Query call: search for matches by merchant pattern
        if (params.query) {
          return {
            rows: [
              txnRow('e1', '2026-04-05', '-12.99', 'WHOLE FOODS MKT #1234'),
              txnRow('e2', '2026-03-15', '-15.47', 'WHOLE FOODS MKT #5678'),
              txnRow('e3', '2026-03-02', '-22.11', 'WHOLE FOODS MKT #1234'),
              txnRow('e4', '2026-02-20', '-8.99', 'WHOLE FOODS MKT #9999'),
            ],
            total: 4,
          };
        }
        // Date-filtered call: find the example by date
        return {
          rows: [
            txnRow('e1', '2026-04-05', '-12.99', 'WHOLE FOODS MKT #1234'),
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

  it('returns low confidence when entry is not found in loadEntries', async () => {
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
    expect(out.rule.explanation).toContain('Could not find');
  });

  it('includes amount range condition', async () => {
    const loaders = makeLoaders({
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-04-05',
          amountSigned: '-50.0000',
          accountId: 'acc1',
          categoryId: null,
          isTransfer: false,
        },
      ],
      loadTransactions: async (params) => {
        if (params.query) {
          return {
            rows: [txnRow('e1', '2026-04-05', '-50.00', 'GYM MEMBERSHIP')],
            total: 1,
          };
        }
        return {
          rows: [txnRow('e1', '2026-04-05', '-50.00', 'GYM MEMBERSHIP')],
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
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-04-05',
          amountSigned: '-5.0000',
          accountId: 'acc1',
          categoryId: null,
          isTransfer: false,
        },
      ],
      loadTransactions: async (params) => {
        if (!params.query) {
          return {
            rows: [txnRow('e1', '2026-04-05', '-5.00', 'ATM')],
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
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-04-05',
          amountSigned: '-25.0000',
          accountId: 'acc1',
          categoryId: null,
          isTransfer: false,
        },
      ],
      loadTransactions: async (params) => {
        const row = txnRow(
          'e1',
          '2026-04-05',
          '-25.00',
          'AMAZON MARKETPLACE #REF-99887',
        );
        if (params.query) {
          return { rows: [row], total: 1 };
        }
        return { rows: [row], total: 1 };
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
      loadEntries: async () => [
        {
          entryId: 'e1',
          entryDate: '2026-04-05',
          amountSigned: '-10.0000',
          accountId: 'acc1',
          categoryId: null,
          isTransfer: false,
        },
      ],
      loadTransactions: async (params) => {
        const rows = [
          txnRow('e1', '2026-04-05', '-10.00', 'SOME STORE'),
          txnRow('e2', '2026-03-15', '-12.00', 'SOME STORE'),
        ];
        if (params.query) {
          return { rows, total: 2 };
        }
        return { rows: [rows[0]!], total: 1 };
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
