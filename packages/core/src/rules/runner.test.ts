import { describe, it, expect } from 'vitest';
import { runRules } from './runner.ts';
import type { RuleEvaluableEntry, RunnableRule } from './index.ts';

const ENTRY_A: RuleEvaluableEntry = {
  description: 'AMAZON MARKETPLACE',
  amount: '-42.5000',
  accountId: 'acct-checking',
  entryDate: '2026-03-15',
  currency: 'USD',
};

const ENTRY_B: RuleEvaluableEntry = {
  description: 'STARBUCKS COFFEE',
  amount: '-5.7500',
  accountId: 'acct-checking',
  entryDate: '2026-03-15',
  currency: 'USD',
};

function makeRule(overrides: Partial<RunnableRule>): RunnableRule {
  return {
    ruleId: 'rule-1',
    stage: 'default',
    specificityScore: 1,
    conditions: [],
    actions: [],
    ...overrides,
  };
}

describe('runRules', () => {
  it('no rules — returns passthrough results', () => {
    const results = runRules([], [ENTRY_A]);
    expect(results).toHaveLength(1);
    expect(results[0]!.description).toBe('AMAZON MARKETPLACE');
    expect(results[0]!.categoryId).toBeNull();
    expect(results[0]!.skipped).toBe(false);
  });

  it('single rule match — applies actions', () => {
    const rule = makeRule({
      conditions: [{ field: 'description', operator: 'contains', value: 'AMAZON' }],
      actions: [{ type: 'set_category', value: 'cat-shopping' }],
    });
    const results = runRules([rule], [ENTRY_A, ENTRY_B]);
    expect(results[0]!.categoryId).toBe('cat-shopping');
    expect(results[1]!.categoryId).toBeNull(); // no match
  });

  it('multi-rule priority — higher specificity wins within default stage', () => {
    const broadRule = makeRule({
      ruleId: 'broad',
      specificityScore: 1,
      conditions: [{ field: 'description', operator: 'contains', value: 'AMAZON' }],
      actions: [{ type: 'set_category', value: 'cat-general' }],
    });
    const specificRule = makeRule({
      ruleId: 'specific',
      specificityScore: 5,
      conditions: [{ field: 'description', operator: 'is', value: 'AMAZON MARKETPLACE' }],
      actions: [{ type: 'set_category', value: 'cat-marketplace' }],
    });

    // specificRule runs first (higher score), broadRule runs second and overwrites.
    // Both match, so the final result is from broadRule (last writer wins).
    const results = runRules([broadRule, specificRule], [ENTRY_A]);
    expect(results[0]!.categoryId).toBe('cat-general');
  });

  it('stage ordering — pre before default before post', () => {
    const preRule = makeRule({
      ruleId: 'pre',
      stage: 'pre',
      conditions: [],
      actions: [{ type: 'add_tag', value: 'pre-processed' }],
    });
    const defaultRule = makeRule({
      ruleId: 'default',
      stage: 'default',
      conditions: [],
      actions: [{ type: 'add_tag', value: 'default-processed' }],
    });
    const postRule = makeRule({
      ruleId: 'post',
      stage: 'post',
      conditions: [],
      actions: [{ type: 'add_tag', value: 'post-processed' }],
    });

    // Pass in reverse order to prove sorting works
    const results = runRules([postRule, defaultRule, preRule], [ENTRY_A]);
    expect(results[0]!.tags).toEqual([
      'pre-processed',
      'default-processed',
      'post-processed',
    ]);
  });

  it('skip short-circuit — stops processing further rules', () => {
    const skipRule = makeRule({
      ruleId: 'skipper',
      stage: 'pre',
      conditions: [{ field: 'description', operator: 'contains', value: 'AMAZON' }],
      actions: [{ type: 'skip' }],
    });
    const categoryRule = makeRule({
      ruleId: 'categorizer',
      stage: 'default',
      conditions: [],
      actions: [{ type: 'set_category', value: 'cat-should-not-apply' }],
    });

    const results = runRules([skipRule, categoryRule], [ENTRY_A]);
    expect(results[0]!.skipped).toBe(true);
    expect(results[0]!.categoryId).toBeNull();
  });

  it('no-match passthrough — entry passes through unchanged', () => {
    const rule = makeRule({
      conditions: [{ field: 'description', operator: 'is', value: 'NONEXISTENT' }],
      actions: [{ type: 'set_category', value: 'cat-should-not-apply' }],
    });
    const results = runRules([rule], [ENTRY_A]);
    expect(results[0]!.categoryId).toBeNull();
    expect(results[0]!.description).toBe('AMAZON MARKETPLACE');
  });

  it('batch processing — one result per entry in same order', () => {
    const rule = makeRule({
      conditions: [{ field: 'description', operator: 'contains', value: 'STARBUCKS' }],
      actions: [{ type: 'set_category', value: 'cat-coffee' }],
    });

    const results = runRules([rule], [ENTRY_A, ENTRY_B]);
    expect(results).toHaveLength(2);
    expect(results[0]!.description).toBe('AMAZON MARKETPLACE');
    expect(results[0]!.categoryId).toBeNull();
    expect(results[1]!.description).toBe('STARBUCKS COFFEE');
    expect(results[1]!.categoryId).toBe('cat-coffee');
  });

  it('conditions evaluate against accumulated result (not original entry)', () => {
    // pre rule changes description, default rule conditions match against the changed description
    const preRule = makeRule({
      ruleId: 'rename',
      stage: 'pre',
      conditions: [],
      actions: [{ type: 'set_description', value: 'WALMART' }],
    });
    const defaultRule = makeRule({
      ruleId: 'match-walmart',
      stage: 'default',
      conditions: [{ field: 'description', operator: 'is', value: 'WALMART' }],
      actions: [{ type: 'set_category', value: 'cat-walmart' }],
    });

    const results = runRules([preRule, defaultRule], [ENTRY_A]);
    expect(results[0]!.description).toBe('WALMART');
    expect(results[0]!.categoryId).toBe('cat-walmart');
  });
});
