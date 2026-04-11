import { describe, it, expect } from 'vitest';

import { spendingByCategory } from './spending-by-category.ts';
import type { ReportEntryInput, ReportWindow } from './types.ts';

const WINDOW: ReportWindow = { start: '2026-03-01', end: '2026-04-01' };

describe('spendingByCategory', () => {
  it('returns an empty list for an empty input', () => {
    expect(spendingByCategory({ entries: [], window: WINDOW })).toEqual([]);
  });

  it('excludes transfers entirely', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-10',
        amountSigned: '-100.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: true,
      },
      {
        entryId: 'e2',
        entryDate: '2026-03-12',
        amountSigned: '-50.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: true,
      },
    ];

    expect(spendingByCategory({ entries, window: WINDOW })).toEqual([]);
  });

  it('sums all entries in a single category into one row', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-05',
        amountSigned: '-45.2500',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
      {
        entryId: 'e2',
        entryDate: '2026-03-18',
        amountSigned: '-30.7500',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
      {
        entryId: 'e3',
        entryDate: '2026-03-27',
        amountSigned: '-24.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
    ];

    expect(spendingByCategory({ entries, window: WINDOW })).toEqual([
      { categoryId: 'cat-groceries', total: '100.00' },
    ]);
  });

  it('sorts multiple categories by total DESC', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-02',
        amountSigned: '-20.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-coffee',
        isTransfer: false,
      },
      {
        entryId: 'e2',
        entryDate: '2026-03-10',
        amountSigned: '-300.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-rent',
        isTransfer: false,
      },
      {
        entryId: 'e3',
        entryDate: '2026-03-15',
        amountSigned: '-80.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
    ];

    expect(spendingByCategory({ entries, window: WINDOW })).toEqual([
      { categoryId: 'cat-rent', total: '300.00' },
      { categoryId: 'cat-dining', total: '80.00' },
      { categoryId: 'cat-coffee', total: '20.00' },
    ]);
  });

  it('only counts outflows when a category has both inflow and outflow', () => {
    // e.g. a refund lands in the same category as the original purchase —
    // the refund is a positive leg and must NOT reduce the "spent" total
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-05',
        amountSigned: '-100.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-shopping',
        isTransfer: false,
      },
      {
        entryId: 'e2',
        entryDate: '2026-03-12',
        amountSigned: '25.0000', // refund
        accountId: 'acc-checking',
        categoryId: 'cat-shopping',
        isTransfer: false,
      },
      {
        entryId: 'e3',
        entryDate: '2026-03-20',
        amountSigned: '-40.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-shopping',
        isTransfer: false,
      },
    ];

    expect(spendingByCategory({ entries, window: WINDOW })).toEqual([
      { categoryId: 'cat-shopping', total: '140.00' },
    ]);
  });

  it('excludes entries outside the window', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-02-20', // before
        amountSigned: '-500.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
      {
        entryId: 'e2',
        entryDate: '2026-04-15', // after
        amountSigned: '-500.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
      {
        entryId: 'e3',
        entryDate: '2026-03-15', // inside
        amountSigned: '-75.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
    ];

    expect(spendingByCategory({ entries, window: WINDOW })).toEqual([
      { categoryId: 'cat-groceries', total: '75.00' },
    ]);
  });

  it('excludes entries whose date equals window.end (half-open)', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-04-01', // == end → excluded
        amountSigned: '-99.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
    ];

    expect(spendingByCategory({ entries, window: WINDOW })).toEqual([]);
  });

  it('includes entries whose date equals window.start (half-open)', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-01', // == start → included
        amountSigned: '-42.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-groceries',
        isTransfer: false,
      },
    ];

    expect(spendingByCategory({ entries, window: WINDOW })).toEqual([
      { categoryId: 'cat-groceries', total: '42.00' },
    ]);
  });

  it('excludes entries with a null categoryId', () => {
    const entries: ReportEntryInput[] = [
      {
        entryId: 'e1',
        entryDate: '2026-03-10',
        amountSigned: '-50.0000',
        accountId: 'acc-checking',
        categoryId: null,
        isTransfer: false,
      },
      {
        entryId: 'e2',
        entryDate: '2026-03-11',
        amountSigned: '-10.0000',
        accountId: 'acc-checking',
        categoryId: 'cat-dining',
        isTransfer: false,
      },
    ];

    expect(spendingByCategory({ entries, window: WINDOW })).toEqual([
      { categoryId: 'cat-dining', total: '10.00' },
    ]);
  });
});
