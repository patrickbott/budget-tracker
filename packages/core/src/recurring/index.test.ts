import { describe, expect, it } from 'vitest';

import {
  computeMissingDates,
  detectRecurringCandidates,
  type RecurringEntryInput,
} from './index.ts';

// ---------------------------------------------------------------------------
// detectRecurringCandidates
// ---------------------------------------------------------------------------

describe('detectRecurringCandidates', () => {
  it('returns an empty list for an empty input', () => {
    expect(detectRecurringCandidates([])).toEqual([]);
  });

  it('detects a monthly payment from 3 evenly-spaced entries', () => {
    const entries: RecurringEntryInput[] = [
      {
        entryId: 'e1',
        amount: '-15.99',
        entryDate: '2026-01-05',
        description: 'NETFLIX.COM',
      },
      {
        entryId: 'e2',
        amount: '-15.99',
        entryDate: '2026-02-05',
        description: 'NETFLIX.COM',
      },
      {
        entryId: 'e3',
        amount: '-15.99',
        entryDate: '2026-03-05',
        description: 'NETFLIX.COM',
      },
    ];

    const candidates = detectRecurringCandidates(entries);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.cadence).toBe('monthly');
    expect(candidates[0]!.expectedAmount).toBe('-15.99');
    expect(candidates[0]!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(candidates[0]!.descriptionPattern).toContain('netflix');
  });

  it('detects a weekly payment', () => {
    const entries: RecurringEntryInput[] = [
      { entryId: 'e1', amount: '-8.50', entryDate: '2026-03-02', description: 'COFFEE SHOP' },
      { entryId: 'e2', amount: '-8.50', entryDate: '2026-03-09', description: 'COFFEE SHOP' },
      { entryId: 'e3', amount: '-8.50', entryDate: '2026-03-16', description: 'COFFEE SHOP' },
      { entryId: 'e4', amount: '-8.50', entryDate: '2026-03-23', description: 'COFFEE SHOP' },
    ];

    const candidates = detectRecurringCandidates(entries);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.cadence).toBe('weekly');
  });

  it('detects a biweekly paycheck', () => {
    const entries: RecurringEntryInput[] = [
      { entryId: 'e1', amount: '2500.00', entryDate: '2026-01-02', description: 'ACME CORP PAYROLL' },
      { entryId: 'e2', amount: '2500.00', entryDate: '2026-01-16', description: 'ACME CORP PAYROLL' },
      { entryId: 'e3', amount: '2500.00', entryDate: '2026-01-30', description: 'ACME CORP PAYROLL' },
      { entryId: 'e4', amount: '2500.00', entryDate: '2026-02-13', description: 'ACME CORP PAYROLL' },
    ];

    const candidates = detectRecurringCandidates(entries);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.cadence).toBe('biweekly');
  });

  it('ignores entries with wildly varying gaps (no cadence fits)', () => {
    const entries: RecurringEntryInput[] = [
      { entryId: 'e1', amount: '-10.00', entryDate: '2026-01-01', description: 'RANDOM STORE' },
      { entryId: 'e2', amount: '-10.00', entryDate: '2026-01-03', description: 'RANDOM STORE' },
      { entryId: 'e3', amount: '-10.00', entryDate: '2026-03-17', description: 'RANDOM STORE' },
    ];

    expect(detectRecurringCandidates(entries)).toEqual([]);
  });

  it('does not flag merchants with fewer than 3 matching entries', () => {
    const entries: RecurringEntryInput[] = [
      { entryId: 'e1', amount: '-20.00', entryDate: '2026-01-05', description: 'SPOTIFY' },
      { entryId: 'e2', amount: '-20.00', entryDate: '2026-02-05', description: 'SPOTIFY' },
    ];

    expect(detectRecurringCandidates(entries)).toEqual([]);
  });

  it('treats amounts within 5% as part of the same series', () => {
    const entries: RecurringEntryInput[] = [
      { entryId: 'e1', amount: '-99.00', entryDate: '2026-01-10', description: 'POWER BILL' },
      { entryId: 'e2', amount: '-101.00', entryDate: '2026-02-10', description: 'POWER BILL' },
      { entryId: 'e3', amount: '-100.50', entryDate: '2026-03-10', description: 'POWER BILL' },
    ];

    const candidates = detectRecurringCandidates(entries);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.cadence).toBe('monthly');
  });

  it('groups entries by normalized description prefix', () => {
    const entries: RecurringEntryInput[] = [
      { entryId: 'e1', amount: '-15.99', entryDate: '2026-01-05', description: 'NETFLIX.COM 123' },
      { entryId: 'e2', amount: '-15.99', entryDate: '2026-02-05', description: 'netflix.com 456' },
      { entryId: 'e3', amount: '-15.99', entryDate: '2026-03-05', description: 'NETFLIX.COM  789' },
    ];

    const candidates = detectRecurringCandidates(entries);

    expect(candidates).toHaveLength(1);
  });

  it('sorts candidates by confidence DESC then group size DESC', () => {
    const entries: RecurringEntryInput[] = [
      // Perfect monthly series (3 entries, confidence 1.0)
      { entryId: 'a1', amount: '-9.99', entryDate: '2026-01-10', description: 'APPLE ICLOUD' },
      { entryId: 'a2', amount: '-9.99', entryDate: '2026-02-10', description: 'APPLE ICLOUD' },
      { entryId: 'a3', amount: '-9.99', entryDate: '2026-03-10', description: 'APPLE ICLOUD' },
      // Larger but slightly looser series (4 entries, confidence < 1.0 because of one off-gap)
      { entryId: 'b1', amount: '-20.00', entryDate: '2026-01-01', description: 'GYM MEMBERSHIP' },
      { entryId: 'b2', amount: '-20.00', entryDate: '2026-02-01', description: 'GYM MEMBERSHIP' },
      { entryId: 'b3', amount: '-20.00', entryDate: '2026-03-01', description: 'GYM MEMBERSHIP' },
      { entryId: 'b4', amount: '-20.00', entryDate: '2026-04-01', description: 'GYM MEMBERSHIP' },
    ];

    const candidates = detectRecurringCandidates(entries);

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    // Either both have 1.0 confidence and the bigger group wins, or the
    // perfect one wins. Both orderings satisfy the sort rule.
    if (candidates[0]!.confidence === candidates[1]!.confidence) {
      // tie → larger group first
      expect(candidates[0]!.descriptionPattern).toContain('gym');
    } else {
      expect(candidates[0]!.confidence).toBeGreaterThanOrEqual(
        candidates[1]!.confidence,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// computeMissingDates
// ---------------------------------------------------------------------------

describe('computeMissingDates', () => {
  it('returns an empty list when all expected dates are present', () => {
    const missing = computeMissingDates({
      cadence: 'monthly',
      cadenceInterval: 1,
      startDate: '2026-01-15',
      endDate: '2026-04-15',
      actualDates: ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15'],
    });

    expect(missing).toEqual([]);
  });

  it('detects a single missing monthly payment', () => {
    const missing = computeMissingDates({
      cadence: 'monthly',
      cadenceInterval: 1,
      startDate: '2026-01-15',
      endDate: '2026-06-15',
      actualDates: [
        '2026-01-15',
        '2026-02-15',
        // 2026-03-15 is missing
        '2026-04-15',
        '2026-05-15',
        '2026-06-15',
      ],
    });

    expect(missing).toEqual(['2026-03-15']);
  });

  it('matches actuals within a ±3-day tolerance', () => {
    const missing = computeMissingDates({
      cadence: 'monthly',
      cadenceInterval: 1,
      startDate: '2026-01-15',
      endDate: '2026-03-15',
      actualDates: ['2026-01-17', '2026-02-13', '2026-03-15'],
    });

    expect(missing).toEqual([]);
  });

  it('returns all expected dates when actuals is empty', () => {
    const missing = computeMissingDates({
      cadence: 'weekly',
      cadenceInterval: 1,
      startDate: '2026-03-02',
      endDate: '2026-03-23',
      actualDates: [],
    });

    expect(missing).toEqual([
      '2026-03-02',
      '2026-03-09',
      '2026-03-16',
      '2026-03-23',
    ]);
  });

  it('supports cadenceInterval > 1 (every other month)', () => {
    const missing = computeMissingDates({
      cadence: 'monthly',
      cadenceInterval: 2,
      startDate: '2026-01-15',
      endDate: '2026-07-15',
      actualDates: ['2026-01-15', '2026-05-15', '2026-07-15'],
    });

    // Expected: Jan, Mar, May, Jul → missing Mar
    expect(missing).toEqual(['2026-03-15']);
  });
});
