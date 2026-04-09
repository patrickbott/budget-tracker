/**
 * `insight` — archive of AI-generated weekly / monthly reports.
 *
 * Produced by the `weekly-insights` pg-boss cron in `packages/jobs`, which
 * kicks off a Haiku conversation with the same typed tool set the chat UI
 * uses. The model composes a markdown report; we persist it here so the
 * user can scroll back through past insights without re-running the job.
 *
 * `tool_calls_json` is the audit trail: which tools the model called, with
 * what args, and what results came back (PII-stripped). Used for debugging
 * model behavior and for the AI usage report.
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

import { insightPeriodEnum } from './enums.ts';
import { family } from './family.ts';

export const insight = pgTable(
  'insight',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    period: insightPeriodEnum('period').notNull(),
    periodStart: date('period_start', { mode: 'date' }).notNull(),
    periodEnd: date('period_end', { mode: 'date' }).notNull(),
    markdownBody: text('markdown_body').notNull(),
    /** Opaque JSON audit of tool_use blocks from the generating conversation. */
    toolCallsJson: jsonb('tool_calls_json').$type<Array<{
      name: string;
      input: Record<string, unknown>;
      output: unknown;
    }>>(),
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    tokensUsed: numeric('tokens_used', { precision: 12, scale: 0 })
      .notNull()
      .default('0'),
    /** Estimated USD cost at generation time. `NUMERIC(10,6)` — we want
     *  six decimal places so a $0.0003 Haiku call doesn't round to zero. */
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 })
      .notNull()
      .default('0'),
  },
  (table) => [
    index('insight_family_period_idx').on(
      table.familyId,
      table.period,
      table.periodStart,
    ),
  ],
);

export type Insight = typeof insight.$inferSelect;
export type NewInsight = typeof insight.$inferInsert;
