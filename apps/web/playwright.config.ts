import { defineConfig, devices } from "@playwright/test";

// Playwright smoke-test configuration. Phase 0b keeps this minimal — one
// smoke test that just verifies the landing page renders. Full signup →
// SimpleFIN → chat flows land in later phases under `apps/web/e2e/`.
//
// Browser binaries are NOT installed automatically by `pnpm install`; run
// `pnpm --filter @budget-tracker/web exec playwright install --with-deps`
// once locally before running `pnpm test:e2e`.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
