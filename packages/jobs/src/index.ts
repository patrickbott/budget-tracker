// Public barrel — exports that other packages (apps/web) can import.
//
// Worker internals (syncConnection, registerJobs) are NOT re-exported here
// because they transitively import @budget-tracker/simplefin and pg-boss,
// which would pull a large runtime surface into any consumer. Code that
// needs the worker imports from './workers/sync-connection.ts' directly.
//
// Pure ingest helpers that don't transitively pull simplefin/pg-boss are
// safe to expose so apps/web server actions can call the same code path
// the sync worker uses without duplicating queries.
export { JOB_NAMES, type SyncConnectionPayload } from './job-names.ts';
export { createBoss } from './boss-factory.ts';
export {
  detectRecurringCandidatesForFamily,
  type DetectRecurringResult,
} from './ingest/detect-recurring.ts';
