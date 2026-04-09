/**
 * Postgres enums for the Budget Tracker domain.
 *
 * Every enumerated field in `docs/data-model.md` becomes a `pgEnum` here so
 * that:
 *   1. Drizzle generates real `CREATE TYPE ... AS ENUM (...)` in migrations
 *   2. Invalid values are rejected by the database, not just the app layer
 *   3. IDE autocomplete works on every domain enum
 *
 * Changing an enum after rollout requires a migration (Postgres does not allow
 * `DROP VALUE`); adding a new value is supported via `ALTER TYPE ... ADD VALUE`.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

// --- Account ----------------------------------------------------------------

/** Polymorphic discriminator for `account`. Sub-type detail lives in the
 *  matching `<type>_account` sub-table (e.g. `depository_account`). */
export const accountTypeEnum = pgEnum('account_type', [
  'depository',
  'credit_card',
  'investment',
  'loan',
  'property',
  'crypto',
  'other_asset',
  'other_liability',
]);

/** `household` accounts are visible to every family member; `personal`
 *  accounts are visible only to `owner_user_id` (enforced by both an app-layer
 *  filter and the `personal_owner_isolation` RLS policy). */
export const accountVisibilityEnum = pgEnum('account_visibility', [
  'household',
  'personal',
]);

/** Depository sub-type — informational, shown in the UI for filtering. */
export const depositorySubtypeEnum = pgEnum('depository_subtype', [
  'checking',
  'savings',
  'money_market',
  'cd',
]);

/** Investment sub-type — mirrors the tax-wrapper, used by Phase 5 reporting. */
export const investmentSubtypeEnum = pgEnum('investment_subtype', [
  'brokerage',
  'ira',
  'roth',
  '401k',
  '403b',
  'hsa',
  'other',
]);

// --- Entry ------------------------------------------------------------------

/** How the entry got into the database. Drives UI badges and reindexing. */
export const entrySourceEnum = pgEnum('entry_source', [
  'simplefin',
  'manual',
  'import',
  'rule',
]);

/** Polymorphic discriminator for `entry`. See `docs/data-model.md#entry`. */
export const entryableTypeEnum = pgEnum('entryable_type', [
  'transaction',
  'transfer',
  'valuation',
  'trade',
]);

// --- Category ---------------------------------------------------------------

/** Top-level kind for a category. `transfer` and `equity` are reserved for
 *  internal movements and should never appear on user-facing expense totals. */
export const categoryKindEnum = pgEnum('category_kind', [
  'income',
  'expense',
  'transfer',
  'equity',
]);

// --- Rule -------------------------------------------------------------------

/** `pre` runs before the default rule set, `post` after. See
 *  Actual-Budget-style rules engine docs. */
export const ruleStageEnum = pgEnum('rule_stage', ['pre', 'default', 'post']);

/** Whether the user created this rule by hand, or the AI induced it from a
 *  manual correction. `induced` rules land in the review inbox first. */
export const ruleCreatedFromEnum = pgEnum('rule_created_from', [
  'manual',
  'induced',
]);

// --- Budget -----------------------------------------------------------------

/** How the budget amount is interpreted. `hard_cap` = do not exceed,
 *  `forecast` = expected baseline, warn on drift. */
export const budgetModeEnum = pgEnum('budget_mode', ['hard_cap', 'forecast']);

/** Period granularity for a budget window. */
export const budgetPeriodEnum = pgEnum('budget_period', [
  'weekly',
  'monthly',
  'yearly',
]);

/** Unspent rollover behavior at period end. */
export const budgetRolloverEnum = pgEnum('budget_rollover', [
  'none',
  'rollover_positive',
  'rollover_all',
]);

// --- Recurring --------------------------------------------------------------

/** Lunch-Money-style cadence. Combined with `cadence_interval` (integer) to
 *  support patterns like "every 2 months". */
export const recurringCadenceEnum = pgEnum('recurring_cadence', [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'semiannual',
  'yearly',
]);

// --- Goal -------------------------------------------------------------------

export const goalTypeEnum = pgEnum('goal_type', [
  'savings',
  'debt_payoff',
  'net_worth_target',
]);

export const goalStatusEnum = pgEnum('goal_status', [
  'active',
  'achieved',
  'abandoned',
]);

// --- Membership / auth ------------------------------------------------------

/** Role on the `membership` row. Matches Better Auth's organization plugin
 *  string roles — do not reorder, do not rename without a BA schema migration. */
export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'member']);

// --- Connection / sync ------------------------------------------------------

export const connectionStatusEnum = pgEnum('connection_status', [
  'active',
  'needs_reauth',
  'disabled',
]);

export const syncRunStatusEnum = pgEnum('sync_run_status', [
  'pending',
  'running',
  'success',
  'failed',
]);

// --- AI features ------------------------------------------------------------

export const insightPeriodEnum = pgEnum('insight_period', ['weekly', 'monthly']);

/** Role on a single chat message — matches Anthropic's message role convention
 *  plus a `tool` pseudo-role for tool_use / tool_result display. */
export const chatRoleEnum = pgEnum('chat_role', ['user', 'assistant', 'tool']);
