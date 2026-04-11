/**
 * `@budget-tracker/core/rules` — Actual-Budget-style rules engine.
 *
 * Module structure:
 *   - evaluator : given conditions + an entry, return match?
 *   - actions   : apply action list to an entry accumulator
 *   - runner    : apply a rule list to a batch of entries in pre → default
 *                 → post stages
 *   - schemas   : Zod schemas for RuleCondition / RuleAction JSONB shapes
 *
 * See `docs/plan.md#phase-2-budgeting--rules` for the full behavior spec.
 */

import type { RuleCondition, RuleAction } from './types.ts';

// Re-export the shared condition/action types so consumers don't need to
// know about the internal file split.
export type { RuleCondition, RuleAction };

/** A simplified entry representation used by the rules evaluator. */
export interface RuleEvaluableEntry {
  description: string;
  amount: string;
  accountId: string | null;
  entryDate: string;
  currency: string;
}

/** The output of applying rules to an entry — immutable input + mutable result fields. */
export interface RuleResult extends RuleEvaluableEntry {
  categoryId: string | null;
  memo: string | null;
  tags: string[];
  isTransfer: boolean;
  skipped: boolean;
}

/** A rule as consumed by the batch runner. */
export interface RunnableRule {
  ruleId: string;
  stage: 'pre' | 'default' | 'post';
  specificityScore: number;
  conditions: readonly RuleCondition[];
  actions: readonly RuleAction[];
}

export { evaluateConditions, computeSpecificityScore } from './evaluator.ts';
export { applyActions } from './actions.ts';
export { runRules } from './runner.ts';
export {
  RuleConditionSchema,
  RuleActionSchema,
  RuleConditionsArraySchema,
  RuleActionsArraySchema,
} from './schemas.ts';
