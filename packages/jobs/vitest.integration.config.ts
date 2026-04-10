import { defineConfig } from 'vitest/config';

/**
 * Integration test config — requires a running Postgres.
 *
 * Run with: pnpm --filter @budget-tracker/jobs test:integration
 * Requires: DATABASE_URL pointing at a dev Postgres with migrations applied.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30000,
  },
});
