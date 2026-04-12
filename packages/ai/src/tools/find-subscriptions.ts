/**
 * `find_subscriptions` — detects recurring small-amount charges and
 * flags stale/unused ones.
 *
 * Leverages the `loadRecurringStatus` loader which already returns
 * cadence, amounts, and last-seen dates from the recurring detection
 * engine. This adapter filters to subscription-like patterns,
 * computes annual cost, and flags staleness.
 */

import Decimal from 'decimal.js';
import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

export const findSubscriptionsArgs = z
  .object({})
  .describe('No arguments — returns all detected subscription charges.');

const statusEnum = z.enum(['active', 'stale']);

export const findSubscriptionsOutput = z.object({
  subscriptions: z.array(
    z.object({
      description: z.string(),
      amount: z.string(),
      cadence: z.string(),
      category_name: z.string().nullable(),
      last_charged: z.string().nullable(),
      annual_cost: z.string(),
      status: statusEnum,
    }),
  ),
});

export type FindSubscriptionsArgs = z.infer<typeof findSubscriptionsArgs>;
export type FindSubscriptionsOutput = z.infer<typeof findSubscriptionsOutput>;

/** Max amount per charge to be considered a subscription. */
const SUBSCRIPTION_MAX_AMOUNT = new Decimal('100');

/** Days since last charge to flag monthly subscriptions as stale. */
const MONTHLY_STALE_DAYS = 45;
/** Days since last charge to flag annual subscriptions as stale. */
const ANNUAL_STALE_DAYS = 400;

/** Cadences that indicate subscription-like recurring charges. */
const SUBSCRIPTION_CADENCES = new Set([
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'semi-annual',
  'annual',
]);

/** Multiplier to annualize a charge based on cadence. */
function annualMultiplier(cadence: string): number {
  switch (cadence) {
    case 'weekly':
      return 52;
    case 'biweekly':
      return 26;
    case 'monthly':
      return 12;
    case 'quarterly':
      return 4;
    case 'semi-annual':
      return 2;
    case 'annual':
      return 1;
    default:
      return 12; // default to monthly assumption
  }
}

/** Staleness threshold in days based on cadence. */
function staleThresholdDays(cadence: string): number {
  switch (cadence) {
    case 'annual':
    case 'semi-annual':
      return ANNUAL_STALE_DAYS;
    default:
      return MONTHLY_STALE_DAYS;
  }
}

export const findSubscriptionsTool: ToolAdapter<
  FindSubscriptionsArgs,
  FindSubscriptionsOutput
> = async (_args, loaders) => {
  findSubscriptionsArgs.parse(_args);

  const [recurring, categoryNames] = await Promise.all([
    loaders.loadRecurringStatus(),
    loaders.loadCategoryNameMap(),
  ]);

  const today = new Date();
  const todayMs = today.getTime();

  const subscriptions = recurring
    // Filter to subscription-like: known cadence, small amounts
    .filter((r) => {
      if (!SUBSCRIPTION_CADENCES.has(r.cadence)) return false;
      const amt = new Decimal(r.amount).abs();
      return amt.lte(SUBSCRIPTION_MAX_AMOUNT);
    })
    .map((r) => {
      const amount = new Decimal(r.amount).abs();
      const annualCost = amount.times(annualMultiplier(r.cadence));

      if (r.lastSeenDate) {
        const lastSeen = new Date(r.lastSeenDate + 'T00:00:00Z');
        const daysSinceLastSeen = Math.floor(
          (todayMs - lastSeen.getTime()) / (1000 * 60 * 60 * 24),
        );
        const status: 'active' | 'stale' =
          daysSinceLastSeen > staleThresholdDays(r.cadence)
            ? 'stale'
            : 'active';

        return {
          description: r.title,
          amount: amount.toFixed(2),
          cadence: r.cadence,
          category_name: null as string | null,
          last_charged: r.lastSeenDate,
          annual_cost: annualCost.toFixed(2),
          status,
        };
      }

      return {
        description: r.title,
        amount: amount.toFixed(2),
        cadence: r.cadence,
        category_name: null as string | null,
        last_charged: r.lastSeenDate,
        annual_cost: annualCost.toFixed(2),
        status: 'stale' as const, // never seen → stale
      };
    })
    // Sort by annual cost descending
    .sort((a, b) => {
      const diff = new Decimal(b.annual_cost).minus(
        new Decimal(a.annual_cost),
      );
      return diff.isZero()
        ? a.description.localeCompare(b.description)
        : diff.isPositive()
          ? 1
          : -1;
    });

  return findSubscriptionsOutput.parse(stripPII({ subscriptions }));
};
