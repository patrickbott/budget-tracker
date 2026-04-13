/**
 * `coaching_alert` — ephemeral proactive coaching alerts.
 *
 * Generated nightly by the `coaching` pg-boss cron in `packages/jobs`.
 * The worker calls ToolLoaders directly for budget/recurring data, feeds
 * structured results to a single Haiku call, and persists 0-3 actionable
 * alerts per family. Alerts expire (budget alerts at month end, recurring
 * alerts after 7 days) and can be dismissed from the dashboard.
 */
import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { coachingAlertTypeEnum, coachingAlertSeverityEnum } from './enums.ts';
import { family } from './family.ts';

export const coachingAlert = pgTable(
  'coaching_alert',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    alertType: coachingAlertTypeEnum('alert_type').notNull(),
    severity: coachingAlertSeverityEnum('severity').notNull(),
    /** Short headline, e.g. "Dining budget on pace to exceed by $80". */
    title: text('title').notNull(),
    /** 1-3 sentence markdown explanation. */
    body: text('body').notNull(),
    dismissed: boolean('dismissed').notNull().default(false),
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** Alerts are ephemeral — month end for budget alerts, 7 days for recurring. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' })
      .notNull(),
    tokensUsed: numeric('tokens_used', { precision: 12, scale: 0 })
      .notNull()
      .default('0'),
    /** Estimated USD cost at generation time. */
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 })
      .notNull()
      .default('0'),
  },
  (table) => [
    index('coaching_alert_family_active_idx').on(
      table.familyId,
      table.dismissed,
      table.expiresAt,
    ),
  ],
);

export type CoachingAlert = typeof coachingAlert.$inferSelect;
export type NewCoachingAlert = typeof coachingAlert.$inferInsert;
