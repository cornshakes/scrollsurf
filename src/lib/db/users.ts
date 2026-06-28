import { get_db } from './connection';
import { INACTIVITY_DAYS } from '../cookie';

let last_cleanup = 0;

export const cleanup_inactive_users = () => {
  const cutoff = Math.floor(Date.now() / 1000) - INACTIVITY_DAYS * 86400;
  get_db().prepare('DELETE FROM tokens WHERE last_active_at < ?').run(cutoff);
};

export const get_or_create_user = (token: string): number => {
  const db = get_db();
  const now = Math.floor(Date.now() / 1000);

  // Throttled cleanup: at most once per hour, opportunistically
  if (now - last_cleanup > 3600) {
    last_cleanup = now;
    cleanup_inactive_users();
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
