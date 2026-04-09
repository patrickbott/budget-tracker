/**
 * `depository_account` — subtype detail for `account.account_type =
 * 'depository'`. One-to-one with `account`; PK is the same `account_id`.
 *
 * We use separate sub-tables instead of a JSONB `type_data` column because
 * query planning is much better on real columns, and because these fields
 * are stable enough that we rarely add new ones after Phase 0b.
 *
 * Sub-table rows must be deleted when the parent `account` row is deleted;
 * this is enforced by the ON DELETE CASCADE on the FK.
 */
import { pgTable, text } from 'drizzle-orm/pg-core';

import { account } from './account.ts';
import { depositorySubtypeEnum } from './enums.ts';

export const depositoryAccount = pgTable('depository_account', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => account.id, { onDelete: 'cascade' }),
  subtype: depositorySubtypeEnum('subtype').notNull().default('checking'),
  institutionName: text('institution_name'),
  /** Bank routing number (US) — stored lightly and only when the user
   *  enters it; never pulled from SimpleFIN (which doesn't expose it). */
  routingNumber: text('routing_number'),
  /** Last 4 digits of the account number. Full numbers are NEVER stored. */
  accountNumberLast4: text('account_number_last4'),
});

export type DepositoryAccount = typeof depositoryAccount.$inferSelect;
export type NewDepositoryAccount = typeof depositoryAccount.$inferInsert;
