/**
 * `@budget-tracker/core/rules` — Actual-Budget-style rules engine.
 *
 * PHASE 2 — not implemented yet. Every export here throws at runtime so
 * accidental callers get a loud failure during scaffolding. The signatures
 * are pinned now so consumers can write type-safe bindings against them
 * before the bodies exist.
 *
 * Module structure (planned):
 *   - evaluator : given conditions + an entry, return match?
 *   - ranker    : stable-sort a list of rules by specificity score
 *   - inducer   : propose a rule from a single user-corrected example
 *   - runner    : apply a rule list to a batch of entries in pre → default
 *                 → post stages
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

/**
 * Returns `true` iff every condition in the list matches the entry.
 * Conditions are ANDed together; an empty list matches everything.
 */
export function evaluateConditions(
  _conditions: readonly RuleCondition[],
  _entry: RuleEvaluableEntry,
): boolean {
  throw new Error('not implemented — phase 2+');
}

/**
 * Compute a heuristic specificity score for a list of conditions. More
 * specific rules (e.g. description-is + amount-between) score higher.
 */
export function computeSpecificityScore(
  _conditions: readonly RuleCondition[],
): number {
  throw new Error('not implemented — phase 2+');
}

/**
 * Apply an ordered list of actions to an entry-shaped accumulator, in
 * place. Returns a new object; the caller decides whether to persist.
 */
export function applyActions(
  _actions: readonly RuleAction[],
  _entry: RuleEvaluableEntry,
): RuleEvaluableEntry {
  throw new Error('not implemented — phase 2+');
}
