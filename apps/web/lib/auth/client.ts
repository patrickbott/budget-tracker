import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

// Better Auth browser client. The `organizationClient` plugin gives us typed
// `authClient.organization.*` helpers (create, list, setActive, etc.) on the
// client side. Server-side calls go through `auth.api.*` in
// `lib/auth/server.ts`.
export const authClient = createAuthClient({
  plugins: [organizationClient()],
});
