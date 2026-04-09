/**
 * `property_account` — subtype detail for `account.account_type =
 * 'property'`. Houses, cars, manually-valued assets.
 *
 * Valuations are NOT stored here — they live in `entry` rows with
 * `entryable_type = 'valuation'`, so the net-worth history is just a query
 * over the entry timeline. This table holds the static metadata (address,
 * purchase info) and lets the UI show a nice "property" card.
 */
import {
  date,
  numeric,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';

import { account } from './account.ts';

export const propertyAccount = pgTable('property_account', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => account.id, { onDelete: 'cascade' }),
  /** Free-form address/description. Not validated — "1 Main St" or
   *  "2018 Honda Civic" are both fine. */
  address: text('address'),
  purchaseDate: date('purchase_date', { mode: 'date' }),
  /** Price paid at acquisition. `NUMERIC(19,4)`. */
  purchasePrice: numeric('purchase_price', { precision: 19, scale: 4 }),
});

export type PropertyAccount = typeof propertyAccount.$inferSelect;
export type NewPropertyAccount = typeof propertyAccount.$inferInsert;
