import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e-live',
  outputDir: './test-results/live',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  webServer: process.env.AEGIS_E2E_URL
    ? undefined
    : {
        command: 'node scripts/e2e-live-server.mjs',
        url: 'http://localhost:5175/api/v1/console/missions/current/state',
        timeout: 120_000,
        reuseExistingServer: false,
      },
  use: {
    baseURL: process.env.AEGIS_E2E_URL ?? 'http://localhost:5175',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
    trace: 'retain-on-failure',
  },
});
