import { sql } from 'drizzle-orm';
import { createDb } from '@budget-tracker/db/client';

const RETENTION_DAYS = 7;

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
 * Null out `raw_response_gzip` on sync_run rows older than 7 days.
 *
 * We keep the lightweight metadata (timestamps, counts, errlist) forever
 * for debugging, but the gzipped SimpleFIN response is only needed for
 * short-term troubleshooting.
 *
 * Bypasses RLS since this is a system-level maintenance job.
 */
export async function pruneSyncRuns(): Promise<number> {
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL row_security = off`);

    return tx.execute(
      sql`UPDATE sync_run
          SET raw_response_gzip = NULL
          WHERE raw_response_gzip IS NOT NULL
            AND started_at < NOW() - INTERVAL '7 days'`,
    );
  });

  return result.length;
}
