import { describe, expect, it } from 'vitest';

import { recurringStatusTool } from './recurring-status.ts';
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

describe('recurringStatusTool', () => {
  it('returns on_time when no dates are missing', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Netflix',
          amount: '-15.99',
          cadence: 'monthly',
          lastSeenDate: '2026-03-01',
          nextExpectedDate: '2026-04-01',
          missingDates: [],
        },
      ],
    });

    const out = await recurringStatusTool({}, loaders);

    expect(out.series).toHaveLength(1);
    expect(out.series[0]).toEqual({
      title: 'Netflix',
      amount: '-15.99',
      cadence: 'monthly',
      last_seen_date: '2026-03-01',
      next_expected_date: '2026-04-01',
      missing_dates: [],
      status: 'on_time',
    });
  });

  it('returns late when exactly one date is missing', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Rent',
          amount: '-1500.00',
          cadence: 'monthly',
          lastSeenDate: '2026-02-01',
          nextExpectedDate: '2026-04-01',
          missingDates: ['2026-03-01'],
        },
      ],
    });

    const out = await recurringStatusTool({}, loaders);

    expect(out.series[0]?.status).toBe('late');
    expect(out.series[0]?.missing_dates).toEqual(['2026-03-01']);
  });

  it('returns missing when more than one date is missing', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Gym',
          amount: '-50.00',
          cadence: 'monthly',
          lastSeenDate: '2026-01-15',
          nextExpectedDate: '2026-04-15',
          missingDates: ['2026-02-15', '2026-03-15'],
        },
      ],
    });

    const out = await recurringStatusTool({}, loaders);

    expect(out.series[0]?.status).toBe('missing');
    expect(out.series[0]?.missing_dates).toHaveLength(2);
  });

  it('returns empty series array when no recurring transactions exist', async () => {
    const loaders = makeLoaders();

    const out = await recurringStatusTool({}, loaders);

    expect(out.series).toEqual([]);
  });

  it('handles null lastSeenDate and nextExpectedDate', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'New subscription',
          amount: '-9.99',
          cadence: 'monthly',
          lastSeenDate: null,
          nextExpectedDate: null,
          missingDates: [],
        },
      ],
    });

    const out = await recurringStatusTool({}, loaders);

    expect(out.series[0]?.last_seen_date).toBeNull();
    expect(out.series[0]?.next_expected_date).toBeNull();
    expect(out.series[0]?.status).toBe('on_time');
  });

  it('strips PII from series titles', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Customer: Jane Doe monthly',
          amount: '-100.00',
          cadence: 'monthly',
          lastSeenDate: '2026-03-01',
          nextExpectedDate: '2026-04-01',
          missingDates: [],
        },
      ],
    });

    const out = await recurringStatusTool({}, loaders);

    expect(out.series[0]?.title).not.toContain('Jane Doe');
    expect(out.series[0]?.title).toContain('[name]');
  });
});
