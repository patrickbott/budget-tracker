import PgBoss from "pg-boss";
import { registerJobs, registerSchedules } from "@budget-tracker/jobs/boss";

// Lazy singleton pg-boss instance.
//
// Build-phase note: `next build` evaluates server modules at build time.
// If DATABASE_URL is unset during build, we construct pg-boss with a parked
// URL and never call `.start()`. This mirrors the approach in `lib/db.ts`.
// At runtime, the real DATABASE_URL is always available.

let _boss: PgBoss | undefined;
let _started = false;

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;

  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  if (isBuildPhase) {
    return "postgres://build@localhost:5432/build";
  }

  throw new Error("DATABASE_URL is not set");
}

export async function getBoss(): Promise<PgBoss> {
  if (!_boss) {
    _boss = new PgBoss({
      connectionString: resolveDatabaseUrl(),
      schema: "pgboss",
    });
  }
  if (!_started) {
    await _boss.start();
    registerJobs(_boss);
    await registerSchedules(_boss);
    _started = true;
  }
  return _boss;
}
