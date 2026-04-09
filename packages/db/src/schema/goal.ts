/**
 * `goal` — savings / debt-payoff / net-worth target.
 *
 * Progress is computed on read from current account balances and historical
 * entries — no progress column is persisted here. The projected completion
 * date is computed by `packages/core/reports/` using a linear fit over the
 * last N periods of relevant account deltas.
 *
 * `linkedAccountIds` is a JSONB array of account ids (text). For a savings
 * goal, it's the set of accounts whose balance counts toward progress. For
 * a debt-payoff goal, it's the set of liability accounts being paid down.
 * For a net-worth goal, it's usually all accounts (but can be restricted).
 */
import {
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { goalStatusEnum, goalTypeEnum } from './enums.ts';
import { family } from './family.ts';

export const goal = pgTable(
  'goal',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    goalType: goalTypeEnum('goal_type').notNull(),
    /** `NUMERIC(19,4)`. Target balance for savings, remaining principal for
     *  debt payoff, target net worth otherwise. */
    targetAmount: numeric('target_amount', { precision: 19, scale: 4 }).notNull(),
    targetDate: date('target_date', { mode: 'date' }),
    /** Array of `account.id` values that count toward this goal. App layer
     *  validates the FKs on write — Postgres arrays don't support FK
     *  constraints natively. */
    linkedAccountIds: jsonb('linked_account_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    status: goalStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('goal_family_idx').on(table.familyId)],
);

export type Goal = typeof goal.$inferSelect;
export type NewGoal = typeof goal.$inferInsert;
