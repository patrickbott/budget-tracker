import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config for Budget Tracker.
 *
 * `db:generate` (offline): reads schema/*.ts and emits SQL to ./migrations.
 *   Does NOT require a live database — set DATABASE_URL to any dummy value
 *   (e.g. `postgres://unused`) when running generate in CI or cold scaffolds.
 *
 * `db:migrate` (online): applies pending migrations to the database at
 *   DATABASE_URL. Must point at a real Postgres 16+ instance.
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://unused',
  },
  verbose: true,
  strict: true,
  casing: 'snake_case',
});
