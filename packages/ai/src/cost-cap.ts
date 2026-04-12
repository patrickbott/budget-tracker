/**
 * Cost-cap enforcement — pure functions for checking monthly AI spend
 * limits and estimating per-request costs.
 *
 * These functions are framework-agnostic. The caller (a server action
 * in `apps/web`) reads `ai_usage` from the DB, calls `checkSpendCap`,
 * and decides whether to proceed. This keeps `packages/ai` free of
 * framework or database dependencies.
 *
 * Thresholds (from `docs/ai-tools.md`):
 *   - < 80%  → allowed, no warning
 *   - 80–99% → allowed, warning banner
 *   - >= 100% → blocked
 */

import Decimal from 'decimal.js';

export interface SpendCapResult {
  allowed: boolean;
  percentUsed: number;
  warning: boolean;
  message?: string;
}

/**
 * Check whether a family's current-month AI usage is within the spend
 * cap. Returns a result indicating whether the request should proceed,
 * whether a warning should be shown, and an optional user-facing
 * message.
 *
 * @param currentMonthUsage - Total cost for the current month as a
 *   decimal string (e.g. `"7.50"`). Uses `decimal.js` internally —
 *   never `parseFloat`.
 * @param capUsd - The monthly cap in USD (e.g. `10`).
 */
export function checkSpendCap(
  currentMonthUsage: { costUsd: string },
  capUsd: number,
): SpendCapResult {
  const cost = new Decimal(currentMonthUsage.costUsd);
  const cap = new Decimal(capUsd);

  const percentUsed = cap.isZero()
    ? cost.isZero()
      ? 0
      : 100
    : cost.div(cap).mul(100).toDecimalPlaces(1).toNumber();

  if (percentUsed >= 100) {
    return {
      allowed: false,
      percentUsed,
      warning: true,
      message: 'Monthly AI quota reached. Chat will resume next month.',
    };
  }

  if (percentUsed >= 80) {
    return {
      allowed: true,
      percentUsed,
      warning: true,
      message: `You have used ${Math.round(percentUsed)}% of your monthly AI budget.`,
    };
  }

  return {
    allowed: true,
    percentUsed,
    warning: false,
  };
}

/**
 * Model pricing as of 2026. Input/output costs per million tokens.
 * We track full price (no prompt-caching discount) because caching is
 * a runtime bonus, not a budget assumption.
 */
const MODEL_PRICING: Record<string, { inputPerM: string; outputPerM: string }> = {
  'claude-opus-4-6': { inputPerM: '15', outputPerM: '75' },
  'claude-haiku-4-5': { inputPerM: '0.80', outputPerM: '4' },
};

/**
 * Estimate the USD cost of a single API call based on model and token
 * counts. Returns a decimal string (e.g. `"0.0234"`).
 *
 * Unknown models throw — callers should validate model names before
 * reaching this point.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): string {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    throw new Error(`Unknown model for cost estimation: ${model}`);
  }

  const inputCost = new Decimal(pricing.inputPerM)
    .div(1_000_000)
    .mul(inputTokens);
  const outputCost = new Decimal(pricing.outputPerM)
    .div(1_000_000)
    .mul(outputTokens);

  return inputCost.plus(outputCost).toFixed(6);
}
