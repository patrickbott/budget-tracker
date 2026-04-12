/**
 * `saving_opportunities` — surfaces high-spend categories, unused
 * subscriptions, fee accumulation, and over-budget categories.
 *
 * Multi-signal analysis that combines budget status, recurring charges,
 * current/prior period spending, and transaction pattern matching to
 * generate actionable saving opportunities sorted by potential impact.
 */

import Decimal from 'decimal.js';
import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

export const savingOpportunitiesArgs = z
  .object({})
  .describe('No arguments — analyzes all available data for savings.');

const opportunityTypeEnum = z.enum([
  'high_spend',
  'stale_subscription',
  'fee_accumulation',
  'over_budget',
]);

export const savingOpportunitiesOutput = z.object({
  opportunities: z.array(
    z.object({
      type: opportunityTypeEnum,
      description: z.string(),
      potential_savings: z.string(),
      details: z.string(),
    }),
  ),
});

export type SavingOpportunitiesArgs = z.infer<typeof savingOpportunitiesArgs>;
export type SavingOpportunitiesOutput = z.infer<
  typeof savingOpportunitiesOutput
>;

/** High-spend threshold: category must have increased >20% AND >$50 absolute. */
const HIGH_SPEND_PERCENT_THRESHOLD = new Decimal('0.20');
const HIGH_SPEND_ABSOLUTE_THRESHOLD = new Decimal('50');

/** Stale subscription: monthly not charged in >45 days, annual >400 days. */
const MONTHLY_STALE_DAYS = 45;
const ANNUAL_STALE_DAYS = 400;
const SUBSCRIPTION_MAX_AMOUNT = new Decimal('100');
const SUBSCRIPTION_CADENCES = new Set([
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'semi-annual',
  'annual',
]);

/** Fee-related keywords in transaction descriptions. */
const FEE_KEYWORDS = /\b(atm fee|overdraft|late fee|service charge|maintenance fee|nsf fee|wire fee|foreign transaction fee)\b/i;

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
      return 12;
  }
}

interface Opportunity {
  type: 'high_spend' | 'stale_subscription' | 'fee_accumulation' | 'over_budget';
  description: string;
  potential_savings: string;
  details: string;
}

export const savingOpportunitiesTool: ToolAdapter<
  SavingOpportunitiesArgs,
  SavingOpportunitiesOutput
> = async (_args, loaders) => {
  savingOpportunitiesArgs.parse(_args);

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthEndExclusive = `${month + 1 === 12 ? year + 1 : year}-${String(month + 1 === 12 ? 1 : month + 2).padStart(2, '0')}-01`;

  // Prior month
  const priorYear = month === 0 ? year - 1 : year;
  const priorMonth = month === 0 ? 12 : month;
  const priorMonthStart = `${priorYear}-${String(priorMonth).padStart(2, '0')}-01`;

  const [budgetRows, recurring, currentEntries, priorEntries, categoryNames, feeTxns] =
    await Promise.all([
      loaders.loadBudgetStatus(monthStart, monthEndExclusive),
      loaders.loadRecurringStatus(),
      loaders.loadEntries({ start: monthStart, end: monthEndExclusive }),
      loaders.loadEntries({ start: priorMonthStart, end: monthStart }),
      loaders.loadCategoryNameMap(),
      loaders.loadTransactions({ query: 'fee', limit: 50 }),
    ]);

  const opportunities: Opportunity[] = [];

  // --- Signal 1: Over-budget categories ---
  for (const row of budgetRows) {
    const actual = new Decimal(row.actualSpend);
    const budget = new Decimal(row.budgetAmount);
    if (actual.gt(budget) && !budget.isZero()) {
      const overage = actual.minus(budget);
      opportunities.push({
        type: 'over_budget',
        description: `${row.categoryName} is over budget`,
        potential_savings: overage.toFixed(2),
        details: `Spent $${actual.toFixed(2)} against a $${budget.toFixed(2)} ${row.budgetMode} budget — $${overage.toFixed(2)} over.`,
      });
    }
  }

  // --- Signal 2: High-spend categories (current vs prior month) ---
  // Aggregate spending by category for each period
  const aggregateByCategory = (
    entries: ReadonlyArray<{
      amountSigned: string;
      categoryId: string | null;
      isTransfer: boolean;
    }>,
  ) => {
    const map = new Map<string, Decimal>();
    for (const e of entries) {
      if (e.isTransfer || e.categoryId === null) continue;
      const amt = new Decimal(e.amountSigned);
      if (amt.gte(0)) continue; // only outflows
      const prev = map.get(e.categoryId) ?? new Decimal(0);
      map.set(e.categoryId, prev.plus(amt.abs()));
    }
    return map;
  };

  const currentByCat = aggregateByCategory(currentEntries);
  const priorByCat = aggregateByCategory(priorEntries);

  for (const [catId, currentSpend] of currentByCat) {
    const priorSpend = priorByCat.get(catId) ?? new Decimal(0);
    if (priorSpend.isZero()) continue; // can't compare to zero baseline

    const increase = currentSpend.minus(priorSpend);
    const percentIncrease = increase.div(priorSpend);

    if (
      percentIncrease.gt(HIGH_SPEND_PERCENT_THRESHOLD) &&
      increase.gt(HIGH_SPEND_ABSOLUTE_THRESHOLD)
    ) {
      const catName = categoryNames.get(catId) ?? catId;
      const pct = percentIncrease.times(100).toDecimalPlaces(0).toString();
      opportunities.push({
        type: 'high_spend',
        description: `${catName} spending up ${pct}% vs last month`,
        potential_savings: increase.toFixed(2),
        details: `$${currentSpend.toFixed(2)} this month vs $${priorSpend.toFixed(2)} last month — $${increase.toFixed(2)} increase.`,
      });
    }
  }

  // --- Signal 3: Stale subscriptions ---
  const todayMs = today.getTime();
  for (const r of recurring) {
    if (!SUBSCRIPTION_CADENCES.has(r.cadence)) continue;
    const amt = new Decimal(r.amount).abs();
    if (amt.gt(SUBSCRIPTION_MAX_AMOUNT)) continue;

    if (!r.lastSeenDate) {
      // Never seen → stale
      opportunities.push({
        type: 'stale_subscription',
        description: `${r.title} may be unused`,
        potential_savings: amt.times(annualMultiplier(r.cadence)).toFixed(2),
        details: `${r.cadence} charge of $${amt.toFixed(2)} with no recent activity. Annual cost: $${amt.times(annualMultiplier(r.cadence)).toFixed(2)}.`,
      });
      continue;
    }

    const lastSeen = new Date(r.lastSeenDate + 'T00:00:00Z');
    const daysSince = Math.floor(
      (todayMs - lastSeen.getTime()) / (1000 * 60 * 60 * 24),
    );
    const threshold =
      r.cadence === 'annual' || r.cadence === 'semi-annual'
        ? ANNUAL_STALE_DAYS
        : MONTHLY_STALE_DAYS;

    if (daysSince > threshold) {
      const annualCost = amt.times(annualMultiplier(r.cadence));
      opportunities.push({
        type: 'stale_subscription',
        description: `${r.title} may be unused`,
        potential_savings: annualCost.toFixed(2),
        details: `${r.cadence} charge of $${amt.toFixed(2)}, last seen ${r.lastSeenDate} (${daysSince} days ago). Annual cost: $${annualCost.toFixed(2)}.`,
      });
    }
  }

  // --- Signal 4: Fee accumulation ---
  const feeRows = feeTxns.rows.filter((r) => FEE_KEYWORDS.test(r.description));
  if (feeRows.length > 0) {
    const totalFees = feeRows.reduce(
      (sum, r) => sum.plus(new Decimal(r.amount).abs()),
      new Decimal(0),
    );
    opportunities.push({
      type: 'fee_accumulation',
      description: `${feeRows.length} fee charge${feeRows.length > 1 ? 's' : ''} detected`,
      potential_savings: totalFees.toFixed(2),
      details: `Found ${feeRows.length} fee-related transactions totaling $${totalFees.toFixed(2)}. Common fees: ${[...new Set(feeRows.map((r) => r.description))].slice(0, 3).join(', ')}.`,
    });
  }

  // Sort by potential savings descending
  opportunities.sort((a, b) => {
    const diff = new Decimal(b.potential_savings).minus(
      new Decimal(a.potential_savings),
    );
    return diff.isZero() ? 0 : diff.isPositive() ? 1 : -1;
  });

  return savingOpportunitiesOutput.parse(stripPII({ opportunities }));
};
