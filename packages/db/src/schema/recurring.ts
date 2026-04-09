/**
 * `recurring` — a recurring transaction series (subscription, rent, salary).
 *
 * Detected automatically from the transaction history by scanning for
 * repeating (merchant, amount, cadence) tuples. The user can confirm / edit
 * / create these by hand. The app layer owns `missing_dates` computation —
 * it's the set of expected dates minus the dates of matched entries in the
 * window — and the AI coaching layer uses it to surface "rent is 3 days
 * late" alerts.
 *
 * For Phase 0b this is a simple row; the detection + missing_dates compute
 * lives in `packages/core/recurring/`.
 */
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { recurringCadenceEnum } from './enums.ts';
import { account } from './account.ts';
import { category } from './category.ts';
import { entry } from './entry.ts';
import { family } from './family.ts';

export const recurring = pgTable(
  'recurring',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    cadence: recurringCadenceEnum('cadence').notNull(),
    /** Combined with `cadence` to express "every N units", e.g.
     *  `cadence='monthly', cadence_interval=2` → "every 2 months". */
    cadenceInterval: integer('cadence_interval').notNull().default(1),
    /** `NUMERIC(19,4)`. Signed — positive for income, negative for
     *  expenses (mirrors entry_line sign convention). */
    expectedAmount: numeric('expected_amount', { precision: 19, scale: 4 }).notNull(),
    /** Fraction tolerance for "is this the same amount?". e.g. 0.05 = 5%. */
    amountTolerancePct: numeric('amount_tolerance_pct', {
      precision: 5,
      scale: 4,
    })
      .notNull()
      .default('0.05'),
    /** Expected to land on this account. NULL for cross-account patterns. */
    expectedAccountId: text('expected_account_id').references(() => account.id, {
      onDelete: 'set null',
    }),
    categoryId: text('category_id').references(() => category.id, {
      onDelete: 'set null',
    }),
    lastMatchedEntryId: text('last_matched_entry_id').references(() => entry.id, {
      onDelete: 'set null',
    }),
    lastMatchedDate: date('last_matched_date', { mode: 'date' }),
    /** Computed by the app layer on read — the set of expected dates that
     *  have no matching entry yet. Stored as a snapshot so the coaching
     *  layer doesn't have to recompute from scratch every time.
     *  Array of ISO date strings, e.g. ['2026-04-01']. */
    missingDates: jsonb('missing_dates').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('recurring_family_idx').on(table.familyId),
  ],
);

export type Recurring = typeof recurring.$inferSelect;
export type NewRecurring = typeof recurring.$inferInsert;
