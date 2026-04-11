import { describe, it, expect } from 'vitest';
import { applyActions, initResult } from './actions.ts';
import type { RuleEvaluableEntry, RuleResult } from './index.ts';
import type { RuleAction } from './types.ts';

const BASE_ENTRY: RuleEvaluableEntry = {
  description: 'AMAZON MARKETPLACE',
  amount: '-42.5000',
  accountId: 'acct-checking-001',
  entryDate: '2026-03-15',
  currency: 'USD',
};

function makeResult(overrides: Partial<RuleResult> = {}): RuleResult {
  return { ...initResult(BASE_ENTRY), ...overrides };
}

// ---------------------------------------------------------------------------
// initResult
// ---------------------------------------------------------------------------

describe('initResult', () => {
  it('creates a RuleResult with default mutable fields', () => {
    const result = initResult(BASE_ENTRY);
    expect(result.description).toBe('AMAZON MARKETPLACE');
    expect(result.amount).toBe('-42.5000');
    expect(result.categoryId).toBeNull();
    expect(result.memo).toBeNull();
    expect(result.tags).toEqual([]);
    expect(result.isTransfer).toBe(false);
    expect(result.skipped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

describe('applyActions', () => {
  it('set_category — sets categoryId', () => {
    const actions: RuleAction[] = [{ type: 'set_category', value: 'cat-groceries' }];
    const result = applyActions(actions, makeResult());
    expect(result.categoryId).toBe('cat-groceries');
  });

  it('set_description — overwrites description', () => {
    const actions: RuleAction[] = [{ type: 'set_description', value: 'Amazon Purchase' }];
    const result = applyActions(actions, makeResult());
    expect(result.description).toBe('Amazon Purchase');
  });

  it('set_memo — sets memo', () => {
    const actions: RuleAction[] = [{ type: 'set_memo', value: 'monthly subscribe' }];
    const result = applyActions(actions, makeResult());
    expect(result.memo).toBe('monthly subscribe');
  });

  it('add_tag — appends to tags array', () => {
    const actions: RuleAction[] = [{ type: 'add_tag', value: 'subscription' }];
    const result = applyActions(actions, makeResult());
    expect(result.tags).toEqual(['subscription']);
  });

  it('add_tag — does not add duplicates', () => {
    const actions: RuleAction[] = [
      { type: 'add_tag', value: 'sub' },
      { type: 'add_tag', value: 'sub' },
    ];
    const result = applyActions(actions, makeResult());
    expect(result.tags).toEqual(['sub']);
  });

  it('add_tag — accumulates distinct tags', () => {
    const actions: RuleAction[] = [
      { type: 'add_tag', value: 'sub' },
      { type: 'add_tag', value: 'monthly' },
    ];
    const result = applyActions(actions, makeResult());
    expect(result.tags).toEqual(['sub', 'monthly']);
  });

  it('mark_as_transfer — sets isTransfer flag', () => {
    const actions: RuleAction[] = [{ type: 'mark_as_transfer' }];
    const result = applyActions(actions, makeResult());
    expect(result.isTransfer).toBe(true);
  });

  it('skip — sets skipped flag and stops further actions', () => {
    const actions: RuleAction[] = [
      { type: 'skip' },
      { type: 'set_category', value: 'should-not-apply' },
    ];
    const result = applyActions(actions, makeResult());
    expect(result.skipped).toBe(true);
    expect(result.categoryId).toBeNull(); // second action never ran
  });

  it('multiple actions applied in order', () => {
    const actions: RuleAction[] = [
      { type: 'set_category', value: 'cat-shopping' },
      { type: 'set_description', value: 'Amazon' },
      { type: 'add_tag', value: 'online' },
    ];
    const result = applyActions(actions, makeResult());
    expect(result.categoryId).toBe('cat-shopping');
    expect(result.description).toBe('Amazon');
    expect(result.tags).toEqual(['online']);
  });

  it('does not mutate the input result', () => {
    const original = makeResult();
    const actions: RuleAction[] = [{ type: 'set_category', value: 'cat-1' }];
    applyActions(actions, original);
    expect(original.categoryId).toBeNull(); // unchanged
  });

  it('does not mutate the input tags array', () => {
    const original = makeResult({ tags: ['existing'] });
    const actions: RuleAction[] = [{ type: 'add_tag', value: 'new' }];
    const result = applyActions(actions, original);
    expect(original.tags).toEqual(['existing']);
    expect(result.tags).toEqual(['existing', 'new']);
  });
});
