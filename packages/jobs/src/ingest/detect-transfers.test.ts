import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for `detectAndPersistTransferCandidates`.
 *
 * Like the `apply-rules.test.ts` suite, these use a hand-built mock tx
 * rather than a live database. The tests exercise the adapter layer:
 * loading inputs, shaping them for the core detector, and persisting
 * returned candidates. The detection heuristic itself is tested in
 * `packages/core/src/transfers/index.test.ts`, so we only assert the
 * shapes the adapter produces and the counts it returns.
 */

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ _eq: val })),
  and: vi.fn((...clauses) => ({ _and: clauses })),
  gte: vi.fn((_col, val) => ({ _gte: val })),
  isNotNull: vi.fn((_col) => ({ _isNotNull: true })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    _sql: strings.raw.join('?'),
    _values: values,
  }),
}));

vi.mock('@budget-tracker/db/schema', () => ({
  entry: {
    id: 'entry.id',
    description: 'entry.description',
    entryDate: 'entry.entry_date',
    entryableType: 'entry.entryable_type',
    familyId: 'entry.family_id',
  },
  entryLine: {
    entryId: 'entry_line.entry_id',
    accountId: 'entry_line.account_id',
    amount: 'entry_line.amount',
  },
  account: {
    id: 'account.id',
    familyId: 'account.family_id',
  },
  transferCandidate: {
    id: 'transfer_candidate.id',
    entryAId: 'transfer_candidate.entry_a_id',
  },
}));

/**
 * Build a mock `DatabaseTx` with queued canned results.
 *
 * Order matters. The helper performs two selects (accounts first, then
 * entries) and an insert per candidate. Provide the select results in
 * call order; insert results default to a single-row return so every
 * candidate counts as created.
 */
function makeMockTx(options: {
  accountRows: Array<{ id: string }>;
  entryRows: unknown[];
  insertReturnsForEachCall?: unknown[][];
}) {
  const selectQueue: unknown[][] = [
    options.accountRows,
    options.entryRows,
  ];
  const insertQueue = [...(options.insertReturnsForEachCall ?? [])];

  const whereFn = vi.fn().mockImplementation(async () => {
    return selectQueue.shift() ?? [];
  });
  const innerJoinWhereFn = vi.fn().mockImplementation(async () => {
    return selectQueue.shift() ?? [];
  });
  const innerJoinFn = vi.fn(() => ({ where: innerJoinWhereFn }));
  const fromFn = vi.fn(() => ({
    where: whereFn,
    innerJoin: innerJoinFn,
  }));
  const selectFn = vi.fn(() => ({ from: fromFn }));

  const returningFn = vi.fn().mockImplementation(async () => {
    return insertQueue.shift() ?? [{ id: 'new-candidate' }];
  });
  const onConflictFn = vi.fn(() => ({ returning: returningFn }));
  const valuesFn = vi.fn(() => ({ onConflictDoNothing: onConflictFn }));
  const insertFn = vi.fn(() => ({ values: valuesFn }));

  return {
    tx: { select: selectFn, insert: insertFn } as any,
    mocks: { selectFn, insertFn, valuesFn, onConflictFn, returningFn },
  };
}

describe('detectAndPersistTransferCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero when the family owns no accounts', async () => {
    const { detectAndPersistTransferCandidates } = await import(
      './detect-transfers.ts'
    );
    const { tx, mocks } = makeMockTx({ accountRows: [], entryRows: [] });

    const result = await detectAndPersistTransferCandidates(tx, 'family-1');

    expect(result).toEqual({ candidatesCreated: 0 });
    expect(mocks.insertFn).not.toHaveBeenCalled();
  });

  it('returns zero when there are no candidate entries in the window', async () => {
    const { detectAndPersistTransferCandidates } = await import(
      './detect-transfers.ts'
    );
    const { tx, mocks } = makeMockTx({
      accountRows: [{ id: 'acct-a' }, { id: 'acct-b' }],
      entryRows: [],
    });

    const result = await detectAndPersistTransferCandidates(tx, 'family-1');

    expect(result).toEqual({ candidatesCreated: 0 });
    expect(mocks.insertFn).not.toHaveBeenCalled();
  });

  it('inserts a transfer_candidate row for one clear opposite-sign pair', async () => {
    const { detectAndPersistTransferCandidates } = await import(
      './detect-transfers.ts'
    );

    const { tx, mocks } = makeMockTx({
      accountRows: [{ id: 'acct-a' }, { id: 'acct-b' }],
      entryRows: [
        {
          entryId: 'entry-out',
          description: 'Transfer to Savings',
          entryDate: new Date('2026-04-10T00:00:00Z'),
          entryableType: 'transaction',
          amount: '-500.0000',
          accountId: 'acct-a',
        },
        {
          entryId: 'entry-in',
          description: 'Transfer from Checking',
          entryDate: new Date('2026-04-10T00:00:00Z'),
          entryableType: 'transaction',
          amount: '500.0000',
          accountId: 'acct-b',
        },
      ],
    });

    const result = await detectAndPersistTransferCandidates(tx, 'family-1');

    expect(result).toEqual({ candidatesCreated: 1 });
    expect(mocks.insertFn).toHaveBeenCalledTimes(1);

    // Verify the inserted values contain the detected pair + confidence
    // as a two-decimal string (matches the numeric(3,2) column).
    const insertedValues = (mocks.valuesFn.mock.calls as any)[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertedValues.familyId).toBe('family-1');
    expect(insertedValues.entryAId).toBe('entry-in'); // positive-sign leg
    expect(insertedValues.entryBId).toBe('entry-out'); // negative-sign leg
    expect(insertedValues.confidence).toBe('1.00');
  });

  it('treats an onConflict-empty insert as a skipped duplicate', async () => {
    const { detectAndPersistTransferCandidates } = await import(
      './detect-transfers.ts'
    );

    const { tx, mocks } = makeMockTx({
      accountRows: [{ id: 'acct-a' }, { id: 'acct-b' }],
      entryRows: [
        {
          entryId: 'entry-out',
          description: 'Transfer to Savings',
          entryDate: '2026-04-10',
          entryableType: 'transaction',
          amount: '-500.0000',
          accountId: 'acct-a',
        },
        {
          entryId: 'entry-in',
          description: 'Transfer from Checking',
          entryDate: '2026-04-10',
          entryableType: 'transaction',
          amount: '500.0000',
          accountId: 'acct-b',
        },
      ],
      insertReturnsForEachCall: [[]], // empty = conflict, nothing persisted
    });

    const result = await detectAndPersistTransferCandidates(tx, 'family-1');

    expect(result).toEqual({ candidatesCreated: 0 });
    expect(mocks.insertFn).toHaveBeenCalledTimes(1);
  });

  it('ignores entries whose account-side leg accountId is null', async () => {
    const { detectAndPersistTransferCandidates } = await import(
      './detect-transfers.ts'
    );

    const { tx, mocks } = makeMockTx({
      accountRows: [{ id: 'acct-a' }, { id: 'acct-b' }],
      entryRows: [
        {
          entryId: 'entry-out',
          description: 'malformed',
          entryDate: '2026-04-10',
          entryableType: 'transaction',
          amount: '-500.0000',
          accountId: null,
        },
      ],
    });

    const result = await detectAndPersistTransferCandidates(tx, 'family-1');

    expect(result).toEqual({ candidatesCreated: 0 });
    expect(mocks.insertFn).not.toHaveBeenCalled();
  });
});
