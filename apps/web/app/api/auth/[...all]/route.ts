import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/server";

// Catch-all Better Auth route handler: every Better Auth endpoint
// (e.g. /api/auth/sign-in/email, /api/auth/organization/create) flows
// through here.
export const { GET, POST } = toNextJsHandler(auth);
