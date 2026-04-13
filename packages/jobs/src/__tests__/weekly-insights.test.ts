import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * Unit tests for the weekly-insights cron worker.
 *
 * Mocks: Anthropic SDK, drizzle-orm, DB schema, DB client, AI exports,
 * tool-loaders factory.
 * Exercises: happy path with tool-use loop, dedup detection, cost-cap
 * block, API errors, empty family.
 */

// --- Module mocks ---

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ _eq: val })),
  and: vi.fn((...clauses) => ({ _and: clauses })),
  sql: Object.assign(
    vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => ({
      as: vi.fn(() => ({ _alias: true })),
    })),
    { raw: vi.fn((str: string) => ({ _raw: str })) },
  ),
}));

vi.mock('@budget-tracker/db/schema', () => ({
  aiUsage: { familyId: 'u.fid', date: 'u.d', model: 'u.m', costUsd: 'u.c', inputTokens: 'u.it', outputTokens: 'u.ot' },
  family: { id: 'f.id' },
  insight: { id: 'i.id', familyId: 'i.fid', period: 'i.p', periodStart: 'i.ps', emailedAt: 'i.ea' },
  membership: { userId: 'm.uid', organizationId: 'm.oid' },
  user: { id: 'usr.id', email: 'usr.email' },
}));

const mockMessagesCreate = vi.fn();
let _mockDb: any;

vi.mock('@budget-tracker/db/client', () => ({
  createDb: vi.fn(() => ({ db: _mockDb, sql: {} })),
}));

vi.mock('@budget-tracker/ai', () => ({
  checkSpendCap: vi.fn(() => ({ allowed: true, percentUsed: 0, warning: false })),
  createAnthropicClient: vi.fn(() => ({ messages: { create: mockMessagesCreate } })),
  estimateCost: vi.fn(() => '0.000200'),
  TOOL_REGISTRY: {
    get_spending_by_category: {
      description: 'test',
      inputSchema: { _def: {} },
      handler: vi.fn(async () => ({ rows: [] })),
    },
  },
  toAnthropicToolDefinitions: vi.fn(() => [
    { name: 'get_spending_by_category', description: 'test', input_schema: { type: 'object', properties: {} } },
  ]),
}));

vi.mock('../lib/tool-loaders.ts', () => ({
  createToolLoadersForJob: vi.fn(() => ({})),
}));

const mockSendInsightEmail = vi.fn();
vi.mock('../lib/email.ts', () => ({
  sendInsightEmail: (...args: unknown[]) => mockSendInsightEmail(...args),
}));

// --- Helpers ---

const FAMILY_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Create a mock db with separate transactions:
 * - first transaction: family discovery (returns families)
 * - subsequent transactions: per-family insight generation
 */
function makeMockDb(opts: {
  families: Array<{ id: string }>;
  perFamilyResults: Record<string, unknown[][]>;
  memberEmails?: string[];
  onInsight?: (vals: unknown) => void;
  onUpdate?: (set: unknown) => void;
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

      // Per-family insight transaction
      const famId = opts.families[txCount - 2]?.id ?? FAMILY_ID;
      const results = opts.perFamilyResults[famId] ?? [];
      let idx = 0;
      const pop = async () => results[idx++] ?? [];

      const emails = (opts.memberEmails ?? []).map((e) => ({ email: e }));

      const onConflict = vi.fn().mockResolvedValue(undefined);
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            // Standard pattern: .from().where().limit() (dedup, usage)
            where: vi.fn((..._args: unknown[]) => ({
              limit: vi.fn(pop),
            })),
            // Membership join pattern: .from(membership).innerJoin().where()
            innerJoin: vi.fn(() => ({
              where: vi.fn(async () => emails),
            })),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn((vals: unknown) => {
            opts.onInsight?.(vals);
            return {
              returning: vi.fn(() => [{ id: 'mock-insight-id' }]),
              onConflictDoUpdate: onConflict,
            };
          }),
        })),
        update: vi.fn(() => ({
          set: vi.fn((setVals: unknown) => {
            opts.onUpdate?.(setVals);
            return {
              where: vi.fn().mockResolvedValue(undefined),
            };
          }),
        })),
      };
      return fn(tx);
    }),
  };
}

describe('generateWeeklyInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.DATABASE_URL = 'postgres://test@localhost/test';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockSendInsightEmail.mockResolvedValue({ sent: false, error: 'RESEND_API_KEY not configured' });
  });

  it('generates a report and inserts an insight row on happy path', async () => {
    const insightInserts: unknown[] = [];

    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilyResults: {
        [FAMILY_ID]: [
          [],                           // dedup check: no existing insight
          [{ totalCost: '1.000000' }],  // usage query
        ],
      },
      onInsight: (v) => insightInserts.push(v),
    });

    // First call: tool_use response (model calls a tool)
    mockMessagesCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tu1',
          name: 'get_spending_by_category',
          input: { start: '2026-04-06', end: '2026-04-13' },
        },
      ],
      usage: { input_tokens: 300, output_tokens: 80 },
    });

    // Second call: final text response
    mockMessagesCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '## Weekly Report\n\nSpending was modest this week.' }],
      usage: { input_tokens: 500, output_tokens: 200 },
    });

    const { generateWeeklyInsights } = await import('../workers/weekly-insights.ts');
    const result = await generateWeeklyInsights();

    expect(result.familiesProcessed).toBe(1);
    expect(result.familiesSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);

    // Insight row inserted
    const insightRow = insightInserts.find(
      (v: any) => v.period === 'weekly',
    );
    expect(insightRow).toBeTruthy();
    expect((insightRow as any).markdownBody).toContain('Weekly Report');
  });

  it('skips family when insight already exists for the period (dedup)', async () => {
    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilyResults: {
        [FAMILY_ID]: [
          [{ id: 'existing-insight' }], // dedup: already exists
        ],
      },
    });

    const { generateWeeklyInsights } = await import('../workers/weekly-insights.ts');
    const result = await generateWeeklyInsights();

    expect(result.familiesProcessed).toBe(0);
    expect(result.familiesSkipped).toBe(1);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('skips family when cost cap is reached', async () => {
    const { checkSpendCap } = await import('@budget-tracker/ai');

    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilyResults: {
        [FAMILY_ID]: [
          [],                             // dedup: no existing
          [{ totalCost: '10.000000' }],   // usage query
        ],
      },
    });

    // First call to checkSpendCap returns blocked
    (checkSpendCap as Mock).mockReturnValueOnce({
      allowed: false,
      percentUsed: 100,
      warning: true,
    });

    const { generateWeeklyInsights } = await import('../workers/weekly-insights.ts');
    const result = await generateWeeklyInsights();

    expect(result.familiesProcessed).toBe(0);
    expect(result.familiesSkipped).toBe(1);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('handles API errors and reports them without crashing', async () => {
    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilyResults: {
        [FAMILY_ID]: [
          [],
          [{ totalCost: '1.000000' }],
        ],
      },
    });

    mockMessagesCreate.mockRejectedValueOnce(new Error('Service unavailable'));

    const { generateWeeklyInsights } = await import('../workers/weekly-insights.ts');
    const result = await generateWeeklyInsights();

    expect(result.familiesProcessed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Service unavailable');
  });

  it('processes no families when DB is empty', async () => {
    _mockDb = makeMockDb({
      families: [],
      perFamilyResults: {},
    });

    const { generateWeeklyInsights } = await import('../workers/weekly-insights.ts');
    const result = await generateWeeklyInsights();

    expect(result.familiesProcessed).toBe(0);
    expect(result.familiesSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('generates fallback text when model returns no text blocks', async () => {
    const insightInserts: unknown[] = [];

    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilyResults: {
        [FAMILY_ID]: [
          [],
          [{ totalCost: '1.000000' }],
        ],
      },
      onInsight: (v) => insightInserts.push(v),
    });

    // Model returns only tool_use, no text
    mockMessagesCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [],
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    const { generateWeeklyInsights } = await import('../workers/weekly-insights.ts');
    const result = await generateWeeklyInsights();

    expect(result.familiesProcessed).toBe(1);
    const row = insightInserts.find((v: any) => v.period === 'weekly') as any;
    expect(row.markdownBody).toBe('_No activity this week._');
  });

  it('sends email after insight is saved when members exist', async () => {
    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilyResults: {
        [FAMILY_ID]: [
          [],
          [{ totalCost: '1.000000' }],
        ],
      },
      memberEmails: ['alice@example.com', 'bob@example.com'],
    });

    mockSendInsightEmail.mockResolvedValueOnce({ sent: true, messageId: 'msg-test' });

    mockMessagesCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '## Report\n\nAll good.' }],
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    const { generateWeeklyInsights } = await import('../workers/weekly-insights.ts');
    const result = await generateWeeklyInsights();

    expect(result.familiesProcessed).toBe(1);
    expect(result.emailsSent).toBe(1);
    expect(result.emailsFailed).toBe(0);
    expect(mockSendInsightEmail).toHaveBeenCalledOnce();
    expect(mockSendInsightEmail.mock.calls[0]![0].to).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('sets emailedAt on insight row when email succeeds', async () => {
    const updates: unknown[] = [];

    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilyResults: {
        [FAMILY_ID]: [
          [],
          [{ totalCost: '1.000000' }],
        ],
      },
      memberEmails: ['test@example.com'],
      onUpdate: (s) => updates.push(s),
    });

    mockSendInsightEmail.mockResolvedValueOnce({ sent: true, messageId: 'msg-123' });

    mockMessagesCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '## Report' }],
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    const { generateWeeklyInsights } = await import('../workers/weekly-insights.ts');
    await generateWeeklyInsights();

    expect(updates.length).toBeGreaterThan(0);
    const emailedUpdate = updates.find((u: any) => u.emailedAt instanceof Date);
    expect(emailedUpdate).toBeTruthy();
  });

  it('does not set emailedAt when email is disabled (no API key)', async () => {
    const updates: unknown[] = [];

    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilyResults: {
        [FAMILY_ID]: [
          [],
          [{ totalCost: '1.000000' }],
        ],
      },
      memberEmails: ['test@example.com'],
      onUpdate: (s) => updates.push(s),
    });

    // Default mock returns { sent: false } — email disabled
    mockMessagesCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '## Report' }],
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    const { generateWeeklyInsights } = await import('../workers/weekly-insights.ts');
    const result = await generateWeeklyInsights();

    expect(result.familiesProcessed).toBe(1);
    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(1);
    // No emailedAt update issued
    const emailedUpdate = updates.find((u: any) => u.emailedAt instanceof Date);
    expect(emailedUpdate).toBeUndefined();
  });

  it('email failure does not prevent insight from being saved', async () => {
    const insightInserts: unknown[] = [];

    _mockDb = makeMockDb({
      families: [{ id: FAMILY_ID }],
      perFamilyResults: {
        [FAMILY_ID]: [
          [],
          [{ totalCost: '1.000000' }],
        ],
      },
      memberEmails: ['test@example.com'],
      onInsight: (v) => insightInserts.push(v),
    });

    mockSendInsightEmail.mockResolvedValueOnce({ sent: false, error: 'Resend API error' });

    mockMessagesCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '## Report\n\nContent here.' }],
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    const { generateWeeklyInsights } = await import('../workers/weekly-insights.ts');
    const result = await generateWeeklyInsights();

    // Insight was still saved
    expect(result.familiesProcessed).toBe(1);
    expect(result.errors).toHaveLength(0);
    const insightRow = insightInserts.find((v: any) => v.period === 'weekly');
    expect(insightRow).toBeTruthy();

    // Email failed but did not crash
    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(1);
  });
});
