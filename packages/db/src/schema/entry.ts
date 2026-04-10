/**
 * `entry` — the unified financial-event table. Every bank transaction,
 * transfer, manual valuation, and (Phase 5) investment trade becomes one
 * `entry` with ≥2 `entry_line` rows summing to zero.
 *
 * Polymorphism: `entryable_type` tags the kind (transaction/transfer/
 * valuation/trade) and `entryable_id` optionally points at a detail row in a
 * subtype-specific table. Most entry types don't need a detail row — a
 * `transaction` is fully described by its `entry_line`s plus the `entry`
 * columns, and a `transfer` is an entry whose lines touch two owned accounts.
 *
 * For Phase 0b, `entryable_id` is nullable and unused. Phase 5 adds a
 * `trade` detail table with per-security quantity / price / fees; the FK
 * there will be `trade.entry_id → entry.id`, and `entry.entryable_id` will
 * remain a loose tag that the app resolves based on `entryable_type`.
 *
 * Invariant: `SUM(entry_line.amount) WHERE entry_id = entry.id = 0`.
 * Enforced by the deferred constraint trigger in
 * `migrations/0002_entry_line_balance.sql`.
 */
import {
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { entrySourceEnum, entryableTypeEnum } from './enums.ts';
import { family } from './family.ts';

export const entry = pgTable(
  'entry',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    /** "When did this happen" date — what SimpleFIN calls `posted` (for
     *  posted transactions) or the pending date (for pending ones). */
    entryDate: date('entry_date', { mode: 'date' }).notNull(),
    entryableType: entryableTypeEnum('entryable_type').notNull().default('transaction'),
    /** Optional detail-row FK. For Phase 0b this is always NULL; Phase 5
     *  wires it up for trades. */
    entryableId: text('entryable_id'),
    /** The human-readable description. SimpleFIN truncates this to ~32
     *  chars; the app may enrich it via rules. */
    description: text('description').notNull(),
    /** User-written notes, shown in the transaction detail drawer. */
    notes: text('notes'),
    source: entrySourceEnum('source').notNull().default('manual'),
    /** `true` when SimpleFIN marks the transaction pending. Auto-flips to
     *  false on the next sync that sees a matching posted transaction. */
    isPending: boolean('is_pending').notNull().default(false),
    /** Opaque SimpleFIN transaction id. Unique only within its parent
     *  SimpleFIN account — the dedup key is (source, external_account_id,
     *  external_id). See docs/simplefin-notes.md §2. */
    externalId: text('external_id'),
    /** The SimpleFIN account id this entry was pulled from. Stored on the
     *  entry row (not resolved via account.simplefin_account_id) because
     *  re-linking changes the account mapping but historical entries keep
     *  their original external ids. See docs/simplefin-notes.md §3. */
    externalAccountId: text('external_account_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Primary timeline query: "show me transactions for this family,
    // newest first".
    index('entry_family_date_idx').on(table.familyId, table.entryDate),
  ],
);

export type Entry = typeof entry.$inferSelect;
export type NewEntry = typeof entry.$inferInsert;
