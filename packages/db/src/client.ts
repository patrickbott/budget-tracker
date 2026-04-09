/**
 * Drizzle client factory and the `withFamilyContext` RLS helper.
 *
 * Every request that reads or writes family-scoped data MUST go through
 * `withFamilyContext`. That wrapper opens a transaction, sets two Postgres
 * session variables (`app.current_family_id` and `app.current_user_id`),
 * and then calls the user-provided function with the transaction handle.
 * The session variables are scoped to the transaction via `SET LOCAL`, so
 * they auto-reset at COMMIT / ROLLBACK — no risk of a stale family_id
 * leaking into a different request on a pooled connection.
 *
 * The row-level security policies in `migrations/0001_rls_policies.sql`
 * read these session variables on every query. If the app layer forgets to
 * call `withFamilyContext`, the RLS policies return zero rows — the
 * database refuses rather than leaking data across families.
 *
 * Input hardening: both family_id and user_id are validated as UUID strings
 * before being interpolated into the `SET LOCAL` statement. Postgres will
 * reject a malformed uuid cast anyway, but validating up front gives a
 * friendly error and removes any theoretical SQL-injection surface from the
 * session variable path.
 */
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { z } from 'zod';

import * as schema from './schema/index.ts';

/** Zod guard for UUID strings (both v4 and v7). */
const uuidSchema = z.string().uuid();

/**
 * The strongly-typed Drizzle database handle returned by {@link createDb}.
 * Every table, enum, and column is reachable via `db.query.<table>` or
 * Drizzle's SQL builder.
 */
export type Database = PostgresJsDatabase<typeof schema>;

/**
 * A transactional database handle — what {@link withFamilyContext}'s
 * callback receives. Identical shape to {@link Database}; the type alias
 * exists to make the callback signature self-documenting.
 */
export type DatabaseTx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface CreateDbOptions {
  /** Underlying connection pool size. Defaults to 10. */
  max?: number;
  /** Whether to require TLS. Defaults to false (for local dev). */
  ssl?: boolean;
  /** Extra `postgres` options, merged over the defaults. */
  raw?: Parameters<typeof postgres>[1];
}

/**
 * Construct a Drizzle client bound to `postgres-js` and this package's schema.
 *
 * The returned `db` handle can be shared across requests — it's a pooled
 * client, not a per-request connection. For anything family-scoped, wrap
 * the call site in {@link withFamilyContext}.
 *
 * @example
 * ```ts
 * const db = createDb(process.env.DATABASE_URL!);
 * const result = await withFamilyContext(db, familyId, userId, async (tx) => {
 *   return tx.select().from(schema.account);
 * });
 * ```
 */
export function createDb(
  connectionString: string,
  options: CreateDbOptions = {},
): { db: Database; sql: Sql } {
  const sqlClient = postgres(connectionString, {
    max: options.max ?? 10,
    ssl: options.ssl ?? false,
    // `postgres-js` accepts snake_case column names natively via the
    // `transform` option, but Drizzle handles that itself via the schema.
    ...options.raw,
  });

  const db = drizzle(sqlClient, {
    schema,
    // Mirrors drizzle.config.ts so runtime queries emit snake_case columns
    // even when we write camelCase field names in the schema.
    casing: 'snake_case',
  });

  return { db, sql: sqlClient };
}

/**
 * Run `fn` inside a transaction with Postgres session variables set for the
 * current family + user.
 *
 * Why a transaction? `SET LOCAL` only applies inside a transaction block.
 * Using `SET` (without LOCAL) on a pooled connection is unsafe — the value
 * persists across checkouts. `SET LOCAL` is the only way to reliably scope
 * the variables to one logical operation.
 *
 * Validation: both ids are parsed as UUIDs before use. This gives a clear
 * error at the top of the transaction rather than a cryptic Postgres cast
 * failure deeper in the call stack.
 *
 * The RLS policies in migration 0001 read `current_setting('app.<name>',
 * true)::text`; the `true` second argument returns NULL on missing instead
 * of raising. Code paths that skip `withFamilyContext` will therefore see
 * an empty result set, not an exception.
 *
 * @throws `ZodError` if either id is not a valid UUID string.
 */
export async function withFamilyContext<T>(
  db: Database,
  familyId: string,
  userId: string,
  fn: (tx: DatabaseTx) => Promise<T>,
): Promise<T> {
  const parsedFamilyId = uuidSchema.parse(familyId);
  const parsedUserId = uuidSchema.parse(userId);

  return db.transaction(async (tx) => {
    // `set_config(name, value, is_local)` is the safe way to set a session
    // variable from a parameter binding — it sidesteps the `SET LOCAL`
    // statement's inability to accept bind parameters.
    await tx.execute(
      sql`SELECT set_config('app.current_family_id', ${parsedFamilyId}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.current_user_id', ${parsedUserId}, true)`,
    );
    return fn(tx);
  });
}

