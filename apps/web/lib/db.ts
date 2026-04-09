// Singleton Drizzle client wrapper.
//
// We import `createDb` + `schema` from the monorepo `@budget-tracker/db`
// package, which Instance A builds in the parallel Phase 0b PR. Until that
// PR merges into `main`, the import below will fail type resolution inside
// this worktree — that's expected and documented in the Phase 0b Instance B
// PR body. The `@ts-expect-error` directive is temporary and should be
// removed in the review pass after Instance A lands.
//
// TODO(phase-0b): remove `@ts-expect-error` once `@budget-tracker/db` is
// published by Instance A.
// @ts-expect-error pending @budget-tracker/db PR (Phase 0b Instance A)
import { createDb, schema } from "@budget-tracker/db";

let _db: ReturnType<typeof createDb> | undefined;

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the value.",
      );
    }
    _db = createDb(url);
  }
  return _db;
}

export { schema };
