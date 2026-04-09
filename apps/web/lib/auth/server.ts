import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import { getDb, schema } from "@/lib/db";

// Better Auth server instance.
//
// Integration notes:
//
// - Uses the Drizzle adapter against `packages/db` from the monorepo. The
//   `schema` import re-exported by `@/lib/db` comes from `@budget-tracker/db`,
//   which Instance A builds in the parallel Phase 0b PR.
// - The `organization` plugin is remapped so that the plugin's
//   `organization` model maps to our `family` table, and `member` maps to
//   `membership`. The `invitation` model keeps its default name.
// - Email + password is enabled for the signup / login flows scaffolded in
//   `app/(auth)/**`. Passkeys and social providers are deferred to Phase 3+.
//
// See `docs/architecture.md` ("Auth + multi-tenancy") and the full plan in
// `docs/plan.md` for how the family tenant model ties into row-level
// security.
export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    organization({
      schema: {
        organization: {
          modelName: "family",
        },
        member: {
          modelName: "membership",
        },
        // `invitation` keeps its default table name.
      },
    }),
  ],
});
