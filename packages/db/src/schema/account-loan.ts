/**
 * `loan_account` — subtype detail for `account.account_type = 'loan'`.
 * Mortgages, auto loans, student loans, personal loans.
 */
import {
  date,
  integer,
  numeric,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';

import { account } from './account.ts';

export const loanAccount = pgTable('loan_account', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => account.id, { onDelete: 'cascade' }),
  institutionName: text('institution_name'),
  /** Principal at origination. `NUMERIC(19,4)`. */
  originalPrincipal: numeric('original_principal', { precision: 19, scale: 4 }),
  /** Interest rate as a decimal (0.0625 = 6.25%). */
  interestRate: numeric('interest_rate', { precision: 7, scale: 4 }),
  /** Loan term in months (e.g. 360 for a 30-year mortgage). */
  termMonths: integer('term_months'),
  firstPaymentDate: date('first_payment_date', { mode: 'date' }),
  payoffDate: date('payoff_date', { mode: 'date' }),
  /** Fixed monthly payment (P+I, excludes escrow). `NUMERIC(19,4)`. */
  monthlyPayment: numeric('monthly_payment', { precision: 19, scale: 4 }),
});

export type LoanAccount = typeof loanAccount.$inferSelect;
export type NewLoanAccount = typeof loanAccount.$inferInsert;
