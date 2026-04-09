/**
 * `rule` — Actual-Budget-style rules engine row.
 *
 * Each rule has a list of conditions (ANDed) and a list of actions. When a
 * transaction matches the conditions, the actions are applied in order. The
 * `stage` controls when the rule runs relative to others:
 *
 *   `pre`     — runs before the default stage. Used for preprocessing,
 *               e.g. stripping merchant suffixes.
 *   `default` — the main batch. Stable sort by `specificity_score DESC`.
 *   `post`    — runs after the default stage. Used for catch-all rules.
 *
 * `conditions_json` schema (array of condition objects):
 *   { field, operator, value }
 *   fields   : 'description' | 'amount' | 'account' | 'date' | 'currency'
 *   operators: 'is' | 'is_not' | 'contains' | 'does_not_contain' |
 *              'matches_regex' | 'one_of' | 'greater_than' | 'less_than' |
 *              'between'
 *
 * `actions_json` schema (array of action objects):
 *   { type, value }
 *   types : 'set_category' | 'set_description' | 'set_memo' | 'add_tag' |
 *           'mark_as_transfer' | 'skip'
 *
 * Both JSON shapes are validated at the app layer by a Zod schema in
 * `packages/core/rules/`.
 *
 * `specificity_score` is auto-computed on write by the rules engine (more
 * specific conditions → higher score). The runner sorts `default` stage
 * rules by this score so that more-specific rules run first.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { ruleCreatedFromEnum, ruleStageEnum } from './enums.ts';
import { family } from './family.ts';
import { user } from './auth.ts';

/** A single condition in a rule. See the file header for operator semantics. */
export interface RuleCondition {
  field: 'description' | 'amount' | 'account' | 'date' | 'currency';
  operator:
    | 'is'
    | 'is_not'
    | 'contains'
    | 'does_not_contain'
    | 'matches_regex'
    | 'one_of'
    | 'greater_than'
    | 'less_than'
    | 'between';
  value: string | number | string[] | [number, number];
}

/** A single action in a rule. `value` depends on `type`. */
export interface RuleAction {
  type:
    | 'set_category'
    | 'set_description'
    | 'set_memo'
    | 'add_tag'
    | 'mark_as_transfer'
    | 'skip';
  value?: string;
}

export const rule = pgTable(
  'rule',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    stage: ruleStageEnum('stage').notNull().default('default'),
    enabled: boolean('enabled').notNull().default(true),
    /** Auto-computed by the rules engine on write. Higher = more specific. */
    specificityScore: integer('specificity_score').notNull().default(0),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdFrom: ruleCreatedFromEnum('created_from').notNull().default('manual'),
    /** See the file header for the JSON shape. Validated by Zod in
     *  `packages/core/rules/`. */
    conditionsJson: jsonb('conditions_json').$type<RuleCondition[]>().notNull(),
    actionsJson: jsonb('actions_json').$type<RuleAction[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Rule runner query: "get every enabled rule for this family, in stage
    // + specificity order".
    index('rule_family_stage_idx').on(table.familyId, table.stage, table.enabled),
  ],
);

export type Rule = typeof rule.$inferSelect;
export type NewRule = typeof rule.$inferInsert;
