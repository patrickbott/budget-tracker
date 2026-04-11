/**
 * Rules action applier — transforms an entry accumulator based on rule actions.
 */

import type { RuleAction } from './types.ts';
import type { RuleEvaluableEntry, RuleResult } from './index.ts';

/**
 * Creates a fresh `RuleResult` from a `RuleEvaluableEntry`, initializing
 * all mutable output fields to their defaults.
 */
export function initResult(entry: RuleEvaluableEntry): RuleResult {
  return {
    ...entry,
    categoryId: null,
    memo: null,
    tags: [],
    isTransfer: false,
    skipped: false,
  };
}

/**
 * Apply an ordered list of actions to a `RuleResult` accumulator.
 * Returns a new object — the input is not mutated.
 *
 * If a `skip` action is encountered, the `skipped` flag is set and no
 * further actions in this list are applied. The caller (runner) should
 * also stop processing subsequent rules for this entry.
 */
export function applyActions(
  actions: readonly RuleAction[],
  result: RuleResult,
): RuleResult {
  let acc = { ...result, tags: [...result.tags] };

  for (const action of actions) {
    switch (action.type) {
      case 'set_category':
        acc.categoryId = action.value ?? null;
        break;

      case 'set_description':
        acc.description = action.value ?? acc.description;
        break;

      case 'set_memo':
        acc.memo = action.value ?? null;
        break;

      case 'add_tag':
        if (action.value && !acc.tags.includes(action.value)) {
          acc.tags.push(action.value);
        }
        break;

      case 'mark_as_transfer':
        acc.isTransfer = true;
        break;

      case 'skip':
        acc.skipped = true;
        return acc; // stop processing further actions
    }
  }

  return acc;
}
