/**
 * `netWorth` — asset / liability / net worth across all accounts.
 *
 * Account-type classification:
 *   - Assets:      depository, investment, property, crypto, other
 *   - Liabilities: credit_card, loan
 *
 * Liability balances are stored as negative numbers elsewhere in the app
 * (per the signed convention). This function surfaces `liability` as a
 * positive number so `net = asset - liability` reads naturally in UI
 * and AI contexts. `byAccountType` preserves the original signed total
 * per type, so the dashboard can show a "credit cards: -$2,340" row
 * without having to re-sum or re-sign anything.
 */

import Decimal from 'decimal.js';

import type { ReportAccountInput } from './types.ts';

const LIABILITY_TYPES: ReadonlySet<ReportAccountInput['accountType']> = new Set([
  'credit_card',
  'loan',
]);

export function netWorth(input: {
  accounts: readonly ReportAccountInput[];
}): {
  asset: string;
  liability: string;
  net: string;
  byAccountType: Record<string, string>;
} {
  let asset = new Decimal(0);
  let liability = new Decimal(0);
  const byType = new Map<string, Decimal>();

  for (const account of input.accounts) {
    const balance = new Decimal(account.balance);
    const prev = byType.get(account.accountType);
    byType.set(account.accountType, prev ? prev.plus(balance) : balance);

    if (LIABILITY_TYPES.has(account.accountType)) {
      liability = liability.plus(balance.abs());
    } else {
      asset = asset.plus(balance);
    }
  }

  const byAccountType: Record<string, string> = {};
  for (const [type, total] of byType) {
    byAccountType[type] = total.toFixed(2);
  }

  return {
    asset: asset.toFixed(2),
    liability: liability.toFixed(2),
    net: asset.minus(liability).toFixed(2),
    byAccountType,
  };
}
