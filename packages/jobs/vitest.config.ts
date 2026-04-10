import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    // Integration tests hit a real Postgres — allow more time than core's 5s.
    testTimeout: 30000,
  },
});
