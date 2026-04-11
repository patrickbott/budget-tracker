/**
 * Integration tests for the sync-connection worker.
 *
 * Runs against the real dev Postgres (started via `scripts/dev-init.sh`).
 * Each test uses a unique family_id and cleans up in `afterEach` via
 * `DELETE FROM family WHERE id = ...` — the cascade handles all child rows.
 *
 * `@budget-tracker/simplefin` is vi.mock'd so the test suite doesn't
 * need a live SimpleFIN bridge. The mock stubs `decryptAccessUrl` and
 * `fetchAccountSet`.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { createDb, withFamilyContext } from '@budget-tracker/db/client';
import * as schema from '@budget-tracker/db/schema';

// Mock the simplefin package.
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

  return {
    connections: [],
    accounts: accounts.map((a) => ({
      simplefinId: a.id ?? 'sf_acc_1',
      simplefinConnId: 'conn_1',
      name: 'Test Account',
      balance: new Decimal(1000),
      balanceDate: new Date(),
      currency: 'USD',
      transactions: (a.transactions ?? []).map((t) => ({
        simplefinId: t.id ?? 'txn_1',
        posted: new Date((t.posted ?? now) * 1000),
        amount: new Decimal(t.amount ?? '-10.0000'),
        description: t.description ?? 'Test Transaction',
        pending: t.pending ?? false,
      })),
    })),
    errors: (overrides.errors ?? []).map((e) => ({
      code: e.code,
      message: e.message,
    })),
    rateLimited: false,
  };
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

  it('auto-creates account for new SimpleFIN account and imports transactions', async () => {
    const ids = makeTestIds();
    await seedTestFixtures(ids);
    const now = Math.floor(Date.now() / 1000);

    const mockData = makeMockAccountSet({
      accounts: [
        {
          id: 'sf_acc_1', // already mapped
          transactions: [
            { id: 'txn_mapped_1', posted: now, amount: '-20.0000', description: 'Mapped Txn' },
          ],
        },
        {
          id: 'sf_acc_new', // new, should be auto-created
          transactions: [
            { id: 'txn_new_1', posted: now, amount: '-10.0000', description: 'New Acct Txn' },
            { id: 'txn_new_2', posted: now, amount: '-15.0000', description: 'New Acct Txn 2' },
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

    // All 3 transactions should be created (none skipped).
    expect(result.transactionsCreated).toBe(3);
    expect(result.transactionsSkipped).toBe(0);

    // Verify the new account was auto-created.
    const accounts = await withFamilyContext(
      dbConn.db,
      ids.familyId,
      ids.userId,
      async (tx) => {
        return tx
          .select({
            id: schema.account.id,
            name: schema.account.name,
            simplefinAccountId: schema.account.simplefinAccountId,
            accountType: schema.account.accountType,
            isManual: schema.account.isManual,
            connectionId: schema.account.connectionId,
          })
          .from(schema.account)
          .where(sql`${schema.account.simplefinAccountId} = 'sf_acc_new'`);
      },
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.name).toBe('Test Account');
    expect(accounts[0]!.accountType).toBe('depository');
    expect(accounts[0]!.isManual).toBe(false);
    expect(accounts[0]!.connectionId).toBe(ids.connectionId);
  });

  it('updates account balance after sync', async () => {
    const ids = makeTestIds();
    await seedTestFixtures(ids);
    const now = Math.floor(Date.now() / 1000);
    const balanceDate = new Date();

    const mockData = {
      connections: [],
      accounts: [{
        simplefinId: 'sf_acc_1',
        simplefinConnId: 'conn_1',
        name: 'Test Account',
        balance: new Decimal('2500.7500'),
        balanceDate,
        currency: 'USD',
        transactions: [
          {
            simplefinId: 'txn_bal_1',
            posted: new Date(now * 1000),
            amount: new Decimal('-50.0000'),
            description: 'Test',
            pending: false,
          },
        ],
      }],
      errors: [],
      rateLimited: false,
    };

    vi.mocked(fetchAccountSet).mockResolvedValueOnce(mockData);

    await syncConnection({
      connectionId: ids.connectionId,
      familyId: ids.familyId,
      userId: ids.userId,
    });

    // Verify balance was updated.
    const [acct] = await withFamilyContext(
      dbConn.db,
      ids.familyId,
      ids.userId,
      async (tx) => {
        return tx
          .select({
            balance: schema.account.balance,
            balanceAsOf: schema.account.balanceAsOf,
          })
          .from(schema.account)
          .where(sql`${schema.account.id} = ${ids.accountId}`);
      },
    );
    expect(acct!.balance).toBe('2500.7500');
    expect(acct!.balanceAsOf).not.toBeNull();
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

  it('post-ingest: applies rules and persists transfer candidates', async () => {
    const ids = makeTestIds();
    await seedTestFixtures(ids);
    const now = Math.floor(Date.now() / 1000);

    // Seed a second account so the transfer detector has two owned
    // accounts to pair entries across, and a rule that will match on
    // one of the incoming descriptions.
    const secondAccountId = ids.accountId.replace('40000000', '41000000');
    const ruleId = ids.familyId.replace('10000000', '60000000');
    const targetCategoryId = ids.familyId.replace('10000000', '70000000');

    await dbConn.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL row_security = off`);
      await tx.insert(schema.account).values({
        id: secondAccountId,
        familyId: ids.familyId,
        name: 'Test Savings',
        accountType: 'depository',
        simplefinAccountId: 'sf_acc_2',
        balance: '0.0000',
      });
      await tx.insert(schema.category).values({
        id: targetCategoryId,
        familyId: ids.familyId,
        name: 'Groceries',
        kind: 'expense',
      });
      await tx.insert(schema.rule).values({
        id: ruleId,
        familyId: ids.familyId,
        name: 'Whole Foods → Groceries',
        stage: 'default',
        enabled: true,
        specificityScore: 10,
        conditionsJson: [
          { field: 'description', operator: 'contains', value: 'Whole Foods' },
        ],
        actionsJson: [{ type: 'set_category', value: targetCategoryId }],
      });
    });

    const mockData = {
      connections: [],
      accounts: [
        {
          simplefinId: 'sf_acc_1',
          simplefinConnId: 'conn_1',
          name: 'Test Checking',
          balance: new Decimal('900.0000'),
          balanceDate: new Date(),
          currency: 'USD',
          transactions: [
            {
              simplefinId: 'txn_wf_1',
              posted: new Date(now * 1000),
              amount: new Decimal('-45.0000'),
              description: 'Whole Foods Market',
              pending: false,
            },
            {
              simplefinId: 'txn_xfer_out_1',
              posted: new Date(now * 1000),
              amount: new Decimal('-500.0000'),
              description: 'Transfer to Savings',
              pending: false,
            },
          ],
        },
        {
          simplefinId: 'sf_acc_2',
          simplefinConnId: 'conn_1',
          name: 'Test Savings',
          balance: new Decimal('500.0000'),
          balanceDate: new Date(),
          currency: 'USD',
          transactions: [
            {
              simplefinId: 'txn_xfer_in_1',
              posted: new Date(now * 1000),
              amount: new Decimal('500.0000'),
              description: 'Transfer from Checking',
              pending: false,
            },
          ],
        },
      ],
      errors: [],
      rateLimited: false,
    };

    vi.mocked(fetchAccountSet).mockResolvedValueOnce(mockData);

    const result = await syncConnection({
      connectionId: ids.connectionId,
      familyId: ids.familyId,
      userId: ids.userId,
    });

    expect(result.transactionsCreated).toBe(3);
    expect(result.rulesApplied).toBe(1);
    expect(result.transferCandidatesCreated).toBe(1);

    // The Whole Foods entry's category-side leg should now point at the
    // rule's target category, not at Uncategorized.
    const categorizedLine = await withFamilyContext(
      dbConn.db,
      ids.familyId,
      ids.userId,
      async (tx) => {
        return tx
          .select({ categoryId: schema.entryLine.categoryId })
          .from(schema.entryLine)
          .innerJoin(schema.entry, sql`${schema.entry.id} = ${schema.entryLine.entryId}`)
          .where(
            sql`${schema.entry.externalId} = 'txn_wf_1' AND ${schema.entryLine.accountId} IS NULL`,
          );
      },
    );
    expect(categorizedLine).toHaveLength(1);
    expect(categorizedLine[0]!.categoryId).toBe(targetCategoryId);

    // A transfer_candidate row should exist for the opposite-sign pair.
    const candidates = await withFamilyContext(
      dbConn.db,
      ids.familyId,
      ids.userId,
      async (tx) => {
        return tx
          .select({
            id: schema.transferCandidate.id,
            status: schema.transferCandidate.status,
            confidence: schema.transferCandidate.confidence,
          })
          .from(schema.transferCandidate)
          .where(sql`${schema.transferCandidate.familyId} = ${ids.familyId}`);
      },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.status).toBe('pending');
  });
});
