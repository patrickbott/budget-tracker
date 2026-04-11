import { describe, it, expect } from 'vitest';

import { netWorth } from './net-worth.ts';
import type { ReportAccountInput } from './types.ts';

describe('netWorth', () => {
  it('empty accounts → everything zero', () => {
    expect(netWorth({ accounts: [] })).toEqual({
      asset: '0.00',
      liability: '0.00',
      net: '0.00',
      byAccountType: {},
    });
  });

  it('only assets → liability "0.00", net = asset', () => {
    const accounts: ReportAccountInput[] = [
      { accountId: 'a1', accountType: 'depository', balance: '1500.0000' },
      { accountId: 'a2', accountType: 'investment', balance: '8500.0000' },
    ];

    expect(netWorth({ accounts })).toEqual({
      asset: '10000.00',
      liability: '0.00',
      net: '10000.00',
      byAccountType: {
        depository: '1500.00',
        investment: '8500.00',
      },
    });
  });

  it('only liabilities → asset "0.00", net negative, liability positive', () => {
    const accounts: ReportAccountInput[] = [
      // Liabilities stored as negative balances.
      { accountId: 'a1', accountType: 'credit_card', balance: '-1200.0000' },
      { accountId: 'a2', accountType: 'loan', balance: '-15000.0000' },
    ];

    expect(netWorth({ accounts })).toEqual({
      asset: '0.00',
      liability: '16200.00',
      net: '-16200.00',
      byAccountType: {
        // byAccountType preserves the signed total — still negative.
        credit_card: '-1200.00',
        loan: '-15000.00',
      },
    });
  });

  it('mixed assets and liabilities → net = asset − liability', () => {
    const accounts: ReportAccountInput[] = [
      { accountId: 'a1', accountType: 'depository', balance: '5000.0000' },
      { accountId: 'a2', accountType: 'credit_card', balance: '-800.0000' },
      { accountId: 'a3', accountType: 'property', balance: '250000.0000' },
      { accountId: 'a4', accountType: 'loan', balance: '-180000.0000' },
    ];

    expect(netWorth({ accounts })).toEqual({
      asset: '255000.00',
      liability: '180800.00',
      net: '74200.00',
      byAccountType: {
        depository: '5000.00',
        credit_card: '-800.00',
        property: '250000.00',
        loan: '-180000.00',
      },
    });
  });

  it('multiple accounts of the same type collapse into one byAccountType row', () => {
    const accounts: ReportAccountInput[] = [
      { accountId: 'a1', accountType: 'depository', balance: '1000.0000' },
      { accountId: 'a2', accountType: 'depository', balance: '2500.0000' },
      { accountId: 'a3', accountType: 'depository', balance: '750.0000' },
    ];

    const result = netWorth({ accounts });

    expect(result.byAccountType).toEqual({ depository: '4250.00' });
    expect(result.asset).toBe('4250.00');
    expect(result.net).toBe('4250.00');
  });

  it('flips negative liability balances to positive in the liability total', () => {
    // Two credit cards at -$500 and -$750 → liability = $1250
    const accounts: ReportAccountInput[] = [
      { accountId: 'a1', accountType: 'credit_card', balance: '-500.0000' },
      { accountId: 'a2', accountType: 'credit_card', balance: '-750.0000' },
      { accountId: 'a3', accountType: 'depository', balance: '2000.0000' },
    ];

    const result = netWorth({ accounts });

    expect(result.liability).toBe('1250.00');
    expect(result.asset).toBe('2000.00');
    expect(result.net).toBe('750.00');
    expect(result.byAccountType).toEqual({
      credit_card: '-1250.00',
      depository: '2000.00',
    });
  });
});
