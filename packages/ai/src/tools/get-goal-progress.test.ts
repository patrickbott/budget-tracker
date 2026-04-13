import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getGoalProgressTool } from './get-goal-progress.ts';
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

describe('getGoalProgressTool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 12)); // April 12, 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns progress for a single savings goal', async () => {
    const loaders = makeLoaders({
      loadGoals: async () => [
        {
          id: 'g1',
          name: 'Emergency Fund',
          goalType: 'savings',
          targetAmount: '10000.0000',
          targetDate: '2026-12-31',
          linkedAccountIds: ['acc-savings'],
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loadAccounts: async () => [
        {
          accountId: 'acc-savings',
          accountType: 'depository',
          balance: '5000.0000',
        },
      ],
    });

    const out = await getGoalProgressTool({}, loaders);

    expect(out.goals).toHaveLength(1);
    const g = out.goals[0]!;
    expect(g.name).toBe('Emergency Fund');
    expect(g.goal_type).toBe('savings');
    expect(g.target_amount).toBe('10000.00');
    expect(g.current_amount).toBe('5000.00');
    expect(g.percent_complete).toBe(50);
    expect(g.target_date).toBe('2026-12-31');
    expect(g.on_track).toBeDefined();
    expect(g.projected_completion_date).toBeDefined();
  });

  it('returns multiple goals', async () => {
    const loaders = makeLoaders({
      loadGoals: async () => [
        {
          id: 'g1',
          name: 'Savings',
          goalType: 'savings',
          targetAmount: '5000.0000',
          targetDate: null,
          linkedAccountIds: ['acc1'],
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'g2',
          name: 'Debt Payoff',
          goalType: 'debt_payoff',
          targetAmount: '3000.0000',
          targetDate: '2026-06-30',
          linkedAccountIds: ['acc-cc'],
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loadAccounts: async () => [
        { accountId: 'acc1', accountType: 'depository', balance: '2500.0000' },
        {
          accountId: 'acc-cc',
          accountType: 'credit_card',
          balance: '-1500.0000',
        },
      ],
    });

    const out = await getGoalProgressTool({}, loaders);

    expect(out.goals).toHaveLength(2);
    expect(out.goals[0]!.name).toBe('Savings');
    expect(out.goals[1]!.name).toBe('Debt Payoff');
  });

  it('returns null on_track when no targetDate', async () => {
    const loaders = makeLoaders({
      loadGoals: async () => [
        {
          id: 'g1',
          name: 'Open-ended',
          goalType: 'savings',
          targetAmount: '10000.0000',
          targetDate: null,
          linkedAccountIds: ['acc1'],
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loadAccounts: async () => [
        { accountId: 'acc1', accountType: 'depository', balance: '3000.0000' },
      ],
    });

    const out = await getGoalProgressTool({}, loaders);

    expect(out.goals[0]!.on_track).toBeNull();
  });

  it('handles goal at 100% completion', async () => {
    const loaders = makeLoaders({
      loadGoals: async () => [
        {
          id: 'g1',
          name: 'Fully Funded',
          goalType: 'savings',
          targetAmount: '5000.0000',
          targetDate: '2026-12-31',
          linkedAccountIds: ['acc1'],
          status: 'active',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      loadAccounts: async () => [
        { accountId: 'acc1', accountType: 'depository', balance: '5000.0000' },
      ],
    });

    const out = await getGoalProgressTool({}, loaders);

    const g = out.goals[0]!;
    expect(g.percent_complete).toBe(100);
    expect(g.on_track).toBe(true);
    expect(g.projected_completion_date).toBeNull(); // already done
  });

  it('handles goal with over 100% progress (capped at target)', async () => {
    const loaders = makeLoaders({
      loadGoals: async () => [
        {
          id: 'g1',
          name: 'Over-funded',
          goalType: 'savings',
          targetAmount: '5000.0000',
          targetDate: null,
          linkedAccountIds: ['acc1'],
          status: 'active',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      loadAccounts: async () => [
        { accountId: 'acc1', accountType: 'depository', balance: '7000.0000' },
      ],
    });

    const out = await getGoalProgressTool({}, loaders);

    // Capped at target
    expect(out.goals[0]!.current_amount).toBe('5000.00');
    expect(out.goals[0]!.percent_complete).toBe(100);
  });

  it('handles empty linked accounts', async () => {
    const loaders = makeLoaders({
      loadGoals: async () => [
        {
          id: 'g1',
          name: 'No Accounts',
          goalType: 'savings',
          targetAmount: '5000.0000',
          targetDate: null,
          linkedAccountIds: [],
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const out = await getGoalProgressTool({}, loaders);

    expect(out.goals[0]!.current_amount).toBe('0.00');
    expect(out.goals[0]!.percent_complete).toBe(0);
    expect(out.goals[0]!.projected_completion_date).toBeNull();
  });

  it('filters by goal_id when provided', async () => {
    const loadGoals = vi.fn(async (goalId?: string) => {
      if (goalId === 'g2') {
        return [
          {
            id: 'g2',
            name: 'Target Goal',
            goalType: 'savings' as const,
            targetAmount: '5000.0000',
            targetDate: null,
            linkedAccountIds: ['acc1'],
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const loaders = makeLoaders({
      loadGoals,
      loadAccounts: async () => [
        { accountId: 'acc1', accountType: 'depository', balance: '2000.0000' },
      ],
    });

    await getGoalProgressTool({ goal_id: 'g2' }, loaders);

    expect(loadGoals).toHaveBeenCalledWith('g2');
  });

  it('returns empty when no goals exist', async () => {
    const loaders = makeLoaders();

    const out = await getGoalProgressTool({}, loaders);

    expect(out.goals).toHaveLength(0);
  });

  it('computes projected completion date via linear projection', async () => {
    // Created Jan 1, 2026. Today is April 12, 2026 (~101 days).
    // Current amount: $2500 of $10000 target.
    // Daily rate: 2500/101 ≈ $24.75/day
    // Remaining: $7500 / $24.75 ≈ 303 days from today
    // Projected: ~2027-02-09ish
    const loaders = makeLoaders({
      loadGoals: async () => [
        {
          id: 'g1',
          name: 'Long Term',
          goalType: 'savings',
          targetAmount: '10000.0000',
          targetDate: '2027-12-31',
          linkedAccountIds: ['acc1'],
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loadAccounts: async () => [
        { accountId: 'acc1', accountType: 'depository', balance: '2500.0000' },
      ],
    });

    const out = await getGoalProgressTool({}, loaders);

    const g = out.goals[0]!;
    expect(g.projected_completion_date).not.toBeNull();
    // Should be in 2027 — the exact date depends on the math
    expect(g.projected_completion_date!.startsWith('2027-')).toBe(true);
    expect(g.on_track).toBe(true); // projected well before 2027-12-31
  });

  it('debt payoff goal uses absolute value of liability balances', async () => {
    const loaders = makeLoaders({
      loadGoals: async () => [
        {
          id: 'g1',
          name: 'Pay Off CC',
          goalType: 'debt_payoff',
          targetAmount: '3000.0000',
          targetDate: null,
          linkedAccountIds: ['cc1'],
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loadAccounts: async () => [
        // Credit card has -1500 balance (owed)
        {
          accountId: 'cc1',
          accountType: 'credit_card',
          balance: '-1500.0000',
        },
      ],
    });

    const out = await getGoalProgressTool({}, loaders);

    const g = out.goals[0]!;
    // Debt payoff uses abs of balance: 1500
    expect(g.current_amount).toBe('1500.00');
    expect(g.percent_complete).toBe(50);
  });

  it('sums balances across multiple linked accounts', async () => {
    const loaders = makeLoaders({
      loadGoals: async () => [
        {
          id: 'g1',
          name: 'Net Worth Target',
          goalType: 'net_worth_target',
          targetAmount: '50000.0000',
          targetDate: null,
          linkedAccountIds: ['acc1', 'acc2', 'acc3'],
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loadAccounts: async () => [
        { accountId: 'acc1', accountType: 'depository', balance: '10000.0000' },
        {
          accountId: 'acc2',
          accountType: 'investment',
          balance: '15000.0000',
        },
        { accountId: 'acc3', accountType: 'depository', balance: '5000.0000' },
      ],
    });

    const out = await getGoalProgressTool({}, loaders);

    expect(out.goals[0]!.current_amount).toBe('30000.00');
    expect(out.goals[0]!.percent_complete).toBe(60);
  });

  it('handles zero target amount', async () => {
    const loaders = makeLoaders({
      loadGoals: async () => [
        {
          id: 'g1',
          name: 'Zero Target',
          goalType: 'savings',
          targetAmount: '0.0000',
          targetDate: null,
          linkedAccountIds: [],
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const out = await getGoalProgressTool({}, loaders);

    expect(out.goals[0]!.percent_complete).toBe(100);
  });
});
