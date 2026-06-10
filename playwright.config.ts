import { defineConfig, devices } from '@playwright/test';

// Integration tests run against a dev server on a dedicated port (3100) backed
// by the seeded test DB in e2e/.data — never the real scrollsurf.db.
export default defineConfig({
  testDir: 'e2e/tests',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Sub-pixel font AA on macOS/Chromium renders glyph edges non-deterministically
      // across browser sessions (~1% of pixels differ by >20% YIQ). This tolerance
      // covers that noise while still catching any real layout/color regression.
      maxDiffPixelRatio: 0.02,
    },
  },
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    actionTimeout: 3_000,
    colorScheme: 'light',
  },
  projects: [
    {
      name: 'chromium-mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'SCROLLSURF_DATA_DIR=e2e/.data next dev -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
