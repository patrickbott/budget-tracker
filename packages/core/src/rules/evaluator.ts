/**
 * Rules evaluator — condition matching and specificity scoring.
 *
 * Given a list of `RuleCondition`s and a `RuleEvaluableEntry`, determines
 * whether all conditions match (AND semantics). Also provides a heuristic
 * specificity score used to rank rules within a stage.
 */

import Decimal from 'decimal.js';
import type { RuleCondition } from './types.ts';
import type { RuleEvaluableEntry } from './index.ts';

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

function getFieldValue(
  entry: RuleEvaluableEntry,
  field: RuleCondition['field'],
): string {
  switch (field) {
    case 'description':
      return entry.description;
    case 'amount':
      return entry.amount;
    case 'account':
      return entry.accountId ?? '';
    case 'date':
      return entry.entryDate;
    case 'currency':
      return entry.currency;
  }
}

/** Fields where string comparisons should be case-insensitive. */
function isCaseInsensitiveField(field: RuleCondition['field']): boolean {
  return field === 'description';
}

// ---------------------------------------------------------------------------
// Individual condition evaluation
// ---------------------------------------------------------------------------

function evaluateCondition(
  condition: RuleCondition,
  entry: RuleEvaluableEntry,
): boolean {
  const raw = getFieldValue(entry, condition.field);
  const ci = isCaseInsensitiveField(condition.field);

  switch (condition.operator) {
    case 'is': {
      const target = String(condition.value);
      return ci
        ? raw.toLowerCase() === target.toLowerCase()
        : raw === target;
    }

    case 'is_not': {
      const target = String(condition.value);
      return ci
        ? raw.toLowerCase() !== target.toLowerCase()
        : raw !== target;
    }

    case 'contains': {
      const target = String(condition.value);
      return ci
        ? raw.toLowerCase().includes(target.toLowerCase())
        : raw.includes(target);
    }

    case 'does_not_contain': {
      const target = String(condition.value);
      return ci
        ? !raw.toLowerCase().includes(target.toLowerCase())
        : !raw.includes(target);
    }

    case 'matches_regex': {
      const pattern = new RegExp(String(condition.value), ci ? 'i' : undefined);
      return pattern.test(raw);
    }

    case 'one_of': {
      const values = condition.value as string[];
      return ci
        ? values.some((v) => v.toLowerCase() === raw.toLowerCase())
        : values.includes(raw);
    }

    case 'greater_than': {
      const a = new Decimal(raw);
      const b = new Decimal(String(condition.value));
      return a.greaterThan(b);
    }

    case 'less_than': {
      const a = new Decimal(raw);
      const b = new Decimal(String(condition.value));
      return a.lessThan(b);
    }

    case 'between': {
      const [lo, hi] = condition.value as [number | string, number | string];

      if (condition.field === 'date') {
        // Lexicographic comparison works for ISO date strings (YYYY-MM-DD)
        return raw >= String(lo) && raw <= String(hi);
      }

      const a = new Decimal(raw);
      return a.greaterThanOrEqualTo(new Decimal(String(lo))) &&
        a.lessThanOrEqualTo(new Decimal(String(hi)));
    }

    default: {
      const _exhaustive: never = condition.operator;
      throw new Error(`Unknown operator: ${_exhaustive}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns `true` iff every condition in the list matches the entry.
 * Conditions are ANDed together; an empty list matches everything.
 */
export function evaluateConditions(
  conditions: readonly RuleCondition[],
  entry: RuleEvaluableEntry,
): boolean {
  return conditions.every((c) => evaluateCondition(c, entry));
}

/**
 * Compute a heuristic specificity score for a list of conditions.
 *
 * Scoring:
 *   is          = 3 pts
 *   matches_regex = 2 pts
 *   between     = 2 pts
 *   contains    = 1 pt
 *   is_not      = 1 pt
 *   does_not_contain = 1 pt
 *   one_of      = 2 pts
 *   greater_than = 1 pt
 *   less_than   = 1 pt
 *
 * The total is the sum across all conditions.
 */
export function computeSpecificityScore(
  conditions: readonly RuleCondition[],
): number {
  const weights: Record<RuleCondition['operator'], number> = {
    is: 3,
    is_not: 1,
    contains: 1,
    does_not_contain: 1,
    matches_regex: 2,
    one_of: 2,
    greater_than: 1,
    less_than: 1,
    between: 2,
  };

  return conditions.reduce((sum, c) => sum + (weights[c.operator] ?? 0), 0);
}
