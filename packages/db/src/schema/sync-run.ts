/**
 * `sync_run` — audit log of every SimpleFIN pull.
 *
 * Invaluable for debugging ghost transactions, duplicate detection edge
 * cases, and upstream changes we didn't expect. The gzipped raw response is
 * kept for 7 days (pruned nightly by a pg-boss job); after that, we only
 * keep the lightweight metadata.
 *
 * `raw_response_gzip` is stored as `bytea` (the Postgres byte-array type).
 * In Drizzle we declare it as `bytea('raw_response_gzip')` — Drizzle doesn't
 * have a first-class bytea helper, so we use `customType` — but for Phase 0b
 * we just use a raw SQL default and skip the helper. The column is
 * nullable because the pruner nulls it out after 7 days.
 */
import {
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { syncRunStatusEnum } from './enums.ts';
import { connection } from './connection.ts';
import { family } from './family.ts';

/** Postgres `bytea` column, represented as a `Buffer` in application code. */
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const syncRun = pgTable(
  'sync_run',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    status: syncRunStatusEnum('status').notNull().default('pending'),
    /** Inclusive start of the trailing window we requested from SimpleFIN. */
    requestRangeStart: date('request_range_start', { mode: 'date' }),
    requestRangeEnd: date('request_range_end', { mode: 'date' }),
    /** Gzipped `/accounts` JSON response. Nulled out by the 7-day pruner. */
    rawResponseGzip: bytea('raw_response_gzip'),
    transactionsCreated: integer('transactions_created').notNull().default(0),
    transactionsUpdated: integer('transactions_updated').notNull().default(0),
    /** Raw `errlist` array from SimpleFIN, if the upstream returned
     *  per-institution errors. Null on success. */
    errlistJson: jsonb('errlist_json').$type<string[]>(),
  },
  (table) => [
    // "Show me the most recent sync runs for this connection" — the usual
    // debug query.
    index('sync_run_connection_started_idx').on(
      table.connectionId,
      table.startedAt,
    ),
    index('sync_run_family_idx').on(table.familyId),
  ],
);

export type SyncRun = typeof syncRun.$inferSelect;
export type NewSyncRun = typeof syncRun.$inferInsert;
