/**
 * `membership` — user ↔ family join table with a role.
 *
 * This table IS Better Auth's `member` table, remapped via:
 *
 *   organization({ schema: { member: { modelName: 'membership' } } })
 *
 * Column shape matches BA's documented `member` table exactly. BA generates
 * queries against the `organizationId` field, which we keep as
 * `organization_id` in SQL and which points at `family.id` — the BA
 * organization plugin doesn't care that we renamed the target table, only
 * that the FK column name remains `organization_id`.
 *
 * `role` is a free-form string in BA; we pin it to the `membership_role`
 * enum in `enums.ts` so the database rejects typos. If you want to add a new
 * role, update the enum AND the BA plugin's role list together.
 *
 * RLS: `membership` IS row-level-secured by `organization_id` (the policy is
 * keyed on `current_setting('app.current_family_id')::text`). See
 * migrations/0001_rls_policies.sql.
 */
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { membershipRoleEnum } from './enums.ts';
import { family } from './family.ts';
import { user } from './auth.ts';

export const membership = pgTable(
  'membership',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Column name stays `organization_id` to match Better Auth's generated
    // queries. The FK target is `family.id` because we remap the table via
    // modelName, not the column.
    organizationId: text('organization_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A user can be in a family at most once.
    uniqueIndex('membership_user_family_idx').on(table.userId, table.organizationId),
  ],
);

export type Membership = typeof membership.$inferSelect;
export type NewMembership = typeof membership.$inferInsert;
