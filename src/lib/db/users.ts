import { get_db } from './connection';
import { INACTIVITY_DAYS } from '../cookie';

let last_cleanup = 0;

const INSERT_USER_SQL =
  'INSERT INTO users (cookie_token, created_at, last_active_at) VALUES (?, ?, ?)';
const TOUCH_USER_SQL = 'UPDATE users SET last_active_at = ? WHERE id = ?';
const FIND_USER_SQL = 'SELECT id FROM users WHERE cookie_token = ?';
const CLEANUP_SQL =
  'UPDATE users SET cookie_token = NULL WHERE last_active_at < ? AND cookie_token IS NOT NULL';

export const cleanup_inactive_users = () => {
  const cutoff = Math.floor(Date.now() / 1000) - INACTIVITY_DAYS * 86400;
  get_db().prepare(CLEANUP_SQL).run(cutoff);
};

export const get_or_create_user = (token: string): number => {
  const db = get_db();
  const now = Math.floor(Date.now() / 1000);

  // Throttled cleanup: at most once per hour, opportunistically
  if (now - last_cleanup > 3600) {
    last_cleanup = now;
    cleanup_inactive_users();
  }

  const existing = db.prepare(FIND_USER_SQL).get(token) as { id: number } | undefined;

  if (existing) {
    db.prepare(TOUCH_USER_SQL).run(now, existing.id);
    return existing.id;
  }

  const result = db.prepare(INSERT_USER_SQL).run(token, now, now);
  return Number(result.lastInsertRowid);
};
