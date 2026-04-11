import { describe, it, expect } from 'vitest';
import {
  RuleConditionSchema,
  RuleActionSchema,
  RuleConditionsArraySchema,
  RuleActionsArraySchema,
} from './schemas.ts';

// ---------------------------------------------------------------------------
// RuleConditionSchema
// ---------------------------------------------------------------------------

describe('RuleConditionSchema', () => {
  describe('valid conditions', () => {
    it.each([
      { field: 'description', operator: 'is', value: 'AMAZON' },
      { field: 'description', operator: 'is_not', value: 'WALMART' },
      { field: 'description', operator: 'contains', value: 'AMZ' },
      { field: 'description', operator: 'does_not_contain', value: 'WAL' },
      { field: 'description', operator: 'matches_regex', value: '^AMZ.*' },
      { field: 'currency', operator: 'one_of', value: ['USD', 'EUR'] },
      { field: 'amount', operator: 'greater_than', value: '100' },
      { field: 'amount', operator: 'greater_than', value: 100 },
      { field: 'amount', operator: 'less_than', value: '50' },
      { field: 'amount', operator: 'between', value: ['0', '100'] },
      { field: 'amount', operator: 'between', value: [0, 100] },
      { field: 'date', operator: 'between', value: ['2026-01-01', '2026-12-31'] },
    ] as const)('accepts %j', (input) => {
      const result = RuleConditionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('invalid conditions', () => {
    it('rejects unknown field', () => {
      const result = RuleConditionSchema.safeParse({
        field: 'unknown',
        operator: 'is',
        value: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects unknown operator', () => {
      const result = RuleConditionSchema.safeParse({
        field: 'description',
        operator: 'fuzzy_match',
        value: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects number value for is operator', () => {
      const result = RuleConditionSchema.safeParse({
        field: 'description',
        operator: 'is',
        value: 42,
      });
      expect(result.success).toBe(false);
    });

    it('rejects string value for one_of operator', () => {
      const result = RuleConditionSchema.safeParse({
        field: 'description',
        operator: 'one_of',
        value: 'single-string',
      });
      expect(result.success).toBe(false);
    });

    it('rejects array value for contains operator', () => {
      const result = RuleConditionSchema.safeParse({
        field: 'description',
        operator: 'contains',
        value: ['a', 'b'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects string value for between operator', () => {
      const result = RuleConditionSchema.safeParse({
        field: 'amount',
        operator: 'between',
        value: '100',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing value', () => {
      const result = RuleConditionSchema.safeParse({
        field: 'description',
        operator: 'is',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing field', () => {
      const result = RuleConditionSchema.safeParse({
        operator: 'is',
        value: 'test',
      });
      expect(result.success).toBe(false);
    });
  });

  it('round-trips with TypeScript RuleCondition interface', () => {
    const condition = {
      field: 'description' as const,
      operator: 'is' as const,
      value: 'AMAZON',
    };
    const parsed = RuleConditionSchema.parse(condition);
    expect(parsed.field).toBe('description');
    expect(parsed.operator).toBe('is');
    expect(parsed.value).toBe('AMAZON');
  });
});

// ---------------------------------------------------------------------------
// RuleActionSchema
// ---------------------------------------------------------------------------

describe('RuleActionSchema', () => {
  describe('valid actions', () => {
    it.each([
      { type: 'set_category', value: 'cat-groceries' },
      { type: 'set_description', value: 'Amazon Purchase' },
      { type: 'set_memo', value: 'monthly sub' },
      { type: 'add_tag', value: 'subscription' },
      { type: 'mark_as_transfer' },
      { type: 'mark_as_transfer', value: undefined },
      { type: 'skip' },
      { type: 'skip', value: undefined },
    ] as const)('accepts %j', (input) => {
      const result = RuleActionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('invalid actions', () => {
    it('rejects unknown type', () => {
      const result = RuleActionSchema.safeParse({
        type: 'delete_entry',
        value: 'yes',
      });
      expect(result.success).toBe(false);
    });

    it('rejects set_category without value', () => {
      const result = RuleActionSchema.safeParse({
        type: 'set_category',
      });
      expect(result.success).toBe(false);
    });

    it('rejects set_description without value', () => {
      const result = RuleActionSchema.safeParse({
        type: 'set_description',
      });
      expect(result.success).toBe(false);
    });

    it('rejects set_memo without value', () => {
      const result = RuleActionSchema.safeParse({
        type: 'set_memo',
      });
      expect(result.success).toBe(false);
    });

    it('rejects add_tag without value', () => {
      const result = RuleActionSchema.safeParse({
        type: 'add_tag',
      });
      expect(result.success).toBe(false);
    });

    it('rejects set_category with empty string value', () => {
      const result = RuleActionSchema.safeParse({
        type: 'set_category',
        value: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing type', () => {
      const result = RuleActionSchema.safeParse({
        value: 'test',
      });
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Array schemas
// ---------------------------------------------------------------------------

describe('RuleConditionsArraySchema', () => {
  it('accepts empty array', () => {
    expect(RuleConditionsArraySchema.safeParse([]).success).toBe(true);
  });

  it('accepts array of valid conditions', () => {
    const result = RuleConditionsArraySchema.safeParse([
      { field: 'description', operator: 'contains', value: 'AMZ' },
      { field: 'amount', operator: 'greater_than', value: '10' },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects array with invalid condition', () => {
    const result = RuleConditionsArraySchema.safeParse([
      { field: 'description', operator: 'contains', value: 'AMZ' },
      { field: 'unknown', operator: 'is', value: 'test' },
    ]);
    expect(result.success).toBe(false);
  });
});

describe('RuleActionsArraySchema', () => {
  it('rejects empty array', () => {
    expect(RuleActionsArraySchema.safeParse([]).success).toBe(false);
  });

  it('accepts array of valid actions', () => {
    const result = RuleActionsArraySchema.safeParse([
      { type: 'set_category', value: 'cat-1' },
      { type: 'add_tag', value: 'important' },
    ]);
    expect(result.success).toBe(true);
  });
});
