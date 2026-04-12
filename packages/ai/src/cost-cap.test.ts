import { describe, expect, it } from 'vitest';

import { checkSpendCap, estimateCost } from './cost-cap.ts';

describe('checkSpendCap', () => {
  it('allows with no warning when below 80%', () => {
    const result = checkSpendCap({ costUsd: '5.00' }, 10);

    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(false);
    expect(result.percentUsed).toBe(50);
    expect(result.message).toBeUndefined();
  });

  it('allows with no warning at 0% usage', () => {
    const result = checkSpendCap({ costUsd: '0.00' }, 10);

    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(false);
    expect(result.percentUsed).toBe(0);
  });

  it('allows with warning at exactly 80%', () => {
    const result = checkSpendCap({ costUsd: '8.00' }, 10);

    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(true);
    expect(result.percentUsed).toBe(80);
    expect(result.message).toContain('80%');
  });

  it('allows with warning between 80% and 100%', () => {
    const result = checkSpendCap({ costUsd: '9.50' }, 10);

    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(true);
    expect(result.percentUsed).toBe(95);
    expect(result.message).toContain('95%');
  });

  it('blocks at exactly 100%', () => {
    const result = checkSpendCap({ costUsd: '10.00' }, 10);

    expect(result.allowed).toBe(false);
    expect(result.warning).toBe(true);
    expect(result.percentUsed).toBe(100);
    expect(result.message).toContain('Monthly AI quota reached');
  });

  it('blocks when over 100%', () => {
    const result = checkSpendCap({ costUsd: '15.00' }, 10);

    expect(result.allowed).toBe(false);
    expect(result.warning).toBe(true);
    expect(result.percentUsed).toBe(150);
    expect(result.message).toContain('Monthly AI quota reached');
  });

  it('handles fractional percentages correctly', () => {
    const result = checkSpendCap({ costUsd: '7.99' }, 10);

    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(false);
    expect(result.percentUsed).toBe(79.9);
  });

  it('handles zero cap with zero usage as allowed', () => {
    const result = checkSpendCap({ costUsd: '0.00' }, 0);

    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(false);
    expect(result.percentUsed).toBe(0);
  });

  it('handles zero cap with non-zero usage as blocked', () => {
    const result = checkSpendCap({ costUsd: '0.01' }, 0);

    expect(result.allowed).toBe(false);
    expect(result.percentUsed).toBe(100);
  });

  it('uses decimal arithmetic (no floating-point drift)', () => {
    // 3.33 / 10 = 33.3% — would be 33.300000000000004 with float
    const result = checkSpendCap({ costUsd: '3.33' }, 10);

    expect(result.percentUsed).toBe(33.3);
  });
});

describe('estimateCost', () => {
  it('estimates Opus 4.6 cost correctly', () => {
    // 1000 input tokens at $15/M = $0.015
    // 500 output tokens at $75/M = $0.0375
    // Total: $0.0525
    const cost = estimateCost('claude-opus-4-6', 1000, 500);

    expect(cost).toBe('0.052500');
  });

  it('estimates Haiku 4.5 cost correctly', () => {
    // 1000 input tokens at $0.80/M = $0.0008
    // 500 output tokens at $4/M = $0.002
    // Total: $0.0028
    const cost = estimateCost('claude-haiku-4-5', 1000, 500);

    expect(cost).toBe('0.002800');
  });

  it('returns zero for zero tokens', () => {
    const cost = estimateCost('claude-opus-4-6', 0, 0);

    expect(cost).toBe('0.000000');
  });

  it('handles large token counts without floating-point drift', () => {
    // 1M input tokens at $15/M = $15
    // 100K output tokens at $75/M = $7.5
    // Total: $22.5
    const cost = estimateCost('claude-opus-4-6', 1_000_000, 100_000);

    expect(cost).toBe('22.500000');
  });

  it('throws for unknown model', () => {
    expect(() => estimateCost('claude-unknown-99', 100, 100)).toThrow(
      'Unknown model for cost estimation: claude-unknown-99',
    );
  });

  it('handles Haiku batch-scale costs accurately', () => {
    // Typical batch: 50K input, 1024 output
    // 50K * $0.80/M = $0.04
    // 1024 * $4/M = $0.004096
    // Total: $0.044096
    const cost = estimateCost('claude-haiku-4-5', 50_000, 1024);

    expect(cost).toBe('0.044096');
  });
});
