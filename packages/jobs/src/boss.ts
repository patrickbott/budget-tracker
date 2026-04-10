import type PgBoss from 'pg-boss';

import { JOB_NAMES, SyncConnectionPayloadSchema } from './job-names.ts';
import { syncConnection } from './workers/sync-connection.ts';
import { syncAllFamilies } from './workers/sync-family.ts';
import { pruneSyncRuns } from './workers/prune-sync-runs.ts';

// Re-export factory from the split file.
export { createBoss } from './boss-factory.ts';

/**
 * Register all job handlers on the given pg-boss instance.
 *
 * Call this after `boss.start()`. Workers that are not yet implemented
 * get empty handlers so the queue drains cleanly if a job is published
 * before the worker is ready.
 *
 * This module imports @budget-tracker/simplefin transitively via
 * sync-connection.ts, so it's NOT exported from the barrel (index.ts).
 * Apps that need to register workers import this file directly.
 */
export function registerJobs(boss: PgBoss): void {
  // pg-boss v10 delivers jobs in batches (handler receives Job[]).
  boss.work(JOB_NAMES.SYNC_CONNECTION, async (jobs) => {
    for (const job of jobs) {
      const payload = SyncConnectionPayloadSchema.parse(job.data);
      await syncConnection(payload);
    }
  });

  // Discover all active connections and enqueue per-connection syncs.
  boss.work(JOB_NAMES.SYNC_FAMILY, async () => {
    await syncAllFamilies(boss);
  });

  // Null out raw_response_gzip on sync_run rows older than 7 days.
  boss.work(JOB_NAMES.PRUNE_SYNC_RUNS, async () => {
    await pruneSyncRuns();
  });
}

/**
 * Register cron schedules. Called once after `boss.start()`.
 *
 * pg-boss's `schedule()` is idempotent — calling it multiple times with the
 * same name + cron just updates the existing schedule.
 */
export async function registerSchedules(boss: PgBoss): Promise<void> {
  // Every 4 hours: discover and sync all active connections.
  // SimpleFIN refreshes ~once/24h, 4h interval = 6 requests/day per
  // connection, well under the 24/day quota.
  await boss.schedule(JOB_NAMES.SYNC_FAMILY, '0 */4 * * *');

  // Daily at 03:00 UTC: prune old sync_run raw payloads.
  await boss.schedule(JOB_NAMES.PRUNE_SYNC_RUNS, '0 3 * * *');
}
