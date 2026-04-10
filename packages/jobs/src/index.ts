// Public barrel — exports that other packages (apps/web) can import.
// Worker internals (syncConnection, registerJobs) are NOT re-exported here
// because they transitively import @budget-tracker/simplefin which doesn't
// exist in the workspace yet (Instance A). Consumers that need the worker
// import from './workers/sync-connection.ts' directly.
export { JOB_NAMES, type SyncConnectionPayload } from './job-names.ts';
export { createBoss } from './boss-factory.ts';
