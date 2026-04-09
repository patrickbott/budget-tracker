/**
 * `category` — per-family spending/income taxonomy with nesting.
 *
 * Self-referential: `parent_id` points at another category in the same
 * family. Two-level trees are the sweet spot (e.g. "Food → Groceries",
 * "Food → Dining"), but deeper nesting is permitted. The app layer rejects
 * cycles; there is no DB-level cycle check (Postgres doesn't make that easy
 * without triggers, and the blast radius of a cycle here is low — budget
 * rollups just loop until the query runs out).
 *
 * `kind` separates user-facing categories (`income`, `expense`) from
 * internal categories (`transfer`, `equity`) that the rules engine uses to
 * keep transfers out of spending totals.
 */
import {
  type AnyPgColumn,
  index,
  integer,
  boolean,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { categoryKindEnum } from './enums.ts';
import { family } from './family.ts';

export const category = pgTable(
  'category',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Self-reference: NULL for top-level categories. */
    parentId: text('parent_id').references((): AnyPgColumn => category.id, {
      onDelete: 'set null',
    }),
    kind: categoryKindEnum('kind').notNull().default('expense'),
    /** Hex color for the UI chip, e.g. "#10b981". */
    color: text('color'),
    /** Lucide icon name, e.g. "shopping-cart". */
    icon: text('icon'),
    /** UI sort order within the parent. */
    sortOrder: integer('sort_order').notNull().default(0),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('category_family_idx').on(table.familyId),
    index('category_parent_idx').on(table.parentId),
  ],
);

export type Category = typeof category.$inferSelect;
export type NewCategory = typeof category.$inferInsert;
