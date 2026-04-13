import { vi } from 'vitest';

/**
 * Shared mock helpers for auto-categorize and weekly-insights tests.
 *
 * Provides a chainable mock transaction that returns canned results
 * from a FIFO queue on each `.where()` / terminal call.
 */

export const mockMessagesCreate = vi.fn();

/**
 * Build a mock Drizzle transaction that returns results from a FIFO
 * queue. Each `.select().from().where()` (or deeper chain) pops the
 * next result from `selectResults`.
 */
export function makeMockChainTx(opts: {
  selectResults: unknown[][];
  onUpdate?: (set: unknown) => void;
  onInsert?: (table: string, values: unknown) => void;
}) {
  let selectIndex = 0;

  const popResult = async () => opts.selectResults[selectIndex++] ?? [];

  // Terminal builder: .where() or .limit() resolves
  const terminalWhere = vi.fn(popResult);
  const terminalLimit = vi.fn(popResult);
  const terminalLeftJoin2 = vi.fn(() => ({
    where: terminalWhere,
  }));
  const terminalLeftJoin = vi.fn(() => ({
    leftJoin: terminalLeftJoin2,
    where: terminalWhere,
  }));
  const terminalInnerJoin = vi.fn(() => ({
    leftJoin: terminalLeftJoin,
    where: terminalWhere,
  }));
  const terminalGroupBy = vi.fn(popResult);
  const terminalFrom = vi.fn(() => ({
    where: terminalWhere,
    innerJoin: terminalInnerJoin,
    groupBy: terminalGroupBy,
    limit: terminalLimit,
  }));
  const selectFn = vi.fn(() => ({ from: terminalFrom }));

  const updateWhere = vi.fn(async () => {
    opts.onUpdate?.(null);
  });
  const updateSet = vi.fn((set: unknown) => ({
    where: () => {
      opts.onUpdate?.(set);
      return updateWhere();
    },
  }));
  const updateFn = vi.fn(() => ({ set: updateSet }));

  const onConflict = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn((values: unknown) => {
    opts.onInsert?.('unknown', values);
    return { onConflictDoUpdate: onConflict };
  });
  const insertFn = vi.fn(() => ({ values: insertValues }));

  const executeFn = vi.fn().mockResolvedValue(undefined);

  const tx = {
    select: selectFn,
    update: updateFn,
    insert: insertFn,
    execute: executeFn,
  } as any;

  return {
    tx,
    mocks: {
      selectFn,
      updateFn,
      updateSet,
      insertFn,
      insertValues,
      executeFn,
    },
  };
}

/**
 * Wrap a mock tx in a mock `db.transaction()` call. The `getDb()`
 * singleton is bypassed by setting the module-level `_mockDb`.
 */
export function wrapInTransaction(
  txFactory: () => ReturnType<typeof makeMockChainTx>,
) {
  return {
    transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
      const { tx } = txFactory();
      return fn(tx);
    }),
  };
}
