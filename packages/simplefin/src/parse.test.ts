import Decimal from 'decimal.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ProtocolError } from './errors.ts';
import { parseAccountSet } from './parse.ts';

function loadFixture(name: string): unknown {
  const path = join(import.meta.dirname, 'fixtures', name);
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('parseAccountSet', () => {
  it('parses happy-path.json into 2 accounts with correct balances and tx counts', () => {
    const result = parseAccountSet(loadFixture('happy-path.json'));

    expect(result.accounts).toHaveLength(2);
    expect(result.connections).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.rateLimited).toBe(false);

    const checking = result.accounts[0]!;
    expect(checking.name).toBe('Chase Total Checking');
    expect(checking.balance).toBeInstanceOf(Decimal);
    expect(checking.balance.toFixed(4)).toBe('4523.7800');
    expect(checking.availableBalance).toBeInstanceOf(Decimal);
    expect(checking.transactions).toHaveLength(4);

    const cc = result.accounts[1]!;
    expect(cc.name).toBe('Chase Sapphire Preferred');
    expect(cc.balance.toFixed(4)).toBe('-1247.5600');
    expect(cc.transactions).toHaveLength(2);

    // Verify all amounts are Decimal instances
    for (const acct of result.accounts) {
      expect(acct.balance).toBeInstanceOf(Decimal);
      for (const tx of acct.transactions) {
        expect(tx.amount).toBeInstanceOf(Decimal);
      }
    }
  });

  it('round-trips "-42.10" through Decimal correctly', () => {
    const result = parseAccountSet(loadFixture('pending-to-posted-v1.json'));
    const tx = result.accounts[0]!.transactions[0]!;
    expect(tx.amount.toFixed(4)).toBe('-42.1000');
    expect(tx.pending).toBe(true);
  });

  it('parses errlist-reauth.json with errors.length === 1 and rateLimited === false', () => {
    const result = parseAccountSet(loadFixture('errlist-reauth.json'));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe('AUTH_EXPIRED');
    expect(result.errors[0]!.connId).toBe('conn_chase_001');
    expect(result.rateLimited).toBe(false);
    expect(result.accounts).toHaveLength(0);
  });

  it('parses rate-limit-warning.json with rateLimited === true', () => {
    const result = parseAccountSet(loadFixture('rate-limit-warning.json'));
    expect(result.rateLimited).toBe(true);
    expect(result.errors).toHaveLength(1);
    // Accounts are still populated even with the warning
    expect(result.accounts).toHaveLength(1);
  });

  it('throws ProtocolError on non-numeric amount', () => {
    const fixture = loadFixture('happy-path.json') as Record<string, unknown>;
    const accounts = (fixture.accounts as Array<Record<string, unknown>>);
    const txns = (accounts[0]!.transactions as Array<Record<string, unknown>>);
    txns[0]!.amount = 'banana';

    expect(() => parseAccountSet(fixture)).toThrow(ProtocolError);
    try {
      parseAccountSet(fixture);
    } catch (err) {
      expect((err as ProtocolError).message).toContain('banana');
    }
  });
});
