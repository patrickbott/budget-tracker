/**
 * `investment_account` — subtype detail for `account.account_type =
 * 'investment'`. Brokerages, retirement accounts, HSAs.
 *
 * SimpleFIN Bridge does NOT provide holdings data — only top-level balance.
 * Investment holdings (positions, cost basis, lot tracking) land in Phase 5
 * via broker CSV import. For Phase 0b, this sub-table just holds the
 * informational tax-wrapper.
 */
import { pgTable, text } from 'drizzle-orm/pg-core';

import { account } from './account.ts';
import { investmentSubtypeEnum } from './enums.ts';

export const investmentAccount = pgTable('investment_account', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => account.id, { onDelete: 'cascade' }),
  institutionName: text('institution_name'),
  subtype: investmentSubtypeEnum('subtype').notNull().default('brokerage'),
  /** Last 4 digits of the account number. */
  accountNumberLast4: text('account_number_last4'),
});

export type InvestmentAccount = typeof investmentAccount.$inferSelect;
export type NewInvestmentAccount = typeof investmentAccount.$inferInsert;
