import { gzipSync } from 'node:zlib';
import { syncRun } from '@budget-tracker/db/schema';
import type { DatabaseTx } from '@budget-tracker/db/client';

export interface WriteSyncRunInput {
  connectionId: string;
  familyId: string;
  requestRangeStart: Date;
  requestRangeEnd: Date;
  rawResponseJson: string;
  errlist: string[];
  status: 'success' | 'failed';
  transactionsCreated: number;
  transactionsUpdated: number;
}

export async function writeSyncRun(
  tx: DatabaseTx,
  input: WriteSyncRunInput,
): Promise<string> {
  const gzipped = gzipSync(Buffer.from(input.rawResponseJson, 'utf-8'));

  const rows = await tx
    .insert(syncRun)
    .values({
      connectionId: input.connectionId,
      familyId: input.familyId,
      requestRangeStart: input.requestRangeStart,
      requestRangeEnd: input.requestRangeEnd,
      rawResponseGzip: gzipped,
      status: input.status,
      transactionsCreated: input.transactionsCreated,
      transactionsUpdated: input.transactionsUpdated,
      errlistJson: input.errlist.length > 0 ? input.errlist : null,
      finishedAt: new Date(),
    })
    .returning({ id: syncRun.id });

  return rows[0]!.id;
}
