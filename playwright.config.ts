import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end demo story tests against the dev server in mock mode
 * (.env.development: VITE_API_MODE=mock, VITE_MOCK_MISSION_DAY=25).
 * Each test opens a fresh browser context, so the in-browser mock data starts clean.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174/login',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
