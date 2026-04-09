/**
 * `credit_card_account` — subtype detail for `account.account_type =
 * 'credit_card'`. See `account-depository.ts` for the polymorphism rationale.
 */
import { integer, numeric, pgTable, text } from 'drizzle-orm/pg-core';

import { account } from './account.ts';

export const creditCardAccount = pgTable('credit_card_account', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => account.id, { onDelete: 'cascade' }),
  institutionName: text('institution_name'),
  /** Credit limit as exposed by the issuer. `NUMERIC(19,4)`. Nullable
   *  because SimpleFIN doesn't always surface it. */
  creditLimit: numeric('credit_limit', { precision: 19, scale: 4 }),
  /** Annual percentage rate as a decimal (0.1999 = 19.99%). Nullable. */
  apr: numeric('apr', { precision: 7, scale: 4 }),
  /** Day of the month the statement closes (1–31). */
  statementDay: integer('statement_day'),
  /** Last 4 digits of the card number. Full numbers are NEVER stored. */
  cardNumberLast4: text('card_number_last4'),
});

export type CreditCardAccount = typeof creditCardAccount.$inferSelect;
export type NewCreditCardAccount = typeof creditCardAccount.$inferInsert;
