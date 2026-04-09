import { defineConfig } from 'vitest/config';

/**
 * Vitest config for `@budget-tracker/core`.
 *
 * `environment: 'node'` because nothing in core touches the DOM — these
 * are pure functions on plain data. `globals: false` keeps the test file
 * imports explicit, which matches the rest of the TypeScript code style.
 *
 * Per-package tsconfig is picked up automatically via `typecheck: false`
 * (Vitest handles TypeScript via esbuild at runtime, no type-checking pass
 * during test runs — `pnpm typecheck` is the separate quality gate).
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    // Core tests MUST be fast. If we ever hit this cap, either split the
    // test or extract heavy logic into a package that can be tested
    // separately — don't raise the limit.
    testTimeout: 5000,
  },
});
