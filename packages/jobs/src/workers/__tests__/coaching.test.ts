import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * Unit tests for the coaching alert cron worker.
 *
 * Mocks: Anthropic SDK, drizzle-orm, DB schema, DB client, AI exports,
 * tool-loaders factory.
 * Exercises: happy path, dedup, cost-cap, expired alert cleanup,
 * empty data, empty Haiku response, malformed JSON.
 */

// --- Module mocks ---

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ _eq: val })),
  and: vi.fn((...clauses) => ({ _and: clauses })),
  lt: vi.fn((_col, val) => ({ _lt: val })),
  gte: vi.fn((_col, val) => ({ _gte: val })),
  sql: Object.assign(
    vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => ({
      as: vi.fn(() => ({ _alias: true })),
    })),
    { raw: vi.fn((str: string) => ({ _raw: str })) },
  ),
}));

vi.mock('@budget-tracker/db/schema', () => ({
  aiUsage: {
    familyId: 'u.fid',
    date: 'u.d',
    model: 'u.m',
    costUsd: 'u.c',
    inputTokens: 'u.it',
    outputTokens: 'u.ot',
  },
  family: { id: 'f.id' },
  coachingAlert: {
    id: 'ca.id',
    familyId: 'ca.fid',
    dismissed: 'ca.dismissed',
    generatedAt: 'ca.generatedAt',
    expiresAt: 'ca.expiresAt',
  },
}));

const mockMessagesCreate = vi.fn();
let _mockDb: any;

vi.mock('@budget-tracker/db/client', () => ({
  createDb: vi.fn(() => ({ db: _mockDb, sql: {} })),
}));

vi.mock('@budget-tracker/ai', () => ({
  checkSpendCap: vi.fn(() => ({
    allowed: true,
    percentUsed: 0,
    warning: false,
  })),
  createAnthropicClient: vi.fn(() => ({
    messages: { create: mockMessagesCreate },
  })),
  estimateCost: vi.fn(() => '0.000100'),
}));

const mockLoadBudgetStatus = vi.fn(async () => [
  {
    categoryName: 'Dining',
    budgetMode: 'hard_cap',
    budgetAmount: '300.0000',
    actualSpend: '280.0000',
  },
]);
const mockLoadRecurringStatus = vi.fn(async () => [
  {
    title: 'Netflix',
    amount: '15.99',
    cadence: 'monthly',
    lastSeenDate: '2026-03-15',
    nextExpectedDate: '2026-04-15',
    missingDates: null,
  },
]);

vi.mock('../../lib/tool-loaders.ts', () => ({
  createToolLoadersForJob: vi.fn(() => ({
    loadBudgetStatus: mockLoadBudgetStatus,
    loadRecurringStatus: mockLoadRecurringStatus,
  })),
}));

// --- Helpers ---

const FAMILY_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Create a mock db that handles:
 * 1. First transaction: family discovery
 * 2. Subsequent transactions: per-family coaching alert generation
 *    - execute (bypass RLS)
 *    - delete (expired alerts)
 *    - select (dedup check)
 *    - select (usage query)
 *    - insert (coaching_alert rows)
 *    - insert (ai_usage upsert)
 */
function makeMockDb(opts: {
  families: Array<{ id: string }>;
  /** Per-family sequence of select() results for the coaching transaction */
  perFamilySelectResults: Record<string, unknown[][]>;
  onAlertInsert?: (vals: unknown) => void;
}) {
  let txCount = 0;

  return {
    transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
      txCount++;

      if (txCount === 1) {
        // Family discovery transaction
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn(() => ({
            from: vi.fn(async () => opts.families),
          })),
        };
        return fn(tx);
      }

      // Per-family coaching transaction
      const famId = opts.families[txCount - 2]?.id ?? FAMILY_ID;
      const selectResults = opts.perFamilySelectResults[famId] ?? [];
      let selectIdx = 0;

      const onConflict = vi.fn().mockResolvedValue(undefined);
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn((..._args: unknown[]) => ({
              limit: vi.fn(async () => selectResults[selectIdx++] ?? []),
            })),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn((vals: unknown) => {
            opts.onAlertInsert?.(vals);
            return { onConflictDoUpdate: onConflict };
          }),
        })),
      };
      return fn(tx);
    }),
  };
}

function makeHaikuResponse(alerts: unknown[]) {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(alerts) }],
    usage: { input_tokens: 400, output_tokens: 100 },
  };
}

describe('generateCoachingAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.DATABASE_URL = 'postgres://test@localhost/test';
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('generates alerts and inserts coaching_alert rows on happy path', async () => {
    const alertInserts: unknown[] = [];

    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilySelectResults: {
        [FAMILY_ID]: [
          [],                           // dedup: no existing alerts today
          [{ totalCost: '1.000000' }],  // usage query
        ],
      },
      onAlertInsert: (v) => alertInserts.push(v),
    });

    mockMessagesCreate.mockResolvedValueOnce(
      makeHaikuResponse([
        {
          type: 'budget_pace',
          severity: 'warning',
          title: 'Dining budget on pace to exceed by $80',
          body: 'You have spent $280 of your $300 dining budget with 18 days remaining.',
        },
      ]),
    );

    const { generateCoachingAlerts } = await import('../coaching.ts');
    const result = await generateCoachingAlerts();

    expect(result.familiesProcessed).toBe(1);
    expect(result.familiesSkipped).toBe(0);
    expect(result.alertsGenerated).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);

    // Alert row inserted
    const alertRow = alertInserts.find(
      (v: any) => v.alertType === 'budget_pace',
    );
    expect(alertRow).toBeTruthy();
    expect((alertRow as any).title).toContain('Dining');
  });

  it('skips families that already have alerts today (dedup)', async () => {
    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilySelectResults: {
        [FAMILY_ID]: [
          [{ id: 'existing-alert' }], // dedup: already exists today
        ],
      },
    });

    const { generateCoachingAlerts } = await import('../coaching.ts');
    const result = await generateCoachingAlerts();

    expect(result.familiesProcessed).toBe(0);
    expect(result.familiesSkipped).toBe(1);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('skips families over cost cap', async () => {
    const { checkSpendCap } = await import('@budget-tracker/ai');

    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilySelectResults: {
        [FAMILY_ID]: [
          [],                             // dedup: none
          [{ totalCost: '10.000000' }],   // usage: at cap
        ],
      },
    });

    (checkSpendCap as Mock).mockReturnValueOnce({
      allowed: false,
      percentUsed: 100,
      warning: true,
    });

    const { generateCoachingAlerts } = await import('../coaching.ts');
    const result = await generateCoachingAlerts();

    expect(result.familiesProcessed).toBe(0);
    expect(result.familiesSkipped).toBe(1);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('deletes expired alerts before generating new ones', async () => {
    let deleteWhereCalled = false;

    _mockDb = {
      transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
        if (!deleteWhereCalled) {
          // First call: family discovery
          deleteWhereCalled = true;
          const tx = {
            execute: vi.fn().mockResolvedValue(undefined),
            select: vi.fn(() => ({
              from: vi.fn(async () => [{ id: FAMILY_ID }]),
            })),
          };
          return fn(tx);
        }

        // Second call: per-family
        const deleteMock = vi.fn().mockResolvedValue(undefined);
        const onConflict = vi.fn().mockResolvedValue(undefined);
        let selectIdx = 0;
        const selectResults = [
          [],                           // dedup
          [{ totalCost: '0.000000' }],  // usage
        ];

        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn(() => ({
            where: deleteMock,
          })),
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn(async () => selectResults[selectIdx++] ?? []),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            values: vi.fn(() => ({ onConflictDoUpdate: onConflict })),
          })),
        };

        const result = await fn(tx);
        // Verify delete was called (expired alert cleanup)
        expect(deleteMock).toHaveBeenCalled();
        return result;
      }),
    };

    mockMessagesCreate.mockResolvedValueOnce(makeHaikuResponse([]));

    const { generateCoachingAlerts } = await import('../coaching.ts');
    await generateCoachingAlerts();
  });

  it('handles Haiku returning an empty array (no alerts needed)', async () => {
    const alertInserts: unknown[] = [];

    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilySelectResults: {
        [FAMILY_ID]: [
          [],
          [{ totalCost: '1.000000' }],
        ],
      },
      onAlertInsert: (v) => alertInserts.push(v),
    });

    mockMessagesCreate.mockResolvedValueOnce(makeHaikuResponse([]));

    const { generateCoachingAlerts } = await import('../coaching.ts');
    const result = await generateCoachingAlerts();

    expect(result.familiesProcessed).toBe(1);
    expect(result.alertsGenerated).toBe(0);
    // Only the ai_usage upsert, no coaching_alert inserts
    const coachingInserts = alertInserts.filter(
      (v: any) => v.alertType !== undefined,
    );
    expect(coachingInserts).toHaveLength(0);
  });

  it('handles Haiku returning malformed JSON gracefully', async () => {
    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilySelectResults: {
        [FAMILY_ID]: [
          [],
          [{ totalCost: '1.000000' }],
        ],
      },
    });

    mockMessagesCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I am not valid JSON {{{' }],
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    const { generateCoachingAlerts } = await import('../coaching.ts');
    const result = await generateCoachingAlerts();

    // Should not crash — processes the family but generates 0 alerts
    expect(result.familiesProcessed).toBe(1);
    expect(result.alertsGenerated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('returns empty results when no budgets or recurring items exist', async () => {
    // Override ToolLoaders to return empty data
    mockLoadBudgetStatus.mockResolvedValueOnce([]);
    mockLoadRecurringStatus.mockResolvedValueOnce([]);

    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilySelectResults: {
        [FAMILY_ID]: [
          [],                           // dedup
          [{ totalCost: '0.000000' }],  // usage
        ],
      },
    });

    const { generateCoachingAlerts } = await import('../coaching.ts');
    const result = await generateCoachingAlerts();

    // Should skip the family since there's nothing to analyze
    expect(result.familiesSkipped).toBe(1);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});
