/**
 * `ai_usage` — per-family / per-day / per-model token + cost accounting.
 *
 * Aggregated rows, not one per API call — each row is the rollup for a
 * (family, date, model) tuple. The pre-call guard reads these rows to
 * enforce the hard monthly spend cap (default $10, configurable via
 * `AI_MONTHLY_SPEND_CAP_USD`).
 *
 * Primary key is the composite `(family_id, date, model)`. Upsert on
 * conflict to atomically increment counters.
 */
import {
  date,
  numeric,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';

import { family } from './family.ts';

export const aiUsage = pgTable(
  'ai_usage',
  {
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    /** UTC date of the rollup window. */
    date: date('date', { mode: 'date' }).notNull(),
    /** Anthropic model id, e.g. 'claude-opus-4-6' or 'claude-haiku-4-5-20251001'. */
    model: text('model').notNull(),
    inputTokens: numeric('input_tokens', { precision: 14, scale: 0 })
      .notNull()
      .default('0'),
    outputTokens: numeric('output_tokens', { precision: 14, scale: 0 })
      .notNull()
      .default('0'),
    /** Accumulated USD cost for the day. `NUMERIC(12,6)`. */
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
  },
  (table) => [
    primaryKey({
      name: 'ai_usage_pk',
      columns: [table.familyId, table.date, table.model],
    }),
  ],
);

export type AiUsage = typeof aiUsage.$inferSelect;
export type NewAiUsage = typeof aiUsage.$inferInsert;
