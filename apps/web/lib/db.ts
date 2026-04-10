import { createDb, schema } from "@budget-tracker/db";

// Singleton Drizzle client wrapper.
//
// `createDb` returns `{ db, sql }` — the `db` handle is the Drizzle instance
// we pass into Better Auth's drizzleAdapter; `sql` is the raw postgres-js
// client the RLS helper (`withFamilyContext`) uses under the hood. For
// anything family-scoped, go through `withFamilyContext` from
// `@budget-tracker/db` rather than calling `getDb()` directly.
//
// Build-phase note: `next build` evaluates every route's server module to
// collect page data, which reaches this file through `lib/auth/server.ts`.
// We tolerate a missing `DATABASE_URL` during the build phase by falling
// back to a parked URL. `postgres-js` is lazy — no TCP connection is opened
// until someone actually runs a query — so passing a dummy URL here only
// fails at runtime if the *real* deployment forgot to set `DATABASE_URL`,
// and that failure is caught by the health check in Phase 1, not by a
// confusing build error here.
let _conn: ReturnType<typeof createDb> | undefined;

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;

  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  if (isBuildPhase) {
    // Never actually connected to; see block comment above.
    return "postgres://build@localhost:5432/build";
  }

  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the value.",
  );
}

export function getDb() {
  if (!_conn) {
    _conn = createDb(resolveDatabaseUrl());
  }
  return _conn.db;
}

export { schema };
