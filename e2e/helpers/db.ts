import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';

interface ClickRow {
  item_id: number;
  url: string;
}

/**
 * Read the engagement `user_clicks` rows logged for the given session token,
 * straight from the seeded test DB. Opens a short-lived read-only connection —
 * WAL mode lets it see the dev server's committed writes from this process.
 */
const read_clicks_from_db = (token: string): ClickRow[] => {
  const db = new DatabaseSync(path.join('e2e', '.data', 'scrollsurf.db'), { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT c.item_id, c.url
         FROM user_clicks c
         JOIN tokens t ON t.user_id = c.user_id
         WHERE t.token = ?
         ORDER BY c.id`
      )
      .all(token) as unknown as ClickRow[];
  } finally {
    db.close();
  }
};

/**
 * Poll the seeded DB until a click logging the given followed `url` appears.
 * The click log now stores the exact href that was followed, so a test asserts
 * that the url it read off the rendered link is what got recorded.
 */
export const expect_click_in_db = async (token: string, expected_url: string, message: string) => {
  await expect
    .poll(() => read_clicks_from_db(token).some((click) => click.url === expected_url), {
      message,
      timeout: 10_000,
    })
    .toBe(true);
};

/**
 * Read a login code from the seeded test DB for the given email.
 * Opens a short-lived read-only connection — WAL mode lets it see the
 * dev server's writes. Returns null if the email has no login code.
 */
export const read_login_code = (email: string): string | null => {
  const db = new DatabaseSync(path.join('e2e', '.data', 'scrollsurf.db'), { readOnly: true });
  try {
    const row = db
      .prepare('SELECT code FROM login_codes WHERE email = ?')
      .get(email.toLowerCase()) as { code: string } | undefined;
    return row?.code ?? null;
  } finally {
    db.close();
  }
};

/**
 * Look up the email for a given session token by joining tokens → users.
 * Opens a short-lived read-only connection. Returns null if not found.
 */
export const get_email_for_token = (token: string): string | null => {
  const db = new DatabaseSync(path.join('e2e', '.data', 'scrollsurf.db'), { readOnly: true });
  try {
    const row = db
      .prepare(
        `SELECT u.email FROM tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token = ?`
      )
      .get(token) as { email: string | null } | undefined;
    return row?.email ?? null;
  } finally {
    db.close();
  }
};

/**
 * A deterministic email unique per (project, test). Both projects
 * (mobile-light/-dark) share one dev server + DB on port 3100 and tests run in
 * parallel, so the address must differ per project and per test to avoid account
 * collisions — `project.name` plus `titlePath` (which starts with the file name)
 * covers both. It must also be stable across runs (not a random UUID) so the
 * login code-step screenshot, which renders the address, needs no mask. The hash
 * keeps the local part short and fixed-length so it never wraps the dialog. The
 * host is always `e2e.com` so `delete_test_users` can purge these accounts
 * between runs. Pass a `label` when one test needs two distinct accounts.
 */
export const test_email = (label = ''): string => {
  const { project, titlePath } = test.info();
  const key = [project.name, ...titlePath].join('\0');
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 12);
  const prefix = label.length ? `${label}-` : '';
  return `${prefix}${hash}@e2e.com`;
};

/**
 * Delete every account created by `test_email` — any user whose email host is
 * `e2e.com`. `test_email` is deterministic, so these accounts persist in the
 * fixture DB across runs and a re-run would otherwise hit the unique email
 * constraint; this clears them so the suite is re-runnable without resetting the
 * DB. The `REFERENCES users(id)` FKs have no `ON DELETE CASCADE`, so the
 * dependent rows (`tokens`, `user_items`, `user_clicks`) must go first; then the
 * users; then `login_codes`, which keys on email rather than user_id.
 */
export const delete_test_users = (): void => {
  const db = new DatabaseSync(path.join('e2e', '.data', 'scrollsurf.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const test_users = "SELECT id FROM users WHERE email LIKE '%@e2e.com'";
    for (const table of ['tokens', 'user_items', 'user_clicks']) {
      db.prepare(`DELETE FROM ${table} WHERE user_id IN (${test_users})`).run();
    }
    db.prepare("DELETE FROM users WHERE email LIKE '%@e2e.com'").run();
    db.prepare("DELETE FROM login_codes WHERE email LIKE '%@e2e.com'").run();
  } finally {
    db.close();
  }
};

/**
 * Seed an account in the test DB with a given email and a liked item.
 * Opens a read/write connection (WAL mode lets the dev server see the write).
 * Looks up the item by url, creates a user with the email, then adds a like vote.
 * No token needed — `attach_login` finds the account by email at login time.
 */
export const seed_account = (email: string, liked_url: string): void => {
  const db = new DatabaseSync(path.join('e2e', '.data', 'scrollsurf.db'));
  try {
    // Wait for the dev server's WAL writer slot instead of failing immediately
    // with "database is locked" (default busy_timeout is 0).
    db.exec('PRAGMA busy_timeout = 5000');
    const now = Math.floor(Date.now() / 1000);
    const user_insert = db.prepare(
      `INSERT INTO users (email, created_at, last_active_at)
       VALUES (?, ?, ?)`
    );
    const user_result = user_insert.run(email, now, now);
    const user_id = user_result.lastInsertRowid;

    const item_row = db.prepare('SELECT id FROM items WHERE url = ?').get(liked_url) as
      { id: number } | undefined;
    if (!item_row) {
      throw new Error(`Item with url "${liked_url}" not found`);
    }

    const like_insert = db.prepare(
      `INSERT INTO user_items (user_id, item_id, like, updated_at)
       VALUES (?, ?, 1, ?)`
    );
    like_insert.run(user_id, item_row.id, now);
  } finally {
    db.close();
  }
};
