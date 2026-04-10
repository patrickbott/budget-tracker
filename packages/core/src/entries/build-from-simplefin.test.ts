import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  buildEntriesForSimpleFinTransactions,
  type BuildEntriesInput,
} from './build-from-simplefin.ts';

function makeTx(overrides: Partial<BuildEntriesInput['transactions'][number]> = {}) {
  return {
    simplefinId: 'txn_001',
    posted: new Date('2024-04-08T00:00:00Z'),
    amount: new Decimal('-42.99'),
    description: 'TRADER JOES #123',
    pending: false,
    ...overrides,
  };
}

const BASE_INPUT: Omit<BuildEntriesInput, 'transactions'> = {
  accountId: 'acct-uuid-001',
  simplefinAccountId: 'sfin_acct_001',
  familyId: 'family-uuid-001',
  uncategorizedCategoryId: 'cat-uncategorized-uuid',
};

describe('buildEntriesForSimpleFinTransactions', () => {
  it('negative amount on depository → 2 balanced lines with correct signs', () => {
    const result = buildEntriesForSimpleFinTransactions({
      ...BASE_INPUT,
      transactions: [makeTx({ amount: new Decimal('-42.99') })],
    });

    expect(result.built).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);

    const entry = result.built[0]!;
    expect(entry.lines).toHaveLength(2);

    // Account leg: negative (money leaving)
    const accountLeg = entry.lines.find((l) => l.accountId !== null)!;
    expect(accountLeg.amount).toBe('-42.9900');
    expect(accountLeg.categoryId).toBeNull();

    // Category leg: positive (money arriving at expense category)
    const categoryLeg = entry.lines.find((l) => l.categoryId !== null)!;
    expect(categoryLeg.amount).toBe('42.9900');
    expect(categoryLeg.accountId).toBeNull();

    // Sum = 0
    const sum = new Decimal(accountLeg.amount).plus(new Decimal(categoryLeg.amount));
    expect(sum.toFixed(4)).toBe('0.0000');
  });

  it('positive amount → signs flipped from negative case', () => {
    const result = buildEntriesForSimpleFinTransactions({
      ...BASE_INPUT,
      transactions: [makeTx({ amount: new Decimal('500.00') })],
    });

    expect(result.built).toHaveLength(1);
    const entry = result.built[0]!;

    const accountLeg = entry.lines.find((l) => l.accountId !== null)!;
    expect(accountLeg.amount).toBe('500.0000');

    const categoryLeg = entry.lines.find((l) => l.categoryId !== null)!;
    expect(categoryLeg.amount).toBe('-500.0000');

    const sum = new Decimal(accountLeg.amount).plus(new Decimal(categoryLeg.amount));
    expect(sum.toFixed(4)).toBe('0.0000');
  });

  it('mix of 3 transactions → 3 built entries, all balanced', () => {
    const result = buildEntriesForSimpleFinTransactions({
      ...BASE_INPUT,
      transactions: [
        makeTx({ simplefinId: 'txn_a', amount: new Decimal('-10.00') }),
        makeTx({ simplefinId: 'txn_b', amount: new Decimal('200.00') }),
        makeTx({ simplefinId: 'txn_c', amount: new Decimal('-0.50') }),
      ],
    });

    expect(result.built).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);

    for (const entry of result.built) {
      const sum = entry.lines.reduce(
        (acc, l) => acc.plus(new Decimal(l.amount)),
        new Decimal(0),
      );
      expect(sum.toFixed(4)).toBe('0.0000');
    }
  });

  it('zero-amount transaction → skipped', () => {
    const result = buildEntriesForSimpleFinTransactions({
      ...BASE_INPUT,
      transactions: [makeTx({ amount: new Decimal('0') })],
    });

    expect(result.built).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toBe('zero_amount');
  });

  it('4-decimal-place amount round-trips exactly', () => {
    const result = buildEntriesForSimpleFinTransactions({
      ...BASE_INPUT,
      transactions: [makeTx({ amount: new Decimal('12.3456') })],
    });

    expect(result.built).toHaveLength(1);
    const accountLeg = result.built[0]!.lines.find((l) => l.accountId !== null)!;
    expect(accountLeg.amount).toBe('12.3456');

    const categoryLeg = result.built[0]!.lines.find((l) => l.categoryId !== null)!;
    expect(categoryLeg.amount).toBe('-12.3456');
  });

  it('two txns with same description but different simplefinId → both built', () => {
    const result = buildEntriesForSimpleFinTransactions({
      ...BASE_INPUT,
      transactions: [
        makeTx({ simplefinId: 'txn_dup_1', description: 'STARBUCKS' }),
        makeTx({ simplefinId: 'txn_dup_2', description: 'STARBUCKS' }),
      ],
    });

    expect(result.built).toHaveLength(2);
    expect(result.built[0]!.dedupKey.externalId).toBe('txn_dup_1');
    expect(result.built[1]!.dedupKey.externalId).toBe('txn_dup_2');

    // Both use the correct simplefin account id
    expect(result.built[0]!.dedupKey.externalAccountId).toBe('sfin_acct_001');
  });
});
