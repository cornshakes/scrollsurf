import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Startup (import_topic_buckets) loads the bucket mapping from
// SCROLLSURF_DATA_DIR/datasets/topic_buckets.db and fails loudly if any seeded
// (dataset, topic) pair is unmapped. Playwright boots the webServer *before*
// globalSetup runs, so mirror the real mapping into the e2e data dir here in
// the config — the earliest hook — to keep it in sync on every run.
const copy_topic_buckets = () => {
  const src = path.join('datasets', 'topic_buckets.db');
  if (!existsSync(src)) {
    throw new Error(`missing reference DB: ${src} (build it with npm run unify-topics)`);
  }
  const dest_dir = path.join('e2e', '.data', 'datasets');
  mkdirSync(dest_dir, { recursive: true });
  copyFileSync(src, path.join(dest_dir, 'topic_buckets.db'));
};
copy_topic_buckets();

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
    actionTimeout: 1000,
  },
  projects: [
    {
      name: 'mobile-light',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        colorScheme: 'light',
      },
      timeout: 10_000,
    },
    {
      name: 'mobile-dark',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        colorScheme: 'dark',
      },
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
