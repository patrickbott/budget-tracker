/**
 * `transfer_candidate` — a heuristically-detected pair of entries that look
 * like a transfer between two owned accounts. Produced post-sync by
 * `detectAndPersistTransferCandidates` in `packages/jobs/src/ingest/`; the
 * user then confirms or dismisses each candidate from the transactions UI.
 *
 * A candidate starts as `pending`. On confirm, both referenced entries have
 * their `entryableType` flipped to `'transfer'` and the candidate row is
 * marked `confirmed`. On dismiss, the candidate row is marked `dismissed`
 * and the two entries are left untouched. We deliberately preserve the two
 * original entry rows on confirmation rather than collapsing them into a
 * single synthetic transfer entry — that keeps the audit trail intact and
 * means dismissing later (e.g. if the user changes their mind) is a pure
 * status flip rather than a re-materialization.
 *
 * The `(entry_a_id, entry_b_id)` unique index prevents the detector from
 * creating duplicate candidates for the same pair across repeated sync runs
 * — we re-run detection on every sync and rely on `onConflictDoNothing` to
 * skip pairs we already know about.
 */
import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { entry } from './entry.ts';
import { family } from './family.ts';

/** Lifecycle states for a detected transfer candidate. */
export const transferCandidateStatusEnum = pgEnum('transfer_candidate_status', [
  'pending',
  'confirmed',
  'dismissed',
]);

export const transferCandidate = pgTable(
  'transfer_candidate',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    /** The positive-amount leg of the detected pair. */
    entryAId: text('entry_a_id')
      .notNull()
      .references(() => entry.id, { onDelete: 'cascade' }),
    /** The negative-amount leg of the detected pair. */
    entryBId: text('entry_b_id')
      .notNull()
      .references(() => entry.id, { onDelete: 'cascade' }),
    /** 0..1 confidence from the core transfers heuristic. `numeric(3,2)`
     *  keeps the value exact without floating-point drift. */
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    status: transferCandidateStatusEnum('status').notNull().default('pending'),
    detectedAt: timestamp('detected_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** Set when the candidate transitions out of `pending`. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    // Prevents duplicate candidates for the same pair across sync runs.
    uniqueIndex('transfer_candidate_pair_idx').on(
      table.entryAId,
      table.entryBId,
    ),
    // Primary list query: pending candidates for this family, most
    // confident first (ordering applied in SQL, not in the index).
    index('transfer_candidate_family_status_idx').on(
      table.familyId,
      table.status,
    ),
  ],
);

export type TransferCandidate = typeof transferCandidate.$inferSelect;
export type NewTransferCandidate = typeof transferCandidate.$inferInsert;
