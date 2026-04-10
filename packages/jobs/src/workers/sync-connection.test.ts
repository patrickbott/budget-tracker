/**
 * Integration tests for the sync-connection worker.
 *
 * Runs against the real dev Postgres (started via `scripts/dev-init.sh`).
 * Each test uses a unique family_id and cleans up in `afterEach` via
 * `DELETE FROM family WHERE id = ...` — the cascade handles all child rows.
 *
 * `@budget-tracker/simplefin` is vi.mock'd since Instance A's PR hasn't
 * merged yet. The mock stubs `decryptAccessUrl` and `fetchAccountSet`.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, withFamilyContext } from '@budget-tracker/db/client';
import * as schema from '@budget-tracker/db/schema';

// Mock the simplefin package — Instance A hasn't landed it yet.
vi.mock('@budget-tracker/simplefin', () => ({
  decryptAccessUrl: vi.fn(() => 'https://test:test@bridge.simplefin.org/simplefin'),
  fetchAccountSet: vi.fn(),
  encryptAccessUrl: vi.fn(() => 'encrypted-test-url'),
  exchangeSetupToken: vi.fn(),
}));

import { fetchAccountSet } from '@budget-tracker/simplefin';

import { syncConnection } from './sync-connection.ts';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://budget:budget@localhost:5432/budget_tracker';

const TEST_FAMILY_PREFIX = '10000000-0000-4000-8000-';
let testCounter = 0;

function makeTestIds() {
  testCounter++;
  const pad = String(testCounter).padStart(12, '0');
  const familyId = `${TEST_FAMILY_PREFIX}${pad}`;
  const userId = familyId.replace('10000000', '20000000');
  const membershipId = familyId.replace('10000000', '30000000');
  const accountId = familyId.replace('10000000', '40000000');
  const connectionId = familyId.replace('10000000', '50000000');
  return { familyId, userId, membershipId, accountId, connectionId };
}

let dbConn: ReturnType<typeof createDb>;
const cleanupFamilyIds: string[] = [];

beforeAll(() => {
  dbConn = createDb(DATABASE_URL);
});

afterEach(async () => {
  // Clean up all test families (cascade handles children).
  for (const fid of cleanupFamilyIds) {
    await dbConn.db.execute(
      sql`SET LOCAL row_security = off`,
    ).catch(() => {});
    await dbConn.db.execute(
      sql`DELETE FROM family WHERE id = ${fid}`,
    );
  }
  cleanupFamilyIds.length = 0;
  vi.clearAllMocks();
});

async function seedTestFixtures(ids: ReturnType<typeof makeTestIds>) {
  cleanupFamilyIds.push(ids.familyId);

  await dbConn.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL row_security = off`);

    await tx.insert(schema.user).values({
      id: ids.userId,
      name: 'Test User',
      email: `test-${ids.userId}@example.invalid`,
      emailVerified: true,
    }).onConflictDoNothing();

    await tx.insert(schema.family).values({
      id: ids.familyId,
      name: 'Test Family',
      slug: `test-family-${ids.familyId.slice(-6)}`,
    }).onConflictDoNothing();

    await tx.insert(schema.membership).values({
      id: ids.membershipId,
      userId: ids.userId,
      organizationId: ids.familyId,
      role: 'owner',
    }).onConflictDoNothing();

    await tx.insert(schema.account).values({
      id: ids.accountId,
      familyId: ids.familyId,
      name: 'Test Checking',
      accountType: 'depository',
      simplefinAccountId: 'sf_acc_1',
      balance: '1000.0000',
    }).onConflictDoNothing();

    await tx.insert(schema.connection).values({
      id: ids.connectionId,
      familyId: ids.familyId,
      accessUrlEncrypted: 'encrypted-test-url',
      nickname: 'Test Connection',
      status: 'active',
    }).onConflictDoNothing();
  });
}

function makeMockAccountSet(
  overrides: {
    accounts?: Array<{
      id?: string;
      transactions?: Array<{
        id?: string;
        posted?: number;
        amount?: string;
        description?: string;
        pending?: boolean;
      }>;
    }>;
    errors?: Array<{ code: string; message: string }>;
  } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const accounts = overrides.accounts ?? [
    {
      id: 'sf_acc_1',
      transactions: [
        { id: 'txn_1', posted: now - 86400, amount: '-50.0000', description: 'Grocery Store' },
        { id: 'txn_2', posted: now - 172800, amount: '-25.5000', description: 'Gas Station' },
        { id: 'txn_3', posted: now - 259200, amount: '3000.0000', description: 'Payroll' },
      ],
    },
  ];

  const result = {
    accounts: accounts.map((a) => ({
      id: a.id ?? 'sf_acc_1',
      name: 'Test Account',
      balance: '1000.0000',
      currency: 'USD',
      transactions: (a.transactions ?? []).map((t) => ({
        id: t.id ?? 'txn_1',
        posted: t.posted ?? now,
        amount: t.amount ?? '-10.0000',
        description: t.description ?? 'Test Transaction',
        pending: t.pending ?? false,
      })),
    })),
    errors: overrides.errors ?? [],
    raw: JSON.stringify({ mock: true }),
  };

  return result;
}

describe('syncConnection', () => {
  it('happy path: creates entries with balanced lines', async () => {
    const ids = makeTestIds();
    await seedTestFixtures(ids);

    const mockData = makeMockAccountSet();
    vi.mocked(fetchAccountSet).mockResolvedValueOnce(mockData);

    const result = await syncConnection({
      connectionId: ids.connectionId,
      familyId: ids.familyId,
      userId: ids.userId,
    });

    expect(result.transactionsCreated).toBe(3);
    expect(result.transactionsUpdated).toBe(0);
    expect(result.transactionsSkipped).toBe(0);
    expect(result.errlist).toEqual([]);

    // Verify balanced lines: no entry should have lines that don't sum to zero.
    const unbalanced = await withFamilyContext(
      dbConn.db,
      ids.familyId,
      ids.userId,
      async (tx) => {
        return tx.execute(
          sql`SELECT entry_id, SUM(amount::numeric) as total
              FROM entry_line
              WHERE entry_id IN (SELECT id FROM entry WHERE family_id = ${ids.familyId})
              GROUP BY entry_id
              HAVING SUM(amount::numeric) != 0`,
        );
      },
    );
    expect(unbalanced).toHaveLength(0);

    // Verify connection.last_synced_at was set.
    const [conn] = await withFamilyContext(
      dbConn.db,
      ids.familyId,
      ids.userId,
      async (tx) => {
        return tx
          .select({ lastSyncedAt: schema.connection.lastSyncedAt })
          .from(schema.connection)
          .where(sql`${schema.connection.id} = ${ids.connectionId}`);
      },
    );
    expect(conn!.lastSyncedAt).not.toBeNull();

    // Verify sync_run was written.
    const syncRuns = await withFamilyContext(
      dbConn.db,
      ids.familyId,
      ids.userId,
      async (tx) => {
        return tx
          .select({ created: schema.syncRun.transactionsCreated })
          .from(schema.syncRun)
          .where(sql`${schema.syncRun.connectionId} = ${ids.connectionId}`);
      },
    );
    expect(syncRuns).toHaveLength(1);
    expect(syncRuns[0]!.created).toBe(3);
  });

  it('pending→posted: flips is_pending without creating a duplicate', async () => {
    const ids = makeTestIds();
    await seedTestFixtures(ids);
    const now = Math.floor(Date.now() / 1000);

    // First run: pending transaction.
    const pendingData = makeMockAccountSet({
      accounts: [
        {
          id: 'sf_acc_1',
          transactions: [
            { id: 'txn_pending_1', posted: now, amount: '-75.0000', description: 'Pending Charge', pending: true },
          ],
        },
      ],
    });
    vi.mocked(fetchAccountSet).mockResolvedValueOnce(pendingData);

    const run1 = await syncConnection({
      connectionId: ids.connectionId,
      familyId: ids.familyId,
      userId: ids.userId,
    });
    expect(run1.transactionsCreated).toBe(1);

    // Second run: same transaction, now posted.
    const postedData = makeMockAccountSet({
      accounts: [
        {
          id: 'sf_acc_1',
          transactions: [
            { id: 'txn_pending_1', posted: now, amount: '-75.0000', description: 'Posted Charge', pending: false },
          ],
        },
      ],
    });
    vi.mocked(fetchAccountSet).mockResolvedValueOnce(postedData);

    const run2 = await syncConnection({
      connectionId: ids.connectionId,
      familyId: ids.familyId,
      userId: ids.userId,
    });
    expect(run2.transactionsCreated).toBe(0);
    expect(run2.transactionsUpdated).toBe(1);

    // Verify only one entry exists and is_pending is false.
    const entries = await withFamilyContext(
      dbConn.db,
      ids.familyId,
      ids.userId,
      async (tx) => {
        return tx
          .select({
            isPending: schema.entry.isPending,
            description: schema.entry.description,
          })
          .from(schema.entry)
          .where(sql`${schema.entry.externalId} = 'txn_pending_1'`);
      },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.isPending).toBe(false);
    expect(entries[0]!.description).toBe('Posted Charge');
  });

  it('dedup: identical re-run creates zero new entries', async () => {
    const ids = makeTestIds();
    await seedTestFixtures(ids);

    const mockData = makeMockAccountSet({
      accounts: [
        {
          id: 'sf_acc_1',
          transactions: [
            {
              id: 'txn_dedup_1',
              posted: Math.floor(Date.now() / 1000),
              amount: '-30.0000',
              description: 'Coffee Shop',
            },
          ],
        },
      ],
    });

    // Run 1.
    vi.mocked(fetchAccountSet).mockResolvedValueOnce(mockData);
    const run1 = await syncConnection({
      connectionId: ids.connectionId,
      familyId: ids.familyId,
      userId: ids.userId,
    });
    expect(run1.transactionsCreated).toBe(1);

    // Run 2: identical data.
    vi.mocked(fetchAccountSet).mockResolvedValueOnce(mockData);
    const run2 = await syncConnection({
      connectionId: ids.connectionId,
      familyId: ids.familyId,
      userId: ids.userId,
    });
    expect(run2.transactionsCreated).toBe(0);
    expect(run2.transactionsSkipped).toBe(1);
  });

  it('unmapped account: transactions are skipped, mapped ones still ingested', async () => {
    const ids = makeTestIds();
    await seedTestFixtures(ids);
    const now = Math.floor(Date.now() / 1000);

    const mockData = makeMockAccountSet({
      accounts: [
        {
          id: 'sf_acc_1', // mapped
          transactions: [
            { id: 'txn_mapped_1', posted: now, amount: '-20.0000', description: 'Mapped Txn' },
          ],
        },
        {
          id: 'sf_acc_99', // NOT mapped
          transactions: [
            { id: 'txn_unmapped_1', posted: now, amount: '-10.0000', description: 'Unmapped Txn' },
            { id: 'txn_unmapped_2', posted: now, amount: '-15.0000', description: 'Unmapped Txn 2' },
          ],
        },
      ],
    });

    vi.mocked(fetchAccountSet).mockResolvedValueOnce(mockData);

    const result = await syncConnection({
      connectionId: ids.connectionId,
      familyId: ids.familyId,
      userId: ids.userId,
    });

    expect(result.transactionsCreated).toBe(1);
    expect(result.transactionsSkipped).toBe(2);
  });

  it('errlist surfacing: sets connection status to needs_reauth and writes errlist', async () => {
    const ids = makeTestIds();
    await seedTestFixtures(ids);

    const mockData = makeMockAccountSet({
      accounts: [{ id: 'sf_acc_1', transactions: [] }],
      errors: [{ code: 'AUTH_EXPIRED', message: 'Re-auth required' }],
    });

    vi.mocked(fetchAccountSet).mockResolvedValueOnce(mockData);

    const result = await syncConnection({
      connectionId: ids.connectionId,
      familyId: ids.familyId,
      userId: ids.userId,
    });

    expect(result.errlist).toEqual(['AUTH_EXPIRED: Re-auth required']);

    // Verify connection status.
    const [conn] = await withFamilyContext(
      dbConn.db,
      ids.familyId,
      ids.userId,
      async (tx) => {
        return tx
          .select({
            status: schema.connection.status,
            lastErrlist: schema.connection.lastErrlist,
          })
          .from(schema.connection)
          .where(sql`${schema.connection.id} = ${ids.connectionId}`);
      },
    );
    expect(conn!.status).toBe('needs_reauth');
    expect(conn!.lastErrlist).toEqual(['AUTH_EXPIRED: Re-auth required']);

    // Verify sync_run has errlist.
    const syncRuns = await withFamilyContext(
      dbConn.db,
      ids.familyId,
      ids.userId,
      async (tx) => {
        return tx
          .select({ errlist: schema.syncRun.errlistJson })
          .from(schema.syncRun)
          .where(sql`${schema.syncRun.connectionId} = ${ids.connectionId}`);
      },
    );
    expect(syncRuns).toHaveLength(1);
    expect(syncRuns[0]!.errlist).toEqual(['AUTH_EXPIRED: Re-auth required']);
  });
});
