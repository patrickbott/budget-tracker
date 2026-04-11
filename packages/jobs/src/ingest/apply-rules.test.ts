import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for `applyRulesToEntries`.
 *
 * The helper composes four distinct DB operations — rules load, entries
 * load, core `runRules` call, and per-match category-side entry_line
 * update — and these tests exercise each shape of result (empty inputs,
 * no matches, one match, multiple matches) against a hand-built mock
 * `DatabaseTx`. No real database is involved; `drizzle-orm` and the
 * schema module are vi.mock'd so we can assert on the SQL builder call
 * shape without running queries.
 */

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ _eq: val })),
  and: vi.fn((...clauses) => ({ _and: clauses })),
  inArray: vi.fn((_col, values) => ({ _inArray: values })),
  isNull: vi.fn((_col) => ({ _isNull: true })),
  isNotNull: vi.fn((_col) => ({ _isNotNull: true })),
}));

vi.mock('@budget-tracker/db/schema', () => ({
  rule: {
    id: 'rule.id',
    stage: 'rule.stage',
    specificityScore: 'rule.specificity_score',
    conditionsJson: 'rule.conditions_json',
    actionsJson: 'rule.actions_json',
    familyId: 'rule.family_id',
    enabled: 'rule.enabled',
  },
  entry: {
    id: 'entry.id',
    description: 'entry.description',
    entryDate: 'entry.entry_date',
  },
  entryLine: {
    entryId: 'entry_line.entry_id',
    accountId: 'entry_line.account_id',
    categoryId: 'entry_line.category_id',
    amount: 'entry_line.amount',
  },
  account: {
    id: 'account.id',
    currency: 'account.currency',
  },
}));

/**
 * Build a minimal mock `DatabaseTx` whose `.select().from().where()` chain
 * resolves to the values provided by the test. The helper threads two
 * separate selects (rules + entries) through the same mock by popping
 * from a FIFO queue of canned results on each `.where()` call.
 */
function makeMockTx(options: {
  ruleRows?: unknown[];
  entryRows?: unknown[];
  onUpdate?: () => void;
}) {
  const selectQueue: unknown[][] = [];
  if (options.ruleRows) selectQueue.push(options.ruleRows);
  if (options.entryRows) selectQueue.push(options.entryRows);

  const updateWhereFn = vi.fn().mockImplementation(async () => {
    options.onUpdate?.();
    return undefined;
  });
  const updateSetFn = vi.fn(() => ({ where: updateWhereFn }));
  const updateFn = vi.fn(() => ({ set: updateSetFn }));

  // `select()` chain returns a thenable wrapper so both terminal awaits
  // (direct await on `.where()` for rules load, direct await on
  // `.innerJoin(...).innerJoin(...).where()` for entries load) resolve
  // to the next canned result.
  const whereFn = vi.fn().mockImplementation(async () => {
    return selectQueue.shift() ?? [];
  });
  const innerJoinTerminalWhereFn = vi.fn().mockImplementation(async () => {
    return selectQueue.shift() ?? [];
  });
  const innerJoin2Fn = vi.fn(() => ({ where: innerJoinTerminalWhereFn }));
  const innerJoin1Fn = vi.fn(() => ({ innerJoin: innerJoin2Fn }));
  const fromFn = vi.fn(() => ({
    where: whereFn,
    innerJoin: innerJoin1Fn,
  }));
  const selectFn = vi.fn(() => ({ from: fromFn }));

  return {
    tx: { select: selectFn, update: updateFn } as any,
    mocks: { selectFn, updateFn, updateSetFn, updateWhereFn },
  };
}

describe('applyRulesToEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero counts for empty entry list without hitting the DB', async () => {
    const { applyRulesToEntries } = await import('./apply-rules.ts');
    const { tx, mocks } = makeMockTx({});

    const result = await applyRulesToEntries(tx, 'family-1', []);

    expect(result).toEqual({ entriesUpdated: 0 });
    expect(mocks.selectFn).not.toHaveBeenCalled();
  });

  it('returns zero counts when no rules are enabled', async () => {
    const { applyRulesToEntries } = await import('./apply-rules.ts');
    const { tx, mocks } = makeMockTx({ ruleRows: [] });

    const result = await applyRulesToEntries(tx, 'family-1', ['entry-1']);

    expect(result).toEqual({ entriesUpdated: 0 });
    expect(mocks.updateFn).not.toHaveBeenCalled();
  });

  it('returns zero counts when rules exist but no target entries resolve', async () => {
    const { applyRulesToEntries } = await import('./apply-rules.ts');
    const { tx, mocks } = makeMockTx({
      ruleRows: [
        {
          id: 'rule-1',
          stage: 'default',
          specificityScore: 10,
          conditionsJson: [
            { field: 'description', operator: 'contains', value: 'Coffee' },
          ],
          actionsJson: [{ type: 'set_category', value: 'cat-coffee' }],
        },
      ],
      entryRows: [],
    });

    const result = await applyRulesToEntries(tx, 'family-1', ['entry-1']);

    expect(result).toEqual({ entriesUpdated: 0 });
    expect(mocks.updateFn).not.toHaveBeenCalled();
  });

  it('applies a matching rule and updates the category-side entry_line', async () => {
    const { applyRulesToEntries } = await import('./apply-rules.ts');

    let updateCalls = 0;
    const { tx, mocks } = makeMockTx({
      ruleRows: [
        {
          id: 'rule-coffee',
          stage: 'default',
          specificityScore: 10,
          conditionsJson: [
            { field: 'description', operator: 'contains', value: 'Coffee' },
          ],
          actionsJson: [{ type: 'set_category', value: 'cat-coffee' }],
        },
      ],
      entryRows: [
        {
          entryId: 'entry-1',
          description: 'Blue Bottle Coffee',
          entryDate: new Date('2026-04-10T00:00:00Z'),
          amount: '-4.5000',
          accountId: 'acct-1',
          currency: 'USD',
        },
      ],
      onUpdate: () => {
        updateCalls++;
      },
    });

    const result = await applyRulesToEntries(tx, 'family-1', ['entry-1']);

    expect(result).toEqual({ entriesUpdated: 1 });
    expect(updateCalls).toBe(1);
    expect(mocks.updateSetFn).toHaveBeenCalledWith({ categoryId: 'cat-coffee' });
  });

  it('skips entries where no rule produces a category', async () => {
    const { applyRulesToEntries } = await import('./apply-rules.ts');

    const { tx, mocks } = makeMockTx({
      ruleRows: [
        {
          id: 'rule-coffee',
          stage: 'default',
          specificityScore: 10,
          conditionsJson: [
            { field: 'description', operator: 'contains', value: 'Coffee' },
          ],
          actionsJson: [{ type: 'set_category', value: 'cat-coffee' }],
        },
      ],
      entryRows: [
        {
          entryId: 'entry-2',
          description: 'Shell Gas Station',
          entryDate: new Date('2026-04-10T00:00:00Z'),
          amount: '-35.0000',
          accountId: 'acct-1',
          currency: 'USD',
        },
      ],
    });

    const result = await applyRulesToEntries(tx, 'family-1', ['entry-2']);

    expect(result).toEqual({ entriesUpdated: 0 });
    expect(mocks.updateFn).not.toHaveBeenCalled();
  });

  it('applies rules to multiple entries and counts each matching one', async () => {
    const { applyRulesToEntries } = await import('./apply-rules.ts');

    let updateCalls = 0;
    const { tx } = makeMockTx({
      ruleRows: [
        {
          id: 'rule-coffee',
          stage: 'default',
          specificityScore: 10,
          conditionsJson: [
            { field: 'description', operator: 'contains', value: 'Coffee' },
          ],
          actionsJson: [{ type: 'set_category', value: 'cat-coffee' }],
        },
      ],
      entryRows: [
        {
          entryId: 'entry-a',
          description: 'Blue Bottle Coffee',
          entryDate: '2026-04-10',
          amount: '-4.5000',
          accountId: 'acct-1',
          currency: 'USD',
        },
        {
          entryId: 'entry-b',
          description: 'Philz Coffee',
          entryDate: '2026-04-09',
          amount: '-6.0000',
          accountId: 'acct-1',
          currency: 'USD',
        },
        {
          entryId: 'entry-c',
          description: 'Shell Gas',
          entryDate: '2026-04-08',
          amount: '-35.0000',
          accountId: 'acct-1',
          currency: 'USD',
        },
      ],
      onUpdate: () => {
        updateCalls++;
      },
    });

    const result = await applyRulesToEntries(tx, 'family-1', [
      'entry-a',
      'entry-b',
      'entry-c',
    ]);

    expect(result).toEqual({ entriesUpdated: 2 });
    expect(updateCalls).toBe(2);
  });

  it('accepts ISO-date strings from the DB driver unchanged', async () => {
    const { applyRulesToEntries } = await import('./apply-rules.ts');

    const { tx } = makeMockTx({
      ruleRows: [
        {
          id: 'rule-date',
          stage: 'default',
          specificityScore: 5,
          conditionsJson: [
            { field: 'description', operator: 'contains', value: 'Coffee' },
          ],
          actionsJson: [{ type: 'set_category', value: 'cat-coffee' }],
        },
      ],
      entryRows: [
        {
          entryId: 'entry-a',
          description: 'Blue Bottle Coffee',
          entryDate: '2026-04-10',
          amount: '-4.5000',
          accountId: 'acct-1',
          currency: 'USD',
        },
      ],
    });

    const result = await applyRulesToEntries(tx, 'family-1', ['entry-a']);
    expect(result).toEqual({ entriesUpdated: 1 });
  });
});
