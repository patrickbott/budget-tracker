import { describe, it, expect } from 'vitest';

import { cashflow } from './cashflow.ts';
import type { ReportEntryInput, ReportWindow } from './types.ts';

const MARCH: ReportWindow = { start: '2026-03-01', end: '2026-04-01' };
const Q2: ReportWindow = { start: '2026-03-01', end: '2026-06-01' };

describe('cashflow', () => {
  it('returns an empty list for an empty input', () => {
    expect(
      cashflow({ entries: [], window: MARCH, granularity: 'day' }),
    ).toEqual([]);
  });

  it('only-income window → expense "0.00" per period, net = income', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-15',
        amountSigned: '1500.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-income',
        isTransfer: false,
      },
      {
        entryId: 'e2',
        entryDate: '2026-03-29',
        amountSigned: '500.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-income',
        isTransfer: false,
      },
    ];

    expect(cashflow({ entries, window: MARCH, granularity: 'month' })).toEqual([
      { period: '2026-03-01', income: '2000.00', expense: '0.00', net: '2000.00' },
    ]);
  });

  it('only-expense window → income "0.00" per period, net negative', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-10',
        amountSigned: '-200.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
      {
        entryId: 'e2',
        entryDate: '2026-03-20',
        amountSigned: '-300.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-rent',
        isTransfer: false,
      },
    ];

    expect(cashflow({ entries, window: MARCH, granularity: 'month' })).toEqual([
      { period: '2026-03-01', income: '0.00', expense: '500.00', net: '-500.00' },
    ]);
  });

  it('day granularity → one row per distinct date', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-05',
        amountSigned: '-40.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
      {
        entryId: 'e2',
        entryDate: '2026-03-05',
        amountSigned: '-10.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-coffee',
        isTransfer: false,
      },
      {
        entryId: 'e3',
        entryDate: '2026-03-07',
        amountSigned: '100.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-income',
        isTransfer: false,
      },
    ];

    expect(cashflow({ entries, window: MARCH, granularity: 'day' })).toEqual([
      { period: '2026-03-05', income: '0.00', expense: '50.00', net: '-50.00' },
      { period: '2026-03-07', income: '100.00', expense: '0.00', net: '100.00' },
    ]);
  });

  it('week granularity groups by ISO Monday even across week boundaries', () => {
    // 2026-03-02 is a Monday. 2026-03-08 is Sunday. 2026-03-09 is Monday.
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-06', // Fri → week of Mar 2
        amountSigned: '-25.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
      {
        entryId: 'e2',
        entryDate: '2026-03-08', // Sun → week of Mar 2
        amountSigned: '-15.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
      {
        entryId: 'e3',
        entryDate: '2026-03-09', // Mon → week of Mar 9
        amountSigned: '-100.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-rent',
        isTransfer: false,
      },
    ];

    expect(cashflow({ entries, window: MARCH, granularity: 'week' })).toEqual([
      { period: '2026-03-02', income: '0.00', expense: '40.00', net: '-40.00' },
      { period: '2026-03-09', income: '0.00', expense: '100.00', net: '-100.00' },
    ]);
  });

  it('month granularity groups by first-of-month across month boundaries', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-15',
        amountSigned: '-200.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-rent',
        isTransfer: false,
      },
      {
        entryId: 'e2',
        entryDate: '2026-03-31', // last day of March → still March bucket
        amountSigned: '-50.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
      {
        entryId: 'e3',
        entryDate: '2026-04-01', // first of April → April bucket
        amountSigned: '-75.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
      {
        entryId: 'e4',
        entryDate: '2026-05-20',
        amountSigned: '1000.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-income',
        isTransfer: false,
      },
    ];

    expect(cashflow({ entries, window: Q2, granularity: 'month' })).toEqual([
      { period: '2026-03-01', income: '0.00', expense: '250.00', net: '-250.00' },
      { period: '2026-04-01', income: '0.00', expense: '75.00', net: '-75.00' },
      { period: '2026-05-01', income: '1000.00', expense: '0.00', net: '1000.00' },
    ]);
  });

  it('excludes transfers from both income and expense sides', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-10',
        amountSigned: '-500.0000',
        accountId: 'acc-checking',
        categoryId: null,
        isTransfer: true, // transfer out — excluded
      },
      {
        entryId: 'e2',
        entryDate: '2026-03-10',
        amountSigned: '500.0000',
        accountId: 'acc-savings',
        categoryId: null,
        isTransfer: true, // transfer in — excluded
      },
      {
        entryId: 'e3',
        entryDate: '2026-03-10',
        amountSigned: '-25.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
    ];

    expect(cashflow({ entries, window: MARCH, granularity: 'month' })).toEqual([
      { period: '2026-03-01', income: '0.00', expense: '25.00', net: '-25.00' },
    ]);
  });

  it('applies the half-open window on both edges', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e-before',
        entryDate: '2026-02-28',
        amountSigned: '-99.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
      {
        entryId: 'e-start',
        entryDate: '2026-03-01', // == start → included
        amountSigned: '-10.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
      {
        entryId: 'e-end',
        entryDate: '2026-04-01', // == end → excluded
        amountSigned: '-20.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
    ];

    expect(cashflow({ entries, window: MARCH, granularity: 'day' })).toEqual([
      { period: '2026-03-01', income: '0.00', expense: '10.00', net: '-10.00' },
    ]);
  });
});
