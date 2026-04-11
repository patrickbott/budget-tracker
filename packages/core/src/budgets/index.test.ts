import { describe, it, expect } from 'vitest';
import {
  computeBudgetStatus,
  forecastMonthEnd,
  type BudgetStatusInput,
  type DailySpend,
} from './index.ts';

// ---------------------------------------------------------------------------
// computeBudgetStatus — hard_cap mode
// ---------------------------------------------------------------------------

describe('computeBudgetStatus — hard_cap', () => {
  const budget: BudgetStatusInput = {
    budgetId: 'budget-groceries',
    mode: 'hard_cap',
    amount: '500.0000',
  };

  it('green — remaining > 20% of target', () => {
    // Spent $200 of $500 → remaining $300 (60%) → green
    const status = computeBudgetStatus(budget, '200.0000');
    expect(status.color).toBe('green');
    expect(status.remaining).toBe('300.0000');
    expect(status.percentUsed).toBe('40.00');
  });

  it('amber — remaining is 0-20% of target', () => {
    // Spent $450 of $500 → remaining $50 (10%) → amber
    const status = computeBudgetStatus(budget, '450.0000');
    expect(status.color).toBe('amber');
    expect(status.remaining).toBe('50.0000');
  });

  it('amber — remaining exactly 20% of target', () => {
    // Spent $400 of $500 → remaining $100 (exactly 20%) → amber (not > 20%)
    const status = computeBudgetStatus(budget, '400.0000');
    expect(status.color).toBe('amber');
    expect(status.remaining).toBe('100.0000');
  });

  it('amber — remaining exactly 0', () => {
    const status = computeBudgetStatus(budget, '500.0000');
    expect(status.color).toBe('amber');
    expect(status.remaining).toBe('0.0000');
  });

  it('red — overspent', () => {
    // Spent $550 of $500 → remaining -$50 → red
    const status = computeBudgetStatus(budget, '550.0000');
    expect(status.color).toBe('red');
    expect(status.remaining).toBe('-50.0000');
  });

  it('green — zero spend', () => {
    const status = computeBudgetStatus(budget, '0.0000');
    expect(status.color).toBe('green');
    expect(status.remaining).toBe('500.0000');
    expect(status.percentUsed).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// computeBudgetStatus — forecast mode
// ---------------------------------------------------------------------------

describe('computeBudgetStatus — forecast', () => {
  const budget: BudgetStatusInput = {
    budgetId: 'budget-dining',
    mode: 'forecast',
    amount: '300.0000',
  };

  it('green — actual within 10% of target', () => {
    // Spent $320 of $300 target → 6.67% over → green
    const status = computeBudgetStatus(budget, '320.0000');
    expect(status.color).toBe('green');
  });

  it('green — actual exactly at target', () => {
    const status = computeBudgetStatus(budget, '300.0000');
    expect(status.color).toBe('green');
  });

  it('green — actual below target', () => {
    const status = computeBudgetStatus(budget, '200.0000');
    expect(status.color).toBe('green');
  });

  it('amber — 10-30% over target', () => {
    // Spent $360 of $300 target → 20% over → amber
    const status = computeBudgetStatus(budget, '360.0000');
    expect(status.color).toBe('amber');
  });

  it('amber — exactly 10% over boundary', () => {
    // Spent $330 → exactly 10% over → still green (≤10%)
    const status = computeBudgetStatus(budget, '330.0000');
    expect(status.color).toBe('green');
  });

  it('amber — exactly 30% over boundary', () => {
    // Spent $390 → exactly 30% over → amber (≤30%)
    const status = computeBudgetStatus(budget, '390.0000');
    expect(status.color).toBe('amber');
  });

  it('red — 30%+ over target', () => {
    // Spent $400 of $300 target → 33.3% over → red
    const status = computeBudgetStatus(budget, '400.0000');
    expect(status.color).toBe('red');
  });

  it('zero target with zero spend → green', () => {
    const zeroBudget: BudgetStatusInput = {
      budgetId: 'budget-zero',
      mode: 'forecast',
      amount: '0.0000',
    };
    const status = computeBudgetStatus(zeroBudget, '0.0000');
    expect(status.color).toBe('green');
  });
});

// ---------------------------------------------------------------------------
// computeBudgetStatus — shared checks
// ---------------------------------------------------------------------------

describe('computeBudgetStatus — output fields', () => {
  it('returns all expected fields', () => {
    const status = computeBudgetStatus(
      { budgetId: 'b1', mode: 'hard_cap', amount: '100.0000' },
      '50.0000',
    );
    expect(status).toEqual({
      budgetId: 'b1',
      mode: 'hard_cap',
      target: '100.0000',
      actual: '50.0000',
      remaining: '50.0000',
      percentUsed: '50.00',
      color: 'green',
    });
  });

  it('uses decimal.js — no floating-point drift', () => {
    // $0.1 + $0.2 should be exactly $0.3, not 0.30000000000000004
    const status = computeBudgetStatus(
      { budgetId: 'b2', mode: 'hard_cap', amount: '0.3000' },
      '0.1000',
    );
    expect(status.remaining).toBe('0.2000');
  });
});

// ---------------------------------------------------------------------------
// forecastMonthEnd
// ---------------------------------------------------------------------------

describe('forecastMonthEnd', () => {
  it('empty history → projected 0 with low confidence', () => {
    const result = forecastMonthEnd([], 15);
    expect(result.projected).toBe('0.0000');
    expect(result.confidence).toBe('low');
  });

  it('simple 3-day history with 10 days remaining', () => {
    const history: DailySpend[] = [
      { date: '2026-03-01', amount: '30.0000' },
      { date: '2026-03-02', amount: '20.0000' },
      { date: '2026-03-03', amount: '10.0000' },
    ];
    // avg daily = 60/3 = 20
    // total actual = 60
    // projected = 60 + (20 * 10) = 260
    const result = forecastMonthEnd(history, 10);
    expect(result.projected).toBe('260.0000');
    expect(result.confidence).toBe('low'); // only 3 days
  });

  it('7-day history → medium confidence', () => {
    const history: DailySpend[] = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-03-0${i + 1}`,
      amount: '10.0000',
    }));
    const result = forecastMonthEnd(history, 23);
    // avg = 10, total = 70, projected = 70 + (10 * 23) = 300
    expect(result.projected).toBe('300.0000');
    expect(result.confidence).toBe('medium');
  });

  it('21-day history → medium confidence (boundary)', () => {
    const history: DailySpend[] = Array.from({ length: 21 }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      amount: '10.0000',
    }));
    const result = forecastMonthEnd(history, 9);
    expect(result.confidence).toBe('medium'); // 21 is not > 21
  });

  it('22-day history → high confidence', () => {
    const history: DailySpend[] = Array.from({ length: 22 }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      amount: '10.0000',
    }));
    const result = forecastMonthEnd(history, 8);
    // Uses last 14 days for avg: avg = 10
    // Total actual = 220
    // projected = 220 + (10 * 8) = 300
    expect(result.projected).toBe('300.0000');
    expect(result.confidence).toBe('high');
  });

  it('uses last 14 days for average when history > 14', () => {
    // First 6 days: $100/day, last 14 days: $10/day
    const history: DailySpend[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        date: `2026-03-0${i + 1}`,
        amount: '100.0000',
      })),
      ...Array.from({ length: 14 }, (_, i) => ({
        date: `2026-03-${String(i + 7).padStart(2, '0')}`,
        amount: '10.0000',
      })),
    ];
    // avg from last 14 = 10
    // total actual = 600 + 140 = 740
    // projected = 740 + (10 * 10) = 840
    const result = forecastMonthEnd(history, 10);
    expect(result.projected).toBe('840.0000');
  });

  it('zero days remaining → projected equals actual total', () => {
    const history: DailySpend[] = [
      { date: '2026-03-01', amount: '50.0000' },
      { date: '2026-03-02', amount: '30.0000' },
    ];
    const result = forecastMonthEnd(history, 0);
    expect(result.projected).toBe('80.0000');
  });
});
