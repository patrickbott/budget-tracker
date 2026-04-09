/**
 * `family` — the tenant root. Every domain row scopes through `family_id`.
 *
 * This table IS Better Auth's `organization` table, remapped via the BA
 * organization plugin's `modelName` option:
 *
 *   organization({ schema: { organization: { modelName: 'family' } } })
 *
 * The column set therefore matches BA's documented `organization` shape
 * exactly (id, name, slug, logo, metadata, createdAt) — BA generates queries
 * against those camelCase field names, which drizzle-kit maps to snake_case.
 *
 * Domain additions on top of BA's shape:
 *   - `baseCurrency`  (ISO 4217, default 'USD') — what "native currency"
 *     means for this family's rolled-up net worth numbers. Non-BA column,
 *     added via Drizzle and ignored by Better Auth.
 *   - `timezone`      (IANA, default 'America/New_York') — used by the sync
 *     cron to pick a local-midnight window.
 *
 * Both additions must be nullable OR have a DB default so that BA's insert
 * queries (which only populate BA-canonical columns) succeed without
 * specifying them.
 */
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const family = pgTable('family', {
  // Better Auth organization-canonical columns (required).
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),

  // Domain additions (not populated by Better Auth — DB defaults required).
  baseCurrency: text('base_currency').notNull().default('USD'),
  timezone: text('timezone').notNull().default('America/New_York'),
});

export type Family = typeof family.$inferSelect;
export type NewFamily = typeof family.$inferInsert;
