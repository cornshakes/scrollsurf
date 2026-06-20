import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';

interface ClickRow {
  item_type: 'article' | 'picture' | 'quote';
  item_id: number;
  link_type: 'title' | 'by' | 'category' | 'topic' | 'dataset';
  link_label: string | null;
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
        `SELECT c.item_type, c.item_id, c.link_type, c.link_label
         FROM user_clicks c
         JOIN users u ON u.id = c.user_id
         WHERE u.cookie_token = ?
         ORDER BY c.id`
      )
      .all(token) as unknown as ClickRow[];
  } finally {
    db.close();
  }
};

/**
 * Poll the seeded DB until a logged click row matches the expected fields. When
 * `link_label` is given it's compared with whitespace normalized (rendered link
 * text collapses whitespace; the stored label keeps the source's raw spacing).
 */
export const expect_click_in_db = async (
  token: string,
  expected: {
    item_type: ClickRow['item_type'];
    link_type: ClickRow['link_type'];
    link_label?: string;
  },
  message: string
) => {
  const match = (c: ClickRow) =>
    c.item_type === expected.item_type &&
    c.link_type === expected.link_type &&
    (expected.link_label === undefined || norm(c.link_label) === norm(expected.link_label));
  await expect
    .poll(() => read_clicks_from_db(token).some(match), { message, timeout: 10_000 })
    .toBe(true);
};

const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
