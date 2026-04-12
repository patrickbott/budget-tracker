/**
 * `get_goal_progress` — returns progress toward savings, debt payoff,
 * or net worth goals. Computes current amounts from linked account
 * balances, percent complete, and a linear projection for on-track
 * status and projected completion date.
 */

import Decimal from 'decimal.js';
import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

export const getGoalProgressArgs = z.object({
  goal_id: z
    .string()
    .optional()
    .describe(
      'Optional goal UUID. If omitted, returns progress for all active goals.',
    ),
});

export const getGoalProgressOutput = z.object({
  goals: z.array(
    z.object({
      name: z.string(),
      goal_type: z.enum(['savings', 'debt_payoff', 'net_worth_target']),
      target_amount: z.string(),
      current_amount: z.string(),
      percent_complete: z.number(),
      target_date: z.string().nullable(),
      on_track: z.boolean().nullable(),
      projected_completion_date: z.string().nullable(),
    }),
  ),
});

export type GetGoalProgressArgs = z.infer<typeof getGoalProgressArgs>;
export type GetGoalProgressOutput = z.infer<typeof getGoalProgressOutput>;

/**
 * Compute a linear projected completion date based on progress rate
 * from goal creation to today.
 */
function projectCompletionDate(
  createdAt: string,
  today: Date,
  currentAmount: Decimal,
  targetAmount: Decimal,
): string | null {
  if (currentAmount.gte(targetAmount)) return null; // already achieved
  if (currentAmount.lte(0)) return null; // no progress yet

  const startDate = new Date(createdAt);
  const elapsedMs = today.getTime() - startDate.getTime();
  if (elapsedMs <= 0) return null;

  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
  const dailyRate = currentAmount.div(elapsedDays);
  if (dailyRate.lte(0)) return null;

  const remainingAmount = targetAmount.minus(currentAmount);
  const daysToComplete = remainingAmount.div(dailyRate).ceil().toNumber();

  const completionDate = new Date(today.getTime());
  completionDate.setDate(completionDate.getDate() + daysToComplete);

  const y = completionDate.getFullYear();
  const m = String(completionDate.getMonth() + 1).padStart(2, '0');
  const d = String(completionDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const getGoalProgressTool: ToolAdapter<
  GetGoalProgressArgs,
  GetGoalProgressOutput
> = async (args, loaders) => {
  const parsed = getGoalProgressArgs.parse(args);

  const goals = await loaders.loadGoals(parsed.goal_id);

  if (goals.length === 0) {
    return getGoalProgressOutput.parse(stripPII({ goals: [] }));
  }

  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Load accounts for current balances
  const accounts = await loaders.loadAccounts(todayISO);
  const balanceById = new Map(
    accounts.map((a) => [a.accountId, new Decimal(a.balance)]),
  );

  const goalResults = goals.map((g) => {
    const targetAmount = new Decimal(g.targetAmount);

    // Sum balances of linked accounts
    let currentAmount = new Decimal(0);
    for (const accountId of g.linkedAccountIds) {
      const balance = balanceById.get(accountId) ?? new Decimal(0);
      if (g.goalType === 'debt_payoff') {
        // For debt payoff, progress = how much debt has been paid down
        // Liability balances are negative; progress is how much less
        // negative they are vs the target (original debt amount)
        currentAmount = currentAmount.plus(balance.abs());
      } else {
        // For savings / net_worth: sum positive balances
        currentAmount = currentAmount.plus(balance);
      }
    }

    // For debt payoff, if currentAmount > targetAmount it means more
    // debt has been paid down than the target — cap at target
    const effectiveAmount = currentAmount.gt(targetAmount)
      ? targetAmount
      : currentAmount;

    const percentComplete = targetAmount.isZero()
      ? 100
      : effectiveAmount.div(targetAmount).times(100).toDecimalPlaces(1).toNumber();

    // on_track: only meaningful if there's a targetDate
    let onTrack: boolean | null = null;
    if (g.targetDate) {
      const projectedDate = projectCompletionDate(
        g.createdAt,
        today,
        effectiveAmount,
        targetAmount,
      );
      if (projectedDate === null) {
        // Already complete or no progress — if complete, on track
        onTrack = effectiveAmount.gte(targetAmount);
      } else {
        onTrack = projectedDate <= g.targetDate;
      }
    }

    const projectedCompletionDate = projectCompletionDate(
      g.createdAt,
      today,
      effectiveAmount,
      targetAmount,
    );

    return {
      name: g.name,
      goal_type: g.goalType,
      target_amount: targetAmount.toFixed(2),
      current_amount: effectiveAmount.toFixed(2),
      percent_complete: percentComplete,
      target_date: g.targetDate,
      on_track: onTrack,
      projected_completion_date: projectedCompletionDate,
    };
  });

  return getGoalProgressOutput.parse(stripPII({ goals: goalResults }));
};
