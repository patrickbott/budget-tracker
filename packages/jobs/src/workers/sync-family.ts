import { eq, sql } from 'drizzle-orm';
import { connection, membership } from '@budget-tracker/db/schema';
import { createDb } from '@budget-tracker/db/client';
import type PgBoss from 'pg-boss';

import { JOB_NAMES } from '../job-names.ts';

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

let _db: ReturnType<typeof createDb> | undefined;
function getDb() {
  if (!_db) _db = createDb(getDatabaseUrl());
  return _db.db;
}

/**
 * Scheduled job that discovers all active connections and sends a
 * SYNC_CONNECTION job for each one.
 *
 * This is a system-level job — it bypasses RLS to query across all
 * families. Each individual SYNC_CONNECTION job runs inside RLS via
 * `withFamilyContext`.
 */
export async function syncAllFamilies(boss: PgBoss): Promise<number> {
  const db = getDb();

  // Bypass RLS to query all connections across families.
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL row_security = off`);

    // For each active connection, find an owner user in that family
    // to use as the userId context for the sync.
    return tx
      .select({
        connectionId: connection.id,
        familyId: connection.familyId,
        userId: membership.userId,
      })
      .from(connection)
      .innerJoin(
        membership,
        sql`${membership.organizationId} = ${connection.familyId} AND ${membership.role} = 'owner'`,
      )
      .where(eq(connection.status, 'active'));
  });

  // Deduplicate — if a family has multiple owners, only use the first.
  const seen = new Set<string>();
  let queued = 0;

  console.info(`[sync-family] Found ${rows.length} active connection(s) across all families`);

  for (const row of rows) {
    const key = row.connectionId;
    if (seen.has(key)) continue;
    seen.add(key);

    await boss.send(JOB_NAMES.SYNC_CONNECTION, {
      connectionId: row.connectionId,
      familyId: row.familyId,
      userId: row.userId,
    });
    queued++;
  }

  return queued;
}
