import { defineConfig } from 'vitest/config';

/**
 * Default vitest config — runs unit tests only.
 *
 * Integration tests (*.integration.test.ts) require a running Postgres
 * and are gated behind `pnpm test:integration` with a separate config.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    testTimeout: 5000,
  },
});
