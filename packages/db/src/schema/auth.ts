/**
 * Better Auth core tables: `user`, `session`, `authAccount`, `verification`.
 *
 * These tables follow Better Auth's documented shape exactly so the Drizzle
 * adapter can bind them without any field renames:
 *   https://www.better-auth.com/docs/concepts/database#core-schema
 *
 * ---------------------------------------------------------------------------
 * Naming note — BA's `account` table vs our domain `account` table
 * ---------------------------------------------------------------------------
 * Better Auth calls its OAuth-provider + credential-storage table `account`,
 * which would collide with our polymorphic financial `account` table. We
 * resolve the collision by renaming BA's table to `auth_account` at the
 * Postgres layer and exporting it as `authAccount` in TypeScript.
 *
 * Instance B must tell Better Auth about this rename. Two equivalent options:
 *
 *   (1) Pass the Drizzle table reference directly to the adapter:
 *       drizzleAdapter(db, {
 *         provider: 'pg',
 *         schema: { user, session, verification, account: authAccount },
 *       })
 *
 *   (2) Use BA's top-level `account.modelName` override:
 *       betterAuth({
 *         ...,
 *         account: { modelName: 'auth_account' },
 *       })
 *
 * Either approach works; the adapter binding (1) is more self-contained.
 * ---------------------------------------------------------------------------
 *
 * ID strategy: Better Auth generates UUID strings in application code, so
 * every `id` column is `text` with no database-side default.
 *
 * RLS: auth tables are NOT row-level-secured. They are scoped by session
 * cookie, not by family_id. See migrations/0001_rls_policies.sql for the
 * full list of tables that do get RLS.
 */
import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Better Auth `user` — one row per authenticated identity.
 *
 * A single user can belong to multiple families via `membership` rows.
 * Column names match BA's documented defaults; the `casing: 'snake_case'`
 * option on drizzle-kit maps `emailVerified` → `email_verified`, etc.
 */
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

/**
 * Better Auth `session` — one row per active login.
 *
 * `activeOrganizationId` is added by the BA `organization` plugin and points
 * at `family.id` (since we remap organization→family via modelName). The
 * column is nullable because a user can be logged in before selecting a
 * family.
 */
export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  // Added by the Better Auth organization plugin. Nullable: set after the
  // user picks an active family for this session.
  activeOrganizationId: text('active_organization_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

/**
 * Better Auth `account` — OAuth provider links AND credential-provider
 * password storage. Renamed to `auth_account` in SQL to leave the bare name
 * `account` available for our polymorphic financial account table.
 *
 * See the naming note at the top of this file for the Instance B wiring.
 */
export const authAccount = pgTable('auth_account', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', {
    withTimezone: true,
    mode: 'date',
  }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
    withTimezone: true,
    mode: 'date',
  }),
  scope: text('scope'),
  idToken: text('id_token'),
  // Present only for the `credential` provider (email+password); stored as a
  // BA-formatted hash string.
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

/**
 * Better Auth `verification` — short-lived token rows for magic links,
 * email verification, password reset, etc. Expired rows are swept by BA.
 */
export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});
