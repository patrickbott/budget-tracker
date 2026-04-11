import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for `detectRecurringCandidatesForFamily`.
 *
 * The helper does two things: load 180 days of entries (joined to
 * their account-side `entry_line`) and pipe them through the pure
 * `detectRecurringCandidates` function from
 * `@budget-tracker/core/recurring`. These tests cover the wiring —
 * empty inputs, a clean monthly series, and a mixed history with
 * one-offs — against a hand-built mock `DatabaseTx`. The detector
 * itself is unit-tested in core; we only verify shape conversion
 * and pass-through here.
 */

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ _eq: val })),
  and: vi.fn((...clauses) => ({ _and: clauses })),
  gte: vi.fn((_col, val) => ({ _gte: val })),
  isNotNull: vi.fn((_col) => ({ _isNotNull: true })),
}));

vi.mock('@budget-tracker/db/schema', () => ({
  entry: {
    id: 'entry.id',
    description: 'entry.description',
    entryDate: 'entry.entry_date',
    familyId: 'entry.family_id',
  },
  entryLine: {
    entryId: 'entry_line.entry_id',
    accountId: 'entry_line.account_id',
    amount: 'entry_line.amount',
  },
}));

/**
 * Build a minimal mock `DatabaseTx` whose
 * `.select().from().innerJoin().where()` chain resolves to the canned
 * rows the test provides. The helper only issues a single select, so
 * one canned result is enough.
 */
function makeMockTx(rows: unknown[]) {
  const whereFn = vi.fn().mockResolvedValue(rows);
  const innerJoinFn = vi.fn(() => ({ where: whereFn }));
  const fromFn = vi.fn(() => ({ innerJoin: innerJoinFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));

  return {
    tx: { select: selectFn } as any,
    mocks: { selectFn, fromFn, innerJoinFn, whereFn },
  };
}

describe('detectRecurringCandidatesForFamily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty candidate list when the family has no entries in the window', async () => {
    const { detectRecurringCandidatesForFamily } = await import(
      './detect-recurring.ts'
    );
    const { tx, mocks } = makeMockTx([]);

    const result = await detectRecurringCandidatesForFamily(tx, 'family-1');

    expect(result).toEqual({ candidates: [] });
    expect(mocks.selectFn).toHaveBeenCalledTimes(1);
  });

  it('detects a monthly recurring series with high confidence', async () => {
    const { detectRecurringCandidatesForFamily } = await import(
      './detect-recurring.ts'
    );

    // Six months of identical Netflix charges on the 1st of each
    // month — exactly the shape the core detector classifies as
    // monthly with confidence 1.0.
    const rows = [
      {
        entryId: 'e1',
        description: 'Netflix Subscription',
        entryDate: new Date('2025-11-01T00:00:00Z'),
        amount: '-15.9900',
      },
      {
        entryId: 'e2',
        description: 'Netflix Subscription',
        entryDate: new Date('2025-12-01T00:00:00Z'),
        amount: '-15.9900',
      },
      {
        entryId: 'e3',
        description: 'Netflix Subscription',
        entryDate: new Date('2026-01-01T00:00:00Z'),
        amount: '-15.9900',
      },
      {
        entryId: 'e4',
        description: 'Netflix Subscription',
        entryDate: new Date('2026-02-01T00:00:00Z'),
        amount: '-15.9900',
      },
      {
        entryId: 'e5',
        description: 'Netflix Subscription',
        entryDate: new Date('2026-03-01T00:00:00Z'),
        amount: '-15.9900',
      },
      {
        entryId: 'e6',
        description: 'Netflix Subscription',
        entryDate: new Date('2026-04-01T00:00:00Z'),
        amount: '-15.9900',
      },
    ];
    const { tx } = makeMockTx(rows);

    const result = await detectRecurringCandidatesForFamily(tx, 'family-1');

    expect(result.candidates).toHaveLength(1);
    const [candidate] = result.candidates;
    expect(candidate!.cadence).toBe('monthly');
    expect(candidate!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(candidate!.expectedAmount).toBe('-15.99');
  });

  it('separates a recurring series from unrelated one-off purchases', async () => {
    const { detectRecurringCandidatesForFamily } = await import(
      './detect-recurring.ts'
    );

    const rows = [
      // Recurring monthly rent (4 hits → enough for the detector).
      {
        entryId: 'r1',
        description: 'Rent Payment ACH',
        entryDate: new Date('2026-01-01T00:00:00Z'),
        amount: '-2100.0000',
      },
      {
        entryId: 'r2',
        description: 'Rent Payment ACH',
        entryDate: new Date('2026-02-01T00:00:00Z'),
        amount: '-2100.0000',
      },
      {
        entryId: 'r3',
        description: 'Rent Payment ACH',
        entryDate: new Date('2026-03-01T00:00:00Z'),
        amount: '-2100.0000',
      },
      {
        entryId: 'r4',
        description: 'Rent Payment ACH',
        entryDate: new Date('2026-04-01T00:00:00Z'),
        amount: '-2100.0000',
      },
      // One-off purchases — different merchants, no series.
      {
        entryId: 'o1',
        description: 'Best Buy',
        entryDate: new Date('2026-02-15T00:00:00Z'),
        amount: '-299.9900',
      },
      {
        entryId: 'o2',
        description: 'Whole Foods',
        entryDate: new Date('2026-03-04T00:00:00Z'),
        amount: '-87.4200',
      },
      {
        entryId: 'o3',
        description: 'Shell Gas Station',
        entryDate: new Date('2026-03-22T00:00:00Z'),
        amount: '-45.0000',
      },
    ];
    const { tx } = makeMockTx(rows);

    const result = await detectRecurringCandidatesForFamily(tx, 'family-1');

    expect(result.candidates).toHaveLength(1);
    const [rent] = result.candidates;
    expect(rent!.cadence).toBe('monthly');
    expect(rent!.expectedAmount).toBe('-2100.00');
    expect(rent!.descriptionPattern).toContain('rent');
  });

  it('tolerates ISO-date strings from the DB driver alongside Date objects', async () => {
    const { detectRecurringCandidatesForFamily } = await import(
      './detect-recurring.ts'
    );

    // Same monthly series but the entryDate field arrives as ISO
    // strings — the helper's `toIsoDate` should accept both.
    const rows = [
      {
        entryId: 'e1',
        description: 'Spotify Premium',
        entryDate: '2025-11-15',
        amount: '-9.9900',
      },
      {
        entryId: 'e2',
        description: 'Spotify Premium',
        entryDate: '2025-12-15',
        amount: '-9.9900',
      },
      {
        entryId: 'e3',
        description: 'Spotify Premium',
        entryDate: '2026-01-15',
        amount: '-9.9900',
      },
      {
        entryId: 'e4',
        description: 'Spotify Premium',
        entryDate: '2026-02-15',
        amount: '-9.9900',
      },
    ];
    const { tx } = makeMockTx(rows);

    const result = await detectRecurringCandidatesForFamily(tx, 'family-1');

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.cadence).toBe('monthly');
  });
});
