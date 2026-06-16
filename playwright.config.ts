import { defineConfig, devices } from '@playwright/test';

// Integration tests run against a dev server on a dedicated port (3100) backed
// by the seeded test DB in e2e/.data — never the real scrollsurf.db.
export default defineConfig({
  testDir: 'e2e/tests',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    colorScheme: 'light',
    actionTimeout: 1000,
  },
  projects: [
    {
      name: 'chromium-mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
      timeout: 10_000,
    },
  ],
  webServer: {
    command: 'SCROLLSURF_DATA_DIR=e2e/.data next dev -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
