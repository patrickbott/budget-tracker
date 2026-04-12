import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findSubscriptionsTool } from './find-subscriptions.ts';
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

describe('findSubscriptionsTool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 12)); // April 12, 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('detects monthly subscriptions and computes annual cost', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Netflix',
          amount: '-15.99',
          cadence: 'monthly',
          lastSeenDate: '2026-04-01',
          nextExpectedDate: '2026-05-01',
          missingDates: [],
        },
      ],
    });

    const out = await findSubscriptionsTool({}, loaders);

    expect(out.subscriptions).toHaveLength(1);
    const sub = out.subscriptions[0]!;
    expect(sub.description).toBe('Netflix');
    expect(sub.amount).toBe('15.99');
    expect(sub.cadence).toBe('monthly');
    expect(sub.annual_cost).toBe('191.88');
    expect(sub.status).toBe('active');
  });

  it('flags stale monthly subscriptions (>45 days since last charge)', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Old Service',
          amount: '-9.99',
          cadence: 'monthly',
          lastSeenDate: '2026-02-15', // ~56 days ago from April 12
          nextExpectedDate: '2026-03-15',
          missingDates: ['2026-03-15'],
        },
      ],
    });

    const out = await findSubscriptionsTool({}, loaders);

    expect(out.subscriptions).toHaveLength(1);
    expect(out.subscriptions[0]!.status).toBe('stale');
  });

  it('flags annual subscriptions as stale only after 400 days', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Annual Software',
          amount: '-99.00',
          cadence: 'annual',
          lastSeenDate: '2025-04-01', // ~376 days ago — still active
          nextExpectedDate: '2026-04-01',
          missingDates: [],
        },
      ],
    });

    const out = await findSubscriptionsTool({}, loaders);

    expect(out.subscriptions).toHaveLength(1);
    expect(out.subscriptions[0]!.status).toBe('active');
    expect(out.subscriptions[0]!.annual_cost).toBe('99.00');
  });

  it('excludes large recurring charges (rent, mortgage) over $100', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Rent',
          amount: '-1500.00',
          cadence: 'monthly',
          lastSeenDate: '2026-04-01',
          nextExpectedDate: '2026-05-01',
          missingDates: [],
        },
        {
          title: 'Spotify',
          amount: '-9.99',
          cadence: 'monthly',
          lastSeenDate: '2026-04-01',
          nextExpectedDate: '2026-05-01',
          missingDates: [],
        },
      ],
    });

    const out = await findSubscriptionsTool({}, loaders);

    expect(out.subscriptions).toHaveLength(1);
    expect(out.subscriptions[0]!.description).toBe('Spotify');
  });

  it('sorts by annual cost descending', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Cheap',
          amount: '-4.99',
          cadence: 'monthly',
          lastSeenDate: '2026-04-01',
          nextExpectedDate: '2026-05-01',
          missingDates: [],
        },
        {
          title: 'Expensive',
          amount: '-29.99',
          cadence: 'monthly',
          lastSeenDate: '2026-04-01',
          nextExpectedDate: '2026-05-01',
          missingDates: [],
        },
      ],
    });

    const out = await findSubscriptionsTool({}, loaders);

    expect(out.subscriptions).toHaveLength(2);
    expect(out.subscriptions[0]!.description).toBe('Expensive');
    expect(out.subscriptions[1]!.description).toBe('Cheap');
  });

  it('returns empty array when no recurring charges exist', async () => {
    const loaders = makeLoaders();

    const out = await findSubscriptionsTool({}, loaders);

    expect(out.subscriptions).toEqual([]);
  });

  it('treats null lastSeenDate as stale', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Unknown Service',
          amount: '-5.00',
          cadence: 'monthly',
          lastSeenDate: null,
          nextExpectedDate: null,
          missingDates: [],
        },
      ],
    });

    const out = await findSubscriptionsTool({}, loaders);

    expect(out.subscriptions).toHaveLength(1);
    expect(out.subscriptions[0]!.status).toBe('stale');
  });

  it('handles weekly cadence (52x annual)', async () => {
    const loaders = makeLoaders({
      loadRecurringStatus: async () => [
        {
          title: 'Weekly Service',
          amount: '-5.00',
          cadence: 'weekly',
          lastSeenDate: '2026-04-10',
          nextExpectedDate: '2026-04-17',
          missingDates: [],
        },
      ],
    });

    const out = await findSubscriptionsTool({}, loaders);

    expect(out.subscriptions).toHaveLength(1);
    expect(out.subscriptions[0]!.annual_cost).toBe('260.00');
  });
});
