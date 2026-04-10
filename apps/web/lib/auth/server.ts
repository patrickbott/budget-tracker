import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import { getDb, schema } from "@/lib/db";

// Better Auth server instance.
//
// Integration notes:
//
// - Uses the Drizzle adapter against `packages/db` from the monorepo.
// - The schema barrel exports both `account` (our polymorphic financial
//   account table) and `authAccount` (Better Auth's OAuth / credential
//   storage, renamed to `auth_account` at the SQL layer to avoid the
//   collision). We MUST hand Better Auth an explicit schema map that binds
//   its `account` model to our `authAccount` export — otherwise the adapter
//   would try to write credential rows into the financial account table and
//   every signup/login would fail. See the naming note in
//   `packages/db/src/schema/auth.ts` for background.
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
    schema: {
      user: schema.user,
      session: schema.session,
      verification: schema.verification,
      // Remap Better Auth's `account` model → our `auth_account` table
      // (exported as `authAccount` in TS) so BA doesn't collide with the
      // polymorphic financial `account` table.
      account: schema.authAccount,
    },
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
