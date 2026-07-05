import { get_db } from './connection';
import { cleanup_expired_login_codes } from './auth';
import { INACTIVITY_DAYS } from '../cookie';

let last_cleanup = 0;

export const cleanup_inactive_users = () => {
  const cutoff = Math.floor(Date.now() / 1000) - INACTIVITY_DAYS * 86400;
  get_db().prepare('DELETE FROM tokens WHERE last_active_at < ?').run(cutoff);
};

// Invalidate a single browser token server-side (logout / revoke). The user row
// and its history survive; only this token stops resolving to the account.
export const delete_token = (token: string): void => {
  get_db().prepare('DELETE FROM tokens WHERE token = ?').run(token);
};

// Erase a user and everything tied to them. Foreign keys are ON with no
// ON DELETE CASCADE, so child rows must go before the users row, in this order.
export const delete_user_and_data = (user_id: number): void => {
  const db = get_db();
  db.prepare('DELETE FROM user_items WHERE user_id = ?').run(user_id);
  db.prepare('DELETE FROM user_clicks WHERE user_id = ?').run(user_id);
  db.prepare('DELETE FROM tokens WHERE user_id = ?').run(user_id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user_id);
};

export interface UserDataExport {
  exported_at: string;
  user_email: string | null;
  clicked: { url: string; clicked_at: string }[];
  liked: { url: string; liked_at: string | null }[];
  disliked: { url: string; disliked_at: string | null }[];
  seen: { url: string; seen_at: string | null }[];
}

const format_date = (epoch_seconds: number): string => {
  return new Date(epoch_seconds * 1000).toISOString();
};

// Dump everything stored about a user for self-service download
export const export_user_data = (user_id: number): UserDataExport => {
  const db = get_db();

  const account_row = db.prepare('SELECT email FROM users WHERE id = ?').get(user_id) as
    { email: string | null } | undefined;

  // Every served item lands in user_items (like defaults to 0 = seen only),
  // so this covers seen plus the liked/disliked subsets in one pass.
  const item_rows = db
    .prepare(
      `SELECT i.url AS url, ui.like AS like, ui.updated_at AS updated_at
      FROM user_items ui
      JOIN items i ON i.id = ui.item_id
      WHERE ui.user_id = ?
      ORDER BY ui.updated_at DESC, ui.item_id DESC`
    )
    .all(user_id) as { url: string; like: number; updated_at: number }[];

  const click_rows = db
    .prepare(
      `SELECT uc.url AS url, uc.created_at AS created_at
      FROM user_clicks uc
      WHERE uc.user_id = ?
      ORDER BY uc.created_at DESC, uc.id DESC`
    )
    .all(user_id) as { url: string; created_at: number }[];

  return {
    exported_at: format_date(Math.floor(Date.now() / 1000)),
    user_email: account_row ? account_row.email : null,
    clicked: click_rows.map((row) => ({
      url: row.url,
      clicked_at: format_date(row.created_at),
    })),
    liked: item_rows
      .filter((row) => row.like === 1)
      .map((row) => ({ url: row.url, liked_at: format_date(row.updated_at) })),
    disliked: item_rows
      .filter((row) => row.like === -1)
      .map((row) => ({ url: row.url, disliked_at: format_date(row.updated_at) })),
    seen: item_rows.map((row) => ({ url: row.url, seen_at: format_date(row.updated_at) })),
  };
};

export const get_or_create_user = (token: string): number => {
  const db = get_db();
  const now = Math.floor(Date.now() / 1000);

  // Throttled cleanup: at most once per hour, opportunistically
  if (now - last_cleanup > 3600) {
    last_cleanup = now;
    cleanup_inactive_users();
    cleanup_expired_login_codes();
  }

  const existing = db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(token) as
    { user_id: number } | undefined;

  if (existing) {
    db.prepare('UPDATE tokens SET last_active_at = ? WHERE token = ?').run(now, token);
    db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now, existing.user_id);
    return existing.user_id;
  }

  const result = db
    .prepare('INSERT INTO users (created_at, last_active_at) VALUES (?, ?)')
    .run(now, now);
  const user_id = Number(result.lastInsertRowid);
  db.prepare(
    'INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)'
  ).run(token, user_id, now, now);
  return user_id;
};
