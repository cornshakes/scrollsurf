// Resets the e2e working DB by copying the committed seed file into place.
// Called automatically by Playwright's globalSetup before tests run.
// Run directly with `tsx e2e/fixtures/reset-test-db.ts` to reset manually.

import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export const reset_e2e_db = () => {
  const fixture_path = path.join('e2e', 'fixtures', 'scrollsurf-e2e-test.db');
  const dir_path = path.join('e2e', '.data');
  const db_path = path.join(dir_path, 'scrollsurf.db');
  mkdirSync(dir_path, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${db_path}${suffix}`, { force: true });
  }
  copyFileSync(fixture_path, db_path);
};
