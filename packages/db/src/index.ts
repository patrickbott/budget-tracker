/**
 * `@budget-tracker/db` — package entrypoint.
 *
 * Re-exports the Drizzle client factory + the RLS helper from `./client.ts`,
 * plus everything in `./schema/`. Consumers should prefer:
 *
 *   import { createDb, withFamilyContext, schema } from '@budget-tracker/db';
 *   import { account, entry } from '@budget-tracker/db/schema';
 *
 * The `./schema` subpath is an alias for the schema barrel and is the
 * recommended import when you only need table references (no client).
 */
export * from './client.ts';

import * as schema from './schema/index.ts';
export { schema };
