import { type StatementSync } from 'node:sqlite';
import { get_db } from './connection';
import { INACTIVITY_DAYS } from '../cookie';

let last_cleanup = 0;

let stmts: {
  insert_user: StatementSync;
  touch_user: StatementSync;
  find_user: StatementSync;
  cleanup: StatementSync;
} | null = null;

const s = () => {
  if (stmts) {
    return stmts;
  }
  const db = get_db();
  stmts = {
    insert_user: db.prepare(
      'INSERT INTO users (cookie_token, created_at, last_active_at) VALUES (?, ?, ?)'
    ),
    touch_user: db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?'),
    find_user: db.prepare('SELECT id FROM users WHERE cookie_token = ?'),
    cleanup: db.prepare(
      'UPDATE users SET cookie_token = NULL WHERE last_active_at < ? AND cookie_token IS NOT NULL'
    ),
  };
  return stmts;
};

export const cleanup_inactive_users = () => {
  const cutoff = Math.floor(Date.now() / 1000) - INACTIVITY_DAYS * 86400;
  s().cleanup.run(cutoff);
};

export const get_or_create_user = (token: string): number => {
  const now = Math.floor(Date.now() / 1000);

  // Throttled cleanup: at most once per hour, opportunistically
  if (now - last_cleanup > 3600) {
    last_cleanup = now;
    cleanup_inactive_users();
  }

  const existing = s().find_user.get(token) as { id: number } | undefined;

  if (existing) {
    s().touch_user.run(now, existing.id);
    return existing.id;
  }

  const result = s().insert_user.run(token, now, now);
  return Number(result.lastInsertRowid);
};
