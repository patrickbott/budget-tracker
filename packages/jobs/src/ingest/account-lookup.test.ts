import { describe, it, expect, vi } from 'vitest';
import Decimal from 'decimal.js';

// Mock drizzle-orm and db schema so we can test the logic without a database.
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ _eq: val })),
}));

vi.mock('@budget-tracker/db/schema', () => ({
  account: {
    id: 'account.id',
    simplefinAccountId: 'account.simplefin_account_id',
  },
}));

// We need to mock the tx object that Drizzle returns.
function makeMockTx(selectResult: Array<{ id: string }> = []) {
  const limitFn = vi.fn().mockResolvedValue(selectResult);
  const whereFn = vi.fn(() => ({ limit: limitFn }));
  const fromFn = vi.fn(() => ({ where: whereFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));

  const returningFn = vi.fn().mockResolvedValue([{ id: 'new-account-id' }]);
  const valuesFn = vi.fn(() => ({ returning: returningFn }));
  const insertFn = vi.fn(() => ({ values: valuesFn }));

  return {
    tx: { select: selectFn, insert: insertFn } as any,
    mocks: { selectFn, fromFn, whereFn, limitFn, insertFn, valuesFn, returningFn },
  };
}

describe('findAccountBySimpleFinId', () => {
  it('returns account id when found', async () => {
    const { findAccountBySimpleFinId } = await import('./account-lookup.ts');
    const { tx } = makeMockTx([{ id: 'existing-id' }]);

    const result = await findAccountBySimpleFinId(tx, 'sf_123');
    expect(result).toBe('existing-id');
  });

  it('returns null when not found', async () => {
    const { findAccountBySimpleFinId } = await import('./account-lookup.ts');
    const { tx } = makeMockTx([]);

    const result = await findAccountBySimpleFinId(tx, 'sf_unknown');
    expect(result).toBeNull();
  });
});

describe('findOrCreateAccountBySimpleFinId', () => {
  it('returns existing account id without inserting', async () => {
    const { findOrCreateAccountBySimpleFinId } = await import('./account-lookup.ts');
    const { tx, mocks } = makeMockTx([{ id: 'existing-id' }]);

    const result = await findOrCreateAccountBySimpleFinId(tx, {
      simplefinId: 'sf_123',
      name: 'Checking',
      currency: 'USD',
      balance: new Decimal('1500.50'),
      balanceDate: new Date('2026-04-10'),
      familyId: 'family-1',
      connectionId: 'conn-1',
    });

    expect(result).toBe('existing-id');
    expect(mocks.insertFn).not.toHaveBeenCalled();
  });

  it('auto-creates account when not found', async () => {
    const { findOrCreateAccountBySimpleFinId } = await import('./account-lookup.ts');
    const { tx, mocks } = makeMockTx([]);

    const result = await findOrCreateAccountBySimpleFinId(tx, {
      simplefinId: 'sf_new',
      name: 'Savings',
      currency: 'USD',
      balance: new Decimal('5000.1234'),
      balanceDate: new Date('2026-04-10'),
      familyId: 'family-1',
      connectionId: 'conn-1',
    });

    expect(result).toBe('new-account-id');
    expect(mocks.insertFn).toHaveBeenCalled();

    // Verify the inserted values contain the correct balance as a fixed-4 string.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertedValues = (mocks.valuesFn.mock.calls as any)[0]?.[0] as Record<string, unknown>;
    expect(insertedValues).toBeDefined();
    expect(insertedValues.balance).toBe('5000.1234');
    expect(insertedValues.accountType).toBe('depository');
    expect(insertedValues.isManual).toBe(false);
    expect(insertedValues.visibility).toBe('household');
    expect(insertedValues.simplefinAccountId).toBe('sf_new');
    expect(insertedValues.connectionId).toBe('conn-1');
    expect(insertedValues.familyId).toBe('family-1');
  });
});
