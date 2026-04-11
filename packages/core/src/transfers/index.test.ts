import { describe, it, expect } from 'vitest';
import { detectTransferCandidates, type TransferDetectableEntry } from './index.ts';

const ACCOUNTS = ['acct-checking', 'acct-savings', 'acct-credit'];

function makeEntry(overrides: Partial<TransferDetectableEntry>): TransferDetectableEntry {
  return {
    entryId: 'e-1',
    amount: '100.0000',
    accountId: 'acct-checking',
    entryDate: '2026-03-15',
    description: 'Transfer',
    entryableType: 'transaction',
    ...overrides,
  };
}

describe('detectTransferCandidates', () => {
  it('exact match — same day, same amount, different accounts', () => {
    const entries = [
      makeEntry({ entryId: 'e-1', amount: '500.0000', accountId: 'acct-checking' }),
      makeEntry({ entryId: 'e-2', amount: '-500.0000', accountId: 'acct-savings' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.confidence).toBe(1.0);
    expect(candidates[0]!.entryAId).toBe('e-1');
    expect(candidates[0]!.entryBId).toBe('e-2');
  });

  it('exact amount + 1 day gap → confidence 0.9', () => {
    const entries = [
      makeEntry({ entryId: 'e-1', amount: '200.0000', accountId: 'acct-checking', entryDate: '2026-03-15' }),
      makeEntry({ entryId: 'e-2', amount: '-200.0000', accountId: 'acct-savings', entryDate: '2026-03-16' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.confidence).toBe(0.9);
  });

  it('near-amount match ($0.01 diff) → confidence 0.7', () => {
    const entries = [
      makeEntry({ entryId: 'e-1', amount: '100.0100', accountId: 'acct-checking' }),
      makeEntry({ entryId: 'e-2', amount: '-100.0000', accountId: 'acct-savings' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.confidence).toBe(0.7);
  });

  it('date window boundary — 3 days apart matches', () => {
    const entries = [
      makeEntry({ entryId: 'e-1', amount: '50.0000', accountId: 'acct-checking', entryDate: '2026-03-10' }),
      makeEntry({ entryId: 'e-2', amount: '-50.0000', accountId: 'acct-savings', entryDate: '2026-03-13' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.confidence).toBe(0.7); // 3-day gap
  });

  it('date window exceeded — 4 days apart does NOT match', () => {
    const entries = [
      makeEntry({ entryId: 'e-1', amount: '50.0000', accountId: 'acct-checking', entryDate: '2026-03-10' }),
      makeEntry({ entryId: 'e-2', amount: '-50.0000', accountId: 'acct-savings', entryDate: '2026-03-14' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    expect(candidates).toHaveLength(0);
  });

  it('same-account exclusion — entries on same account do NOT match', () => {
    const entries = [
      makeEntry({ entryId: 'e-1', amount: '100.0000', accountId: 'acct-checking' }),
      makeEntry({ entryId: 'e-2', amount: '-100.0000', accountId: 'acct-checking' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    expect(candidates).toHaveLength(0);
  });

  it('already-transfer exclusion — entries with entryableType=transfer skipped', () => {
    const entries = [
      makeEntry({ entryId: 'e-1', amount: '100.0000', accountId: 'acct-checking', entryableType: 'transfer' }),
      makeEntry({ entryId: 'e-2', amount: '-100.0000', accountId: 'acct-savings' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    expect(candidates).toHaveLength(0);
  });

  it('amount diff too large — $0.02 does NOT match', () => {
    const entries = [
      makeEntry({ entryId: 'e-1', amount: '100.0200', accountId: 'acct-checking' }),
      makeEntry({ entryId: 'e-2', amount: '-100.0000', accountId: 'acct-savings' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    expect(candidates).toHaveLength(0);
  });

  it('same-sign entries do NOT match', () => {
    const entries = [
      makeEntry({ entryId: 'e-1', amount: '100.0000', accountId: 'acct-checking' }),
      makeEntry({ entryId: 'e-2', amount: '100.0000', accountId: 'acct-savings' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    expect(candidates).toHaveLength(0);
  });

  it('entries on non-owned accounts are excluded', () => {
    const entries = [
      makeEntry({ entryId: 'e-1', amount: '100.0000', accountId: 'acct-checking' }),
      makeEntry({ entryId: 'e-2', amount: '-100.0000', accountId: 'acct-external' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    expect(candidates).toHaveLength(0);
  });

  it('multiple pairs — each entry used at most once', () => {
    const entries = [
      makeEntry({ entryId: 'e-1', amount: '100.0000', accountId: 'acct-checking' }),
      makeEntry({ entryId: 'e-2', amount: '-100.0000', accountId: 'acct-savings' }),
      makeEntry({ entryId: 'e-3', amount: '-100.0000', accountId: 'acct-credit' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    // e-1 pairs with e-2 (first match); e-3 has no partner
    expect(candidates).toHaveLength(1);
  });

  it('results sorted by confidence DESC', () => {
    const entries = [
      // Pair 1: exact + same day → 1.0
      makeEntry({ entryId: 'e-1', amount: '100.0000', accountId: 'acct-checking', entryDate: '2026-03-15' }),
      makeEntry({ entryId: 'e-2', amount: '-100.0000', accountId: 'acct-savings', entryDate: '2026-03-15' }),
      // Pair 2: exact + 3 days → 0.7
      makeEntry({ entryId: 'e-3', amount: '50.0000', accountId: 'acct-checking', entryDate: '2026-03-10' }),
      makeEntry({ entryId: 'e-4', amount: '-50.0000', accountId: 'acct-credit', entryDate: '2026-03-13' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.confidence).toBeGreaterThanOrEqual(candidates[1]!.confidence);
  });

  it('empty entries — returns empty', () => {
    expect(detectTransferCandidates([], ACCOUNTS)).toEqual([]);
  });

  it('zero-amount entries are not positive or negative — excluded naturally', () => {
    const entries = [
      makeEntry({ entryId: 'e-1', amount: '0.0000', accountId: 'acct-checking' }),
      makeEntry({ entryId: 'e-2', amount: '0.0000', accountId: 'acct-savings' }),
    ];
    const candidates = detectTransferCandidates(entries, ACCOUNTS);
    expect(candidates).toHaveLength(0);
  });
});
