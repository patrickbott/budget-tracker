/**
 * Rule condition and action shapes, extracted from `./index.ts` so they
 * can be imported without dragging the throwing stub functions with them.
 *
 * These mirror the JSONB shapes stored in `packages/db/schema/rule.ts`.
 * When you change one, change the other; there is no source-of-truth
 * enforcement today (phase 2 will add a Zod schema that both import).
 */

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
