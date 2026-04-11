/**
 * Rules batch runner — applies a sorted rule list to a batch of entries.
 *
 * Rules are sorted by stage (pre → default → post), then within the
 * `default` stage by specificityScore DESC (most specific first). `pre`
 * and `post` stages are stable-sorted in their original order.
 */

import type { RuleEvaluableEntry, RuleResult, RunnableRule } from './index.ts';
import { evaluateConditions } from './evaluator.ts';
import { applyActions, initResult } from './actions.ts';

const STAGE_ORDER: Record<RunnableRule['stage'], number> = {
  pre: 0,
  default: 1,
  post: 2,
};

/**
 * Sort rules by stage order, then within `default` by specificityScore
 * descending. Within `pre` and `post`, preserve the original order.
 */
function sortRules(rules: readonly RunnableRule[]): RunnableRule[] {
  // Assign original indices for stable sorting
  const indexed = rules.map((r, i) => ({ rule: r, idx: i }));

  indexed.sort((a, b) => {
    const stageA = STAGE_ORDER[a.rule.stage];
    const stageB = STAGE_ORDER[b.rule.stage];

    if (stageA !== stageB) return stageA - stageB;

    // Within the default stage, sort by specificityScore DESC
    if (a.rule.stage === 'default' && b.rule.stage === 'default') {
      if (a.rule.specificityScore !== b.rule.specificityScore) {
        return b.rule.specificityScore - a.rule.specificityScore;
      }
    }

    // Preserve original order for ties (stable sort)
    return a.idx - b.idx;
  });

  return indexed.map((i) => i.rule);
}

/**
 * Run all rules against a batch of entries.
 *
 * For each entry:
 *   1. Initialize a `RuleResult` from the entry
 *   2. Iterate through sorted rules
 *   3. If conditions match, apply actions
 *   4. If `skip` action fires, stop processing further rules for this entry
 *
 * Returns one `RuleResult` per entry, in the same order as the input.
 */
export function runRules(
  rules: readonly RunnableRule[],
  entries: readonly RuleEvaluableEntry[],
): RuleResult[] {
  const sorted = sortRules(rules);

  return entries.map((entry) => {
    let result = initResult(entry);

    for (const rule of sorted) {
      if (result.skipped) break;

      if (evaluateConditions(rule.conditions, result)) {
        result = applyActions(rule.actions, result);
      }
    }

    return result;
  });
}
