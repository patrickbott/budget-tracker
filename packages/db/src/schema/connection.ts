/**
 * `connection` — one row per SimpleFIN Bridge link.
 *
 * The Access URL is the single long-lived credential SimpleFIN gives us, and
 * it alone grants read access to the linked institutions. It MUST be stored
 * encrypted at rest (see `packages/simplefin`): the encryption uses
 * `ENCRYPTION_MASTER_KEY` plus a per-family salt, so stealing the database
 * without the running app's env leaks nothing usable.
 *
 * A family can have multiple connections (e.g. one per SimpleFIN Bridge
 * account, if the user linked banks in batches).
 */
import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { connectionStatusEnum } from './enums.ts';
import { family } from './family.ts';

export const connection = pgTable(
  'connection',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    /**
     * Encrypted SimpleFIN Access URL (never plaintext). The encryption
     * envelope format is owned by `packages/simplefin`'s crypto helper; this
     * column just stores the opaque ciphertext string.
     */
    accessUrlEncrypted: text('access_url_encrypted').notNull(),
    /** Human-readable nickname the user sees, e.g. "Chase + Amex". */
    nickname: text('nickname'),
    status: connectionStatusEnum('status').notNull().default('active'),
    lastSyncedAt: timestamp('last_synced_at', {
      withTimezone: true,
      mode: 'date',
    }),
    /** Last error message surfaced to the user. Cleared on successful sync. */
    lastError: text('last_error'),
    /**
     * Last raw `errlist` payload from SimpleFIN `/accounts`. Kept separate
     * from `lastError` so we can show a full list of per-institution errors
     * in the UI without mangling them into a single string.
     */
    lastErrlist: jsonb('last_errlist').$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Most reads are "show all connections for this family, newest first".
    index('connection_family_idx').on(table.familyId),
  ],
);

export type Connection = typeof connection.$inferSelect;
export type NewConnection = typeof connection.$inferInsert;
