/**
 * Zod schemas for rule conditions and actions — the canonical validation
 * for the JSONB shapes stored in the `rule` table.
 *
 * Both the DB seed script and the UI rule editor should validate through
 * these schemas.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Condition schema
// ---------------------------------------------------------------------------

const ConditionFieldSchema = z.enum([
  'description',
  'amount',
  'account',
  'date',
  'currency',
]);

const ConditionOperatorSchema = z.enum([
  'is',
  'is_not',
  'contains',
  'does_not_contain',
  'matches_regex',
  'one_of',
  'greater_than',
  'less_than',
  'between',
]);

/**
 * A single rule condition. The `value` type depends on the `operator`:
 *   - `is`, `is_not`, `contains`, `does_not_contain`, `matches_regex`:
 *     string
 *   - `one_of`: string[]
 *   - `greater_than`, `less_than`: string (decimal) or number
 *   - `between`: tuple of [string | number, string | number]
 */
export const RuleConditionSchema = z
  .object({
    field: ConditionFieldSchema,
    operator: ConditionOperatorSchema,
    value: z.union([
      z.string(),
      z.number(),
      z.array(z.string()),
      z.tuple([z.union([z.string(), z.number()]), z.union([z.string(), z.number()])]),
    ]),
  })
  .refine(
    (c) => {
      // Validate value shape matches operator
      switch (c.operator) {
        case 'is':
        case 'is_not':
        case 'contains':
        case 'does_not_contain':
        case 'matches_regex':
          return typeof c.value === 'string';
        case 'one_of':
          return Array.isArray(c.value) && c.value.every((v) => typeof v === 'string');
        case 'greater_than':
        case 'less_than':
          return typeof c.value === 'string' || typeof c.value === 'number';
        case 'between':
          return (
            Array.isArray(c.value) &&
            c.value.length === 2 &&
            (typeof c.value[0] === 'string' || typeof c.value[0] === 'number') &&
            (typeof c.value[1] === 'string' || typeof c.value[1] === 'number')
          );
        default:
          return false;
      }
    },
    { message: 'Condition value does not match operator type' },
  );

export type ValidatedRuleCondition = z.infer<typeof RuleConditionSchema>;

// ---------------------------------------------------------------------------
// Action schema
// ---------------------------------------------------------------------------

const ActionTypeSchema = z.enum([
  'set_category',
  'set_description',
  'set_memo',
  'add_tag',
  'mark_as_transfer',
  'skip',
]);

/**
 * A single rule action. `value` is required for most action types, but
 * optional for `mark_as_transfer` and `skip` (which are boolean flags).
 */
export const RuleActionSchema = z
  .object({
    type: ActionTypeSchema,
    value: z.string().optional(),
  })
  .refine(
    (a) => {
      // Actions that require a value
      switch (a.type) {
        case 'set_category':
        case 'set_description':
        case 'set_memo':
        case 'add_tag':
          return typeof a.value === 'string' && a.value.length > 0;
        case 'mark_as_transfer':
        case 'skip':
          return true; // value is optional / ignored
        default:
          return false;
      }
    },
    { message: 'Action value is required for this action type' },
  );

export type ValidatedRuleAction = z.infer<typeof RuleActionSchema>;

// ---------------------------------------------------------------------------
// Array schemas (for validating the full JSONB column contents)
// ---------------------------------------------------------------------------

export const RuleConditionsArraySchema = z.array(RuleConditionSchema);
export const RuleActionsArraySchema = z.array(RuleActionSchema).min(1);
