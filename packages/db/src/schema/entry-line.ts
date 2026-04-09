/**
 * `entry_line` — the double-entry row. Each `entry` has ≥2 `entry_line` rows
 * whose signed `amount` values sum to zero.
 *
 * This is the Firefly-III trick that makes the whole schema work: splits,
 * transfers, refunds, and multi-currency all collapse into one mechanism.
 * A plain-vanilla $50 grocery transaction looks like:
 *
 *   +50.00 on Checking (account_id = checking)
 *   -50.00 on Groceries (account_id = NULL, category_id = groceries)
 *
 * (The sign convention here: a positive amount is "money arriving at this
 * leg of the entry". For an expense, money arrives at the expense category
 * line and leaves the asset account line.)
 *
 * A transfer from Checking to Savings:
 *
 *   -200.00 on Checking  (account_id = checking, category_id = NULL)
 *   +200.00 on Savings   (account_id = savings,  category_id = NULL)
 *
 * A split ($50 groceries → $30 food + $20 household):
 *
 *   +50.00 on Checking
 *   -30.00 on Groceries
 *   -20.00 on Household
 *
 * Sum: 0 in all cases.
 *
 * Invariant enforcement:
 *   - App layer: `packages/core/entries/validateEntryLines` refuses to
 *     persist an unbalanced entry.
 *   - DB layer: the deferred constraint trigger in
 *     `migrations/0002_entry_line_balance.sql` raises an exception at
 *     transaction commit if any entry's lines don't sum to zero.
 */
import { index, numeric, pgTable, text } from 'drizzle-orm/pg-core';

import { account } from './account.ts';
import { category } from './category.ts';
import { entry } from './entry.ts';

export const entryLine = pgTable(
  'entry_line',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    entryId: text('entry_id')
      .notNull()
      .references(() => entry.id, { onDelete: 'cascade' }),
    /** The asset/liability account this leg touches. NULL for category-side
     *  legs (e.g. the "Groceries" leg of a standard transaction). */
    accountId: text('account_id').references(() => account.id, {
      onDelete: 'cascade',
    }),
    /** The category for category-side legs. NULL on the asset-side leg. */
    categoryId: text('category_id').references(() => category.id, {
      onDelete: 'set null',
    }),
    /** Signed amount. `NUMERIC(19,4)`. Drizzle returns this as a string;
     *  ALWAYS pass it through decimal.js for math. Never `parseFloat`. */
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    /** Per-line memo, visible in the transaction detail drawer. */
    memo: text('memo'),
  },
  (table) => [
    index('entry_line_entry_idx').on(table.entryId),
    // For "spending by category in a date range" reports. Joined to `entry`
    // via `entry_id` to get the date.
    index('entry_line_category_idx').on(table.categoryId),
    // For "show me transactions on this account".
    index('entry_line_account_idx').on(table.accountId),
  ],
);

export type EntryLine = typeof entryLine.$inferSelect;
export type NewEntryLine = typeof entryLine.$inferInsert;
