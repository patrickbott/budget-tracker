import { describe, it, expect } from 'vitest';
import { evaluateConditions, computeSpecificityScore } from './evaluator.ts';
import type { RuleEvaluableEntry } from './index.ts';
import type { RuleCondition } from './types.ts';

const BASE_ENTRY: RuleEvaluableEntry = {
  description: 'AMAZON MARKETPLACE',
  amount: '-42.5000',
  accountId: 'acct-checking-001',
  entryDate: '2026-03-15',
  currency: 'USD',
};

// ---------------------------------------------------------------------------
// evaluateConditions
// ---------------------------------------------------------------------------

describe('evaluateConditions', () => {
  it('empty conditions list matches everything', () => {
    expect(evaluateConditions([], BASE_ENTRY)).toBe(true);
  });

  // --- is / is_not ---

  it('is — exact match (case-insensitive for description)', () => {
    const cond: RuleCondition = { field: 'description', operator: 'is', value: 'amazon marketplace' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(true);
  });

  it('is — case-sensitive for non-description fields', () => {
    const cond: RuleCondition = { field: 'currency', operator: 'is', value: 'usd' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(false);

    const cond2: RuleCondition = { field: 'currency', operator: 'is', value: 'USD' };
    expect(evaluateConditions([cond2], BASE_ENTRY)).toBe(true);
  });

  it('is — no match', () => {
    const cond: RuleCondition = { field: 'description', operator: 'is', value: 'WALMART' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(false);
  });

  it('is_not — match when values differ', () => {
    const cond: RuleCondition = { field: 'description', operator: 'is_not', value: 'WALMART' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(true);
  });

  it('is_not — no match when values equal', () => {
    const cond: RuleCondition = { field: 'description', operator: 'is_not', value: 'amazon marketplace' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(false);
  });

  // --- contains / does_not_contain ---

  it('contains — substring match (case-insensitive for description)', () => {
    const cond: RuleCondition = { field: 'description', operator: 'contains', value: 'amazon' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(true);
  });

  it('contains — no match', () => {
    const cond: RuleCondition = { field: 'description', operator: 'contains', value: 'walmart' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(false);
  });

  it('does_not_contain — match when substring absent', () => {
    const cond: RuleCondition = { field: 'description', operator: 'does_not_contain', value: 'walmart' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(true);
  });

  it('does_not_contain — no match when substring present', () => {
    const cond: RuleCondition = { field: 'description', operator: 'does_not_contain', value: 'AMAZON' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(false);
  });

  // --- matches_regex ---

  it('matches_regex — matches', () => {
    const cond: RuleCondition = { field: 'description', operator: 'matches_regex', value: 'AMAZON.*MARKET' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(true);
  });

  it('matches_regex — case-insensitive for description', () => {
    const cond: RuleCondition = { field: 'description', operator: 'matches_regex', value: 'amazon.*market' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(true);
  });

  it('matches_regex — no match', () => {
    const cond: RuleCondition = { field: 'description', operator: 'matches_regex', value: '^WALMART' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(false);
  });

  // --- one_of ---

  it('one_of — value in list', () => {
    const cond: RuleCondition = { field: 'currency', operator: 'one_of', value: ['USD', 'EUR', 'GBP'] };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(true);
  });

  it('one_of — value not in list', () => {
    const cond: RuleCondition = { field: 'currency', operator: 'one_of', value: ['EUR', 'GBP'] };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(false);
  });

  it('one_of — case-insensitive for description', () => {
    const cond: RuleCondition = {
      field: 'description',
      operator: 'one_of',
      value: ['amazon marketplace', 'walmart'],
    };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(true);
  });

  // --- greater_than / less_than ---

  it('greater_than — amount above threshold', () => {
    // Amount is -42.5000, which is NOT greater than 0
    const cond: RuleCondition = { field: 'amount', operator: 'greater_than', value: '0' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(false);
  });

  it('greater_than — positive amount above threshold', () => {
    const entry = { ...BASE_ENTRY, amount: '150.0000' };
    const cond: RuleCondition = { field: 'amount', operator: 'greater_than', value: '100' };
    expect(evaluateConditions([cond], entry)).toBe(true);
  });

  it('less_than — amount below threshold', () => {
    const cond: RuleCondition = { field: 'amount', operator: 'less_than', value: '0' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(true);
  });

  it('less_than — exact boundary not matched', () => {
    const cond: RuleCondition = { field: 'amount', operator: 'less_than', value: '-42.5000' };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(false);
  });

  // --- between ---

  it('between — amount in range (inclusive)', () => {
    const cond: RuleCondition = { field: 'amount', operator: 'between', value: ['-100', '0'] };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(true);
  });

  it('between — amount at boundary (inclusive)', () => {
    const cond: RuleCondition = { field: 'amount', operator: 'between', value: ['-42.5000', '-42.5000'] };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(true);
  });

  it('between — amount out of range', () => {
    const cond: RuleCondition = { field: 'amount', operator: 'between', value: ['0', '100'] };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(false);
  });

  it('between — date in range', () => {
    const cond: RuleCondition = { field: 'date', operator: 'between', value: ['2026-03-01', '2026-03-31'] };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(true);
  });

  it('between — date out of range', () => {
    const cond: RuleCondition = { field: 'date', operator: 'between', value: ['2026-04-01', '2026-04-30'] };
    expect(evaluateConditions([cond], BASE_ENTRY)).toBe(false);
  });

  // --- AND semantics ---

  it('multiple conditions — all must match (AND)', () => {
    const conditions: RuleCondition[] = [
      { field: 'description', operator: 'contains', value: 'AMAZON' },
      { field: 'amount', operator: 'less_than', value: '0' },
      { field: 'currency', operator: 'is', value: 'USD' },
    ];
    expect(evaluateConditions(conditions, BASE_ENTRY)).toBe(true);
  });

  it('multiple conditions — one fails means no match', () => {
    const conditions: RuleCondition[] = [
      { field: 'description', operator: 'contains', value: 'AMAZON' },
      { field: 'amount', operator: 'greater_than', value: '0' }, // fails
    ];
    expect(evaluateConditions(conditions, BASE_ENTRY)).toBe(false);
  });

  // --- null accountId ---

  it('account field with null accountId returns empty string', () => {
    const entry = { ...BASE_ENTRY, accountId: null };
    const cond: RuleCondition = { field: 'account', operator: 'is', value: '' };
    expect(evaluateConditions([cond], entry)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeSpecificityScore
// ---------------------------------------------------------------------------

describe('computeSpecificityScore', () => {
  it('empty conditions → 0', () => {
    expect(computeSpecificityScore([])).toBe(0);
  });

  it('single `is` condition → 3', () => {
    const conditions: RuleCondition[] = [
      { field: 'description', operator: 'is', value: 'AMAZON' },
    ];
    expect(computeSpecificityScore(conditions)).toBe(3);
  });

  it('single `contains` condition → 1', () => {
    const conditions: RuleCondition[] = [
      { field: 'description', operator: 'contains', value: 'AMAZON' },
    ];
    expect(computeSpecificityScore(conditions)).toBe(1);
  });

  it('is + between → 5', () => {
    const conditions: RuleCondition[] = [
      { field: 'description', operator: 'is', value: 'AMAZON' },
      { field: 'amount', operator: 'between', value: [0, 100] },
    ];
    expect(computeSpecificityScore(conditions)).toBe(5);
  });

  it('contains + greater_than + less_than → 3', () => {
    const conditions: RuleCondition[] = [
      { field: 'description', operator: 'contains', value: 'A' },
      { field: 'amount', operator: 'greater_than', value: '0' },
      { field: 'amount', operator: 'less_than', value: '100' },
    ];
    expect(computeSpecificityScore(conditions)).toBe(3);
  });

  it('matches_regex → 2', () => {
    const conditions: RuleCondition[] = [
      { field: 'description', operator: 'matches_regex', value: '^AM' },
    ];
    expect(computeSpecificityScore(conditions)).toBe(2);
  });

  it('one_of → 2', () => {
    const conditions: RuleCondition[] = [
      { field: 'currency', operator: 'one_of', value: ['USD', 'EUR'] },
    ];
    expect(computeSpecificityScore(conditions)).toBe(2);
  });

  it('is_not → 1', () => {
    const conditions: RuleCondition[] = [
      { field: 'description', operator: 'is_not', value: 'WALMART' },
    ];
    expect(computeSpecificityScore(conditions)).toBe(1);
  });

  it('does_not_contain → 1', () => {
    const conditions: RuleCondition[] = [
      { field: 'description', operator: 'does_not_contain', value: 'WALMART' },
    ];
    expect(computeSpecificityScore(conditions)).toBe(1);
  });

  it('deterministic across calls', () => {
    const conditions: RuleCondition[] = [
      { field: 'description', operator: 'is', value: 'A' },
      { field: 'amount', operator: 'between', value: [0, 100] },
    ];
    const a = computeSpecificityScore(conditions);
    const b = computeSpecificityScore(conditions);
    expect(a).toBe(b);
  });
});
