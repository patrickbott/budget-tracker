import { defineConfig } from 'vitest/config';

/**
 * Vitest config for `@budget-tracker/ai`.
 *
 * Mirrors `@budget-tracker/core`: node env, explicit imports, 5s cap.
 * Nothing in here touches the DOM or real network — the Anthropic client
 * wrapper is imported only for a smoke test that constructs the SDK
 * instance with a stubbed env var; no live API calls.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    testTimeout: 5000,
  },
});
