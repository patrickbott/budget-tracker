/**
 * Tests for `validateEntryLines` — the double-entry invariant check.
 *
 * This is the earliest (and most important) piece of real logic in
 * `packages/core`: if an entry's lines don't sum to zero, the whole
 * reporting layer above it silently corrupts. These three tests pin the
 * contract now so every future refactor has to stay honest.
 */
import { describe, expect, test } from 'vitest';

import { validateEntryLines } from './index.ts';

describe('validateEntryLines', () => {
  test('accepts a balanced pair (+100 / -100)', () => {
    const result = validateEntryLines([
      { amount: '100.0000' },
      { amount: '-100.0000' },
    ]);
    expect(result).toEqual({ ok: true, sum: '0.0000' });
  });

  test('accepts a balanced split (+100 / -50 / -50)', () => {
    const result = validateEntryLines([
      { amount: '100.0000' },
      { amount: '-50.0000' },
      { amount: '-50.0000' },
    ]);
    expect(result).toEqual({ ok: true, sum: '0.0000' });
  });

  test('rejects a 0.0001 drift (+100.0000 / -99.9999)', () => {
    const result = validateEntryLines([
      { amount: '100.0000' },
      { amount: '-99.9999' },
    ]);
    expect(result).toEqual({ ok: false, sum: '0.0001' });
  });
});
