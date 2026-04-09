/**
 * `budget` — per-category, per-period budget row.
 *
 * The hybrid-flexibility design: every budget has a `mode` of either
 * `hard_cap` (do not exceed) or `forecast` (expected baseline, warn on
 * drift). Unlike YNAB's envelope model, each category can be either mode
 * independently — so a user can say "rent is forecast, dining is hard cap"
 * without adopting a single top-down methodology.
 *
 * `amount` is the budget limit (hard_cap) or target (forecast). Drizzle
 * returns `NUMERIC` as strings; pass through decimal.js for math.
 *
 * `rollover` controls end-of-period behavior:
 *   `none`              — budget resets each period; unspent vanishes.
 *   `rollover_positive` — unspent is carried forward to next period.
 *   `rollover_all`      — both positive and negative balances carry.
 */
import {
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  budgetModeEnum,
  budgetPeriodEnum,
  budgetRolloverEnum,
} from './enums.ts';
import { category } from './category.ts';
import { family } from './family.ts';

export const budget = pgTable(
  'budget',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => category.id, { onDelete: 'cascade' }),
    period: budgetPeriodEnum('period').notNull().default('monthly'),
    /** First day of the period window, e.g. `2026-04-01` for the April
     *  monthly budget. Each period gets its own row. */
    periodStart: date('period_start', { mode: 'date' }).notNull(),
    /** `NUMERIC(19,4)`. Use decimal.js for all math. */
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    mode: budgetModeEnum('mode').notNull().default('hard_cap'),
    rollover: budgetRolloverEnum('rollover').notNull().default('none'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // "Show me the current budget status" looks up by (family, category,
    // period_start). Making it unique prevents two budget rows for the same
    // (category, period) window.
    uniqueIndex('budget_family_category_period_idx').on(
      table.familyId,
      table.categoryId,
      table.period,
      table.periodStart,
    ),
    index('budget_family_period_start_idx').on(table.familyId, table.periodStart),
  ],
);

export type Budget = typeof budget.$inferSelect;
export type NewBudget = typeof budget.$inferInsert;
