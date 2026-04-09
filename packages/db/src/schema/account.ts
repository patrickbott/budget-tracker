/**
 * `account` — the polymorphic base table for every financial account a
 * family holds: checking, savings, credit cards, loans, brokerages, property,
 * crypto. Subtype-specific columns live in the matching `<type>_account`
 * sub-tables (see `account-depository.ts`, etc.).
 *
 * This is the domain "account" — NOT Better Auth's `account` table. BA's
 * auth-provider account table is renamed to `auth_account` in SQL; see
 * `auth.ts` for the naming rationale.
 *
 * Invariants (enforced at both the app and DB layer):
 *   1. `family_id` is non-null and RLS-scoped — a family can never see
 *      another family's accounts even if the app layer has a bug.
 *   2. `visibility = 'personal'` ⇒ `owner_user_id IS NOT NULL`, and the
 *      owner must be a member of this family. The RLS policy
 *      `personal_owner_isolation` enforces visibility at read time.
 *   3. `balance` is `NUMERIC(19,4)`. Drizzle returns this as a string; pass
 *      it through `decimal.js` before any math.
 *
 * See `docs/data-model.md#account` for the full field reference.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { accountTypeEnum, accountVisibilityEnum } from './enums.ts';
import { connection } from './connection.ts';
import { family } from './family.ts';
import { user } from './auth.ts';

export const account = pgTable(
  'account',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    accountType: accountTypeEnum('account_type').notNull(),
    /** ISO 4217 currency code. Defaults to the family's base currency but
     *  can diverge for foreign-currency accounts. */
    currency: text('currency').notNull().default('USD'),
    visibility: accountVisibilityEnum('visibility').notNull().default('household'),
    /** Required when `visibility = 'personal'`. Enforced by a CHECK in
     *  migration 0000 (written by drizzle-kit). The RLS policy
     *  `personal_owner_isolation` uses this to gate reads. */
    ownerUserId: text('owner_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    /** Last-known authoritative balance. `NUMERIC(19,4)` — never `parseFloat`.
     *  Drizzle returns this as a string; use decimal.js for math. */
    balance: numeric('balance', { precision: 19, scale: 4 }).notNull().default('0'),
    /** Timestamp of the balance snapshot above, matching SimpleFIN's
     *  `balance-date`. NULL on fresh manual accounts. */
    balanceAsOf: timestamp('balance_as_of', { withTimezone: true, mode: 'date' }),
    /** True if this account is not synced via SimpleFIN (manual entries only). */
    isManual: boolean('is_manual').notNull().default(false),
    /** Hidden from the default dashboard views. */
    isClosed: boolean('is_closed').notNull().default(false),
    /** Opaque SimpleFIN account ID. May change on re-link — the UI walks
     *  the user through mapping old→new IDs so historical data stays
     *  attached. Unique per (connection, id), but not globally. */
    simplefinAccountId: text('simplefin_account_id'),
    /** Nullable: set for SimpleFIN-synced accounts, null for fully manual. */
    connectionId: text('connection_id').references(() => connection.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // "Show my accounts, ordered by type, within a family" — dashboard view.
    index('account_family_type_idx').on(table.familyId, table.accountType),
    // SimpleFIN dedup lookup: "does this connection already know about this
    // upstream account id?" Partial index — only SimpleFIN-synced rows have
    // a non-null `simplefin_account_id`, and two manual accounts with no
    // upstream id should coexist without uniqueness conflicts.
    uniqueIndex('account_connection_simplefin_idx')
      .on(table.connectionId, table.simplefinAccountId)
      .where(sql`${table.simplefinAccountId} IS NOT NULL`),
  ],
);

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
