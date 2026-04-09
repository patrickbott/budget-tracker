/**
 * Schema barrel — import from `@budget-tracker/db/schema`.
 *
 * Every table, enum, and its inferred Select/Insert types is re-exported
 * here so that:
 *
 *   import { account, entry, entryLine } from '@budget-tracker/db/schema';
 *
 * works without reaching into internal file paths. Instance B wires this
 * module into Better Auth's `drizzleAdapter` and uses it for all application
 * queries.
 *
 * Adding a new table:
 *   1. Write `./<name>.ts` with the `pgTable` declaration
 *   2. Add a line here
 *   3. Run `pnpm --filter @budget-tracker/db run db:generate` to produce
 *      a migration file. Hand-edit if you need constraints Drizzle can't
 *      express (see 0001_rls_policies.sql, 0002_entry_line_balance.sql).
 */

// Enums first — they're used by every other file.
export * from './enums.ts';

// Better Auth core tables (renamed where they collide with domain tables).
export * from './auth.ts';

// Tenant root + membership (Better Auth plugin tables, remapped via modelName).
export * from './family.ts';
export * from './membership.ts';

// Connections + SimpleFIN audit log.
export * from './connection.ts';
export * from './sync-run.ts';

// Polymorphic financial account + subtype detail tables.
export * from './account.ts';
export * from './account-depository.ts';
export * from './account-credit-card.ts';
export * from './account-loan.ts';
export * from './account-investment.ts';
export * from './account-property.ts';

// Categories / rules / budgets / recurring / goals.
export * from './category.ts';
export * from './entry.ts';
export * from './entry-line.ts';
export * from './rule.ts';
export * from './budget.ts';
export * from './recurring.ts';
export * from './goal.ts';

// AI features.
export * from './insight.ts';
export * from './ai-usage.ts';
export * from './chat.ts';
