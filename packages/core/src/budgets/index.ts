/**
 * `@budget-tracker/core/budgets` — budget status computation + forecasting math.
 *
 * All monetary math uses `decimal.js` — no JavaScript floats.
 * Amounts are strings matching NUMERIC(19,4) to round-trip losslessly.
 */

import Decimal from 'decimal.js';

/** Per-category budget status as shown on the dashboard ring widget. */
export interface BudgetStatus {
  budgetId: string;
  mode: 'hard_cap' | 'forecast';
  target: string;
  actual: string;
  remaining: string;
  percentUsed: string;
  color: 'green' | 'amber' | 'red';
}

/** Input for computing a single budget's status. */
export interface BudgetStatusInput {
  budgetId: string;
  mode: 'hard_cap' | 'forecast';
  /** Budget target amount as a decimal string. */
  amount: string;
}

/**
 * Compute the status of a budget given actual spend for the period.
 *
 * Color logic:
 *   - **hard_cap**: green if remaining > 20% of target, amber if 0-20%, red if negative
 *   - **forecast**: green if actual within 10% of target, amber if 10-30% over, red if 30%+ over
 */
export function computeBudgetStatus(
  budget: BudgetStatusInput,
  actualSpend: string,
): BudgetStatus {
  const target = new Decimal(budget.amount);
  const actual = new Decimal(actualSpend);
  const remaining = target.minus(actual);

  // percentUsed = (actual / target) * 100 — handle zero-target edge case
  const percentUsed = target.isZero()
    ? actual.isZero()
      ? new Decimal('0')
      : new Decimal('100')
    : actual.div(target).times(100);

  let color: BudgetStatus['color'];

  if (budget.mode === 'hard_cap') {
    // remaining > 20% of target → green
    // remaining >= 0 and <= 20% of target → amber
    // remaining < 0 → red
    const threshold = target.times('0.20');
    if (remaining.greaterThan(threshold)) {
      color = 'green';
    } else if (remaining.greaterThanOrEqualTo(0)) {
      color = 'amber';
    } else {
      color = 'red';
    }
  } else {
    // forecast mode: compare actual to target
    // within 10% of target → green
    // 10-30% over → amber
    // 30%+ over → red
    const overPercent = target.isZero()
      ? actual.isZero()
        ? new Decimal(0)
        : new Decimal(100)
      : actual.minus(target).div(target).times(100);

    if (overPercent.lessThanOrEqualTo(10)) {
      color = 'green';
    } else if (overPercent.lessThanOrEqualTo(30)) {
      color = 'amber';
    } else {
      color = 'red';
    }
  }

  return {
    budgetId: budget.budgetId,
    mode: budget.mode,
    target: target.toFixed(4),
    actual: actual.toFixed(4),
    remaining: remaining.toFixed(4),
    percentUsed: percentUsed.toFixed(2),
    color,
  };
}

/** A single day's spend total for forecasting. */
export interface DailySpend {
  date: string;
  amount: string;
}

/** Forecast result. */
export interface ForecastResult {
  projected: string;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Linear projection of month-end spend based on daily history.
 *
 * Uses the most recent 14 days of history (or all available if < 14)
 * to compute average daily spend, then projects forward.
 *
 * Confidence levels:
 *   - high: > 21 days of history
 *   - medium: 7–21 days
 *   - low: < 7 days
 *
 * @param dailySpendHistory - Array of daily spend totals
 * @param daysRemaining - Days left in the budget period
 */
export function forecastMonthEnd(
  dailySpendHistory: readonly DailySpend[],
  daysRemaining: number,
): ForecastResult {
  if (dailySpendHistory.length === 0) {
    return { projected: '0.0000', confidence: 'low' };
  }

  // Use last 14 days for the average (or all if fewer)
  const windowSize = Math.min(14, dailySpendHistory.length);
  const recentDays = dailySpendHistory.slice(-windowSize);

  // Compute average daily spend
  const totalSpend = recentDays.reduce(
    (sum, day) => sum.plus(new Decimal(day.amount)),
    new Decimal(0),
  );
  const avgDaily = totalSpend.div(windowSize);

  // Total actual spend so far (all history)
  const totalActual = dailySpendHistory.reduce(
    (sum, day) => sum.plus(new Decimal(day.amount)),
    new Decimal(0),
  );

  // Project: actual so far + (avg daily * days remaining)
  const projected = totalActual.plus(avgDaily.times(daysRemaining));

  // Confidence based on total history length
  let confidence: ForecastResult['confidence'];
  if (dailySpendHistory.length > 21) {
    confidence = 'high';
  } else if (dailySpendHistory.length >= 7) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    projected: projected.toFixed(4),
    confidence,
  };
}
