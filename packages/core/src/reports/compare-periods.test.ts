import { describe, it, expect } from 'vitest';

import { comparePeriods } from './compare-periods.ts';
import type { ReportEntryInput, ReportWindow } from './types.ts';

const WIN_A: ReportWindow = { start: '2026-02-01', end: '2026-03-01' };
const WIN_B: ReportWindow = { start: '2026-03-01', end: '2026-04-01' };

describe('comparePeriods', () => {
  it('returns an empty list for an empty input', () => {
    expect(
      comparePeriods({
        entries: [],
        windowA: WIN_A,
        windowB: WIN_B,
        dimension: 'category',
      }),
    ).toEqual([]);
  });

  it('entries only in window A → rows with b = "0.00" and negative delta', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-02-10',
        amountSigned: '-80.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
      {
        entryId: 'e2',
        entryDate: '2026-02-20',
        amountSigned: '-120.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
    ];

    expect(
      comparePeriods({
        entries,
        windowA: WIN_A,
        windowB: WIN_B,
        dimension: 'category',
      }),
    ).toEqual([
      { dimension: 'cat-dining', a: '200.00', b: '0.00', delta: '-200.00' },
    ]);
  });

  it('entries only in window B → rows with a = "0.00" and positive delta', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-05',
        amountSigned: '-60.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-coffee',
        isTransfer: false,
      },
    ];

    expect(
      comparePeriods({
        entries,
        windowA: WIN_A,
        windowB: WIN_B,
        dimension: 'category',
      }),
    ).toEqual([
      { dimension: 'cat-coffee', a: '0.00', b: '60.00', delta: '60.00' },
    ]);
  });

  it('joins overlapping categories with both-side totals and a signed delta', () => {
    const entries: ReportEntryInput[] = [
      // Groceries: A=200, B=250 → delta +50
      {
        entryId: 'a1',
        entryDate: '2026-02-10',
        amountSigned: '-200.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
      {
        entryId: 'b1',
        entryDate: '2026-03-10',
        amountSigned: '-250.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
      // Dining: A=100, B=40 → delta -60
      {
        entryId: 'a2',
        entryDate: '2026-02-15',
        amountSigned: '-100.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
      {
        entryId: 'b2',
        entryDate: '2026-03-15',
        amountSigned: '-40.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
    ];

    expect(
      comparePeriods({
        entries,
        windowA: WIN_A,
        windowB: WIN_B,
        dimension: 'category',
      }),
    ).toEqual([
      { dimension: 'cat-dining', a: '100.00', b: '40.00', delta: '-60.00' },
      { dimension: 'cat-groceries', a: '200.00', b: '250.00', delta: '50.00' },
    ]);
  });

  it('still includes categories that disappear in window B', () => {
    const entries: ReportEntryInput[] = [
      // Rent: present in A, absent in B
      {
        entryId: 'a1',
        entryDate: '2026-02-01',
        amountSigned: '-1500.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-rent',
        isTransfer: false,
      },
      // Groceries: present in both, smaller delta
      {
        entryId: 'a2',
        entryDate: '2026-02-10',
        amountSigned: '-100.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
      {
        entryId: 'b2',
        entryDate: '2026-03-10',
        amountSigned: '-110.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
    ];

    const result = comparePeriods({
      entries,
      windowA: WIN_A,
      windowB: WIN_B,
      dimension: 'category',
    });

    expect(result).toEqual([
      { dimension: 'cat-rent', a: '1500.00', b: '0.00', delta: '-1500.00' },
      { dimension: 'cat-groceries', a: '100.00', b: '110.00', delta: '10.00' },
    ]);
  });

  it('sorts by absolute delta DESC regardless of sign', () => {
    // +$500 increase should outrank a -$100 decrease
    const entries: ReportEntryInput[] = [
      // cat-big-jump: 100 → 600  (delta +500)
      {
        entryId: 'a1',
        entryDate: '2026-02-05',
        amountSigned: '-100.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-big-jump',
        isTransfer: false,
      },
      {
        entryId: 'b1',
        entryDate: '2026-03-05',
        amountSigned: '-600.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-big-jump',
        isTransfer: false,
      },
      // cat-small-drop: 200 → 100 (delta -100)
      {
        entryId: 'a2',
        entryDate: '2026-02-12',
        amountSigned: '-200.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-small-drop',
        isTransfer: false,
      },
      {
        entryId: 'b2',
        entryDate: '2026-03-12',
        amountSigned: '-100.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-small-drop',
        isTransfer: false,
      },
      // cat-medium: 50 → 250 (delta +200)
      {
        entryId: 'a3',
        entryDate: '2026-02-20',
        amountSigned: '-50.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-medium',
        isTransfer: false,
      },
      {
        entryId: 'b3',
        entryDate: '2026-03-20',
        amountSigned: '-250.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-medium',
        isTransfer: false,
      },
    ];

    const result = comparePeriods({
      entries,
      windowA: WIN_A,
      windowB: WIN_B,
      dimension: 'category',
    });

    expect(result.map((r) => r.dimension)).toEqual([
      'cat-big-jump', // |+500|
      'cat-medium', // |+200|
      'cat-small-drop', // |-100|
    ]);
  });

  it('applies the half-open window on both edges in both windows', () => {
    // WIN_A = [2026-02-01, 2026-03-01) → Feb-01 included, Mar-01 excluded
    // WIN_B = [2026-03-01, 2026-04-01) → Mar-01 included, Apr-01 excluded
    // Each edge entry uses a distinct amount so we can verify exactly
    // which entries made it into which aggregate.
    const entries: ReportEntryInput[] = [
      // WIN_A start edge — included in A
      {
        entryId: 'a-start',
        entryDate: '2026-02-01',
        amountSigned: '-10.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-boundary',
        isTransfer: false,
      },
      // WIN_A end edge — EXCLUDED from A, but it equals WIN_B start → included in B
      {
        entryId: 'a-end',
        entryDate: '2026-03-01',
        amountSigned: '-999.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-boundary',
        isTransfer: false,
      },
      // WIN_B end edge — EXCLUDED from B entirely
      {
        entryId: 'b-end',
        entryDate: '2026-04-01',
        amountSigned: '-5000.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-boundary',
        isTransfer: false,
      },
    ];

    // Expected:
    //   A = 10 (only 2026-02-01)
    //   B = 999 (only 2026-03-01; 2026-04-01 excluded)
    expect(
      comparePeriods({
        entries,
        windowA: WIN_A,
        windowB: WIN_B,
        dimension: 'category',
      }),
    ).toEqual([
      { dimension: 'cat-boundary', a: '10.00', b: '999.00', delta: '989.00' },
    ]);
  });

  it('breaks |delta| ties with an alphabetic ASC tiebreaker on dimension', () => {
    // Three categories with identical |delta| of 50. We insert them in a
    // non-alphabetic order so the test would fail if the sort were stable
    // on insertion order instead of key-alpha.
    const entries: ReportEntryInput[] = [
      // cat-zeta: 100 → 50 (delta -50)
      {
        entryId: 'z-a',
        entryDate: '2026-02-10',
        amountSigned: '-100.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-zeta',
        isTransfer: false,
      },
      {
        entryId: 'z-b',
        entryDate: '2026-03-10',
        amountSigned: '-50.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-zeta',
        isTransfer: false,
      },
      // cat-alpha: 0 → 50 (delta +50)
      {
        entryId: 'a-b',
        entryDate: '2026-03-15',
        amountSigned: '-50.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-alpha',
        isTransfer: false,
      },
      // cat-middle: 50 → 0 (delta -50)
      {
        entryId: 'm-a',
        entryDate: '2026-02-20',
        amountSigned: '-50.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-middle',
        isTransfer: false,
      },
    ];

    const result = comparePeriods({
      entries,
      windowA: WIN_A,
      windowB: WIN_B,
      dimension: 'category',
    });

    expect(result.map((r) => r.dimension)).toEqual([
      'cat-alpha',
      'cat-middle',
      'cat-zeta',
    ]);
  });

  it('groups by accountId when dimension === "account"', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'a1',
        entryDate: '2026-02-05',
        amountSigned: '-60.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
      {
        entryId: 'b1',
        entryDate: '2026-03-05',
        amountSigned: '-90.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
      {
        entryId: 'b2',
        entryDate: '2026-03-20',
        amountSigned: '-200.0000',
        accountId: 'acc-credit',
        categoryId: 'cat-rent',
        isTransfer: false,
      },
    ];

    expect(
      comparePeriods({
        entries,
        windowA: WIN_A,
        windowB: WIN_B,
        dimension: 'account',
      }),
    ).toEqual([
      { dimension: 'acc-credit', a: '0.00', b: '200.00', delta: '200.00' },
      { dimension: 'acc-checking', a: '60.00', b: '90.00', delta: '30.00' },
    ]);
  });
});
