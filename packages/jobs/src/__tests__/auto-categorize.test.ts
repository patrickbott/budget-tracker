import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * Unit tests for the auto-categorize worker.
 *
 * Mocks: Anthropic SDK, drizzle-orm, DB schema, DB client, AI exports.
 * Exercises: happy path, cost-cap block, empty inputs, API errors,
 * low-confidence skipping, batch splitting.
 */

// --- Module mocks ---

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ _eq: val })),
  and: vi.fn((...clauses) => ({ _and: clauses })),
  inArray: vi.fn((_col, values) => ({ _inArray: values })),
  isNull: vi.fn((_col) => ({ _isNull: true })),
  sql: Object.assign(
    vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => ({
      as: vi.fn(() => ({ _alias: true })),
    })),
    { raw: vi.fn((str: string) => ({ _raw: str })) },
  ),
}));

vi.mock('@budget-tracker/db/schema', () => ({
  aiUsage: { familyId: 'u.fid', date: 'u.d', model: 'u.m', costUsd: 'u.c', inputTokens: 'u.it', outputTokens: 'u.ot' },
  category: { id: 'c.id', name: 'c.n', familyId: 'c.fid', isArchived: 'c.a' },
  entry: { id: 'e.id', description: 'e.desc', entryDate: 'e.dt', familyId: 'e.fid' },
  entryLine: { entryId: 'el.eid', accountId: 'el.aid', categoryId: 'el.cid', amount: 'el.amt' },
  account: { id: 'a.id', name: 'a.n' },
  rule: { id: 'r.id', familyId: 'r.fid' },
}));

const mockMessagesCreate = vi.fn();
let _mockDb: any;

vi.mock('@budget-tracker/db/client', () => ({
  createDb: vi.fn(() => ({ db: _mockDb, sql: {} })),
}));

vi.mock('@budget-tracker/ai', () => ({
  checkSpendCap: vi.fn(() => ({ allowed: true, percentUsed: 0, warning: false })),
  createAnthropicClient: vi.fn(() => ({ messages: { create: mockMessagesCreate } })),
  estimateCost: vi.fn(() => '0.000100'),
}));

// --- Helpers ---

const FAMILY = '00000000-0000-0000-0000-000000000001';
const ENTRY1 = '00000000-0000-0000-0000-000000000010';
const CAT1 = '00000000-0000-0000-0000-000000000020';

function makeMockDb(opts: {
  selectResults: unknown[][];
  onUpdate?: () => void;
  onInsert?: (vals: unknown) => void;
}) {
  let idx = 0;
  const pop = async () => opts.selectResults[idx++] ?? [];

  return {
    transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(pop),
            innerJoin: vi.fn(() => ({
              leftJoin: vi.fn(() => ({ where: vi.fn(pop) })),
            })),
          })),
        })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(async () => { opts.onUpdate?.(); }),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn((vals: unknown) => {
            opts.onInsert?.(vals);
            return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
          }),
        })),
      };
      return fn(tx);
    }),
  };
}

function makeToolUseResponse(assignments: unknown[]) {
  return {
    content: [{ type: 'tool_use', id: 't1', name: 'categorize_transactions', input: { assignments } }],
    usage: { input_tokens: 500, output_tokens: 100 },
  };
}

describe('autoCategorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.DATABASE_URL = 'postgres://test@localhost/test';
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('returns zeros for empty entryIds without DB or API calls', async () => {
    const { autoCategorize } = await import('../workers/auto-categorize.ts');
    const result = await autoCategorize({ familyId: FAMILY, entryIds: [] });

    expect(result).toEqual({ categorized: 0, rulesProposed: 0, skippedLowConfidence: 0 });
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('exits early when cost cap is reached', async () => {
    const { checkSpendCap } = await import('@budget-tracker/ai');
    (checkSpendCap as Mock).mockReturnValueOnce({ allowed: false, percentUsed: 100, warning: true });

    _mockDb = makeMockDb({
      selectResults: [[{ totalCost: '10.000000' }]],
    });

    const { autoCategorize } = await import('../workers/auto-categorize.ts');
    const result = await autoCategorize({ familyId: FAMILY, entryIds: [ENTRY1] });

    expect(result).toEqual({ categorized: 0, rulesProposed: 0, skippedLowConfidence: 0 });
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('categorizes entries and creates induced rules on happy path', async () => {
    let updateCount = 0;
    const ruleInserts: unknown[] = [];

    _mockDb = makeMockDb({
      selectResults: [
        [{ totalCost: '1.000000' }],
        [{ entryId: ENTRY1, description: 'STARBUCKS', entryDate: new Date('2026-04-10'), amount: '-5.50', accountName: 'Checking' }],
        [{ id: CAT1, name: 'Coffee' }],
      ],
      onUpdate: () => { updateCount++; },
      onInsert: (v) => { ruleInserts.push(v); },
    });

    mockMessagesCreate.mockResolvedValueOnce(makeToolUseResponse([{
      entryId: ENTRY1,
      categoryId: CAT1,
      confidence: 'high',
      ruleSuggestion: {
        merchantPattern: 'STARBUCKS',
        conditions: [{ field: 'description', operator: 'contains', value: 'STARBUCKS' }],
      },
    }]));

    const { autoCategorize } = await import('../workers/auto-categorize.ts');
    const result = await autoCategorize({ familyId: FAMILY, entryIds: [ENTRY1] });

    expect(result.categorized).toBe(1);
    expect(result.rulesProposed).toBe(1);
    expect(result.skippedLowConfidence).toBe(0);
    expect(updateCount).toBe(1);
    // Rule insert: one for the rule itself, one for ai_usage upsert
    const ruleInsert = ruleInserts.find((v: any) => v.createdFrom === 'induced');
    expect(ruleInsert).toBeTruthy();
    expect((ruleInsert as any).enabled).toBe(false);
    expect(mockMessagesCreate).toHaveBeenCalledOnce();
  });

  it('skips low-confidence assignments', async () => {
    _mockDb = makeMockDb({
      selectResults: [
        [{ totalCost: '0.500000' }],
        [{ entryId: ENTRY1, description: 'MISC', entryDate: new Date('2026-04-10'), amount: '-25.00', accountName: 'Checking' }],
        [{ id: CAT1, name: 'Other' }],
      ],
    });

    mockMessagesCreate.mockResolvedValueOnce(makeToolUseResponse([
      { entryId: ENTRY1, categoryId: CAT1, confidence: 'low' },
    ]));

    const { autoCategorize } = await import('../workers/auto-categorize.ts');
    const result = await autoCategorize({ familyId: FAMILY, entryIds: [ENTRY1] });

    expect(result.categorized).toBe(0);
    expect(result.skippedLowConfidence).toBe(1);
  });

  it('handles Anthropic API errors gracefully without throwing', async () => {
    _mockDb = makeMockDb({
      selectResults: [
        [{ totalCost: '0.500000' }],
        [{ entryId: ENTRY1, description: 'STARBUCKS', entryDate: new Date('2026-04-10'), amount: '-5.50', accountName: 'Checking' }],
        [{ id: CAT1, name: 'Coffee' }],
      ],
    });

    mockMessagesCreate.mockRejectedValueOnce(new Error('API rate limit'));

    const { autoCategorize } = await import('../workers/auto-categorize.ts');
    const result = await autoCategorize({ familyId: FAMILY, entryIds: [ENTRY1] });

    expect(result.categorized).toBe(0);
    expect(result.rulesProposed).toBe(0);
  });

  it('splits >20 entries into multiple API calls', async () => {
    const ids = Array.from({ length: 25 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );

    _mockDb = makeMockDb({
      selectResults: [
        [{ totalCost: '0.500000' }],
        ids.map((id) => ({
          entryId: id, description: `Txn ${id}`, entryDate: new Date('2026-04-10'),
          amount: '-10.00', accountName: 'Checking',
        })),
        [{ id: CAT1, name: 'Misc' }],
      ],
    });

    mockMessagesCreate.mockResolvedValue(makeToolUseResponse([]));

    const { autoCategorize } = await import('../workers/auto-categorize.ts');
    await autoCategorize({ familyId: FAMILY, entryIds: ids });

    // 25 entries / 20 batch size = 2 API calls
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });

  it('returns zeros when no entries found in DB', async () => {
    _mockDb = makeMockDb({
      selectResults: [
        [{ totalCost: '0.500000' }],
        [], // no entries
      ],
    });

    const { autoCategorize } = await import('../workers/auto-categorize.ts');
    const result = await autoCategorize({ familyId: FAMILY, entryIds: [ENTRY1] });

    expect(result).toEqual({ categorized: 0, rulesProposed: 0, skippedLowConfidence: 0 });
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});
