import type PgBoss from 'pg-boss';

import { JOB_NAMES, SyncConnectionPayloadSchema } from './job-names.ts';
import { syncConnection } from './workers/sync-connection.ts';

// Re-export factory from the split file.
export { createBoss } from './boss-factory.ts';

/**
 * Register all job handlers on the given pg-boss instance.
 *
 * Call this after `boss.start()`. Workers that are not yet implemented
 * (R2+) get empty handlers so the queue drains cleanly if a job is
 * published before the worker is ready.
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

  // R2: sync all connections for a family in sequence.
  boss.work(JOB_NAMES.SYNC_FAMILY, async () => {});

  // R2: prune sync_run rows older than 7 days.
  boss.work(JOB_NAMES.PRUNE_SYNC_RUNS, async () => {});
}
