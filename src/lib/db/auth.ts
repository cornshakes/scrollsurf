/**
 * Passwordless, code-only email auth.
 *
 * Login flow: enter email → {@link create_login_code} upserts a single-use
 * 6-digit code (15-min expiry, 60s resend rate-limit) into `login_codes` →
 * the code is emailed → {@link verify_login_code} checks and deletes it →
 * {@link attach_login} binds the browser token to the (existing or new) account.
 *
 * {@link attach_login} resolves the current browser token and the account
 * matched by email into one of several cases (already-this-account, anon→account
 * merge, account switch, no-token, first-login-promote, first-login-fresh). The
 * subtle case is the **anon → account merge** ({@link merge_anon_to_account}):
 * account votes are authoritative on conflict while anon-only votes are adopted,
 * append-only clicks are carried over (added, never replacing the account's), all
 * of the anon identity's tokens are repointed, and the anon user row is deleted.
 *
 * {@link unlink_email} (revoke consent) clears the email only — account history
 * survives but is no longer recoverable by email re-login.
 */
import { webcrypto } from 'node:crypto';
import { get_db } from './connection';

// A login code is single-use; cap wrong guesses before it's invalidated so a
// 6-digit code (10^6 space, 15-min life) can't be brute-forced.
const MAX_LOGIN_CODE_ATTEMPTS = 5;

const normalize_email = (email: string): string => email.trim().toLowerCase();

const generate_code = (): string => {
  const buf = new Uint32Array(1);
  webcrypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, '0');
};

export const create_login_code = (email: string): string => {
  const db = get_db();
  const normalized = normalize_email(email);
  const now = Math.floor(Date.now() / 1000);

  const existing = db
    .prepare('SELECT created_at FROM login_codes WHERE email = ?')
    .get(normalized) as { created_at: number } | undefined;
  if (existing && existing.created_at > now - 60) {
    throw new Error('rate_limit');
  }

  const code = generate_code();
  const expires_at = now + 15 * 60;
  db.prepare(
    `INSERT INTO login_codes (email, code, expires_at, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, created_at = excluded.created_at, attempts = 0`
  ).run(normalized, code, expires_at, now);
  return code;
};

export const verify_login_code = (email: string, code: string): boolean => {
  const db = get_db();
  const normalized = normalize_email(email);
  const now = Math.floor(Date.now() / 1000);

  const row = db
    .prepare('SELECT code, expires_at, attempts FROM login_codes WHERE email = ?')
    .get(normalized) as { code: string; expires_at: number; attempts: number } | undefined;

  // Expired, already exhausted, or absent → invalidate and reject.
  if (!row || row.expires_at <= now || row.attempts >= MAX_LOGIN_CODE_ATTEMPTS) {
    if (row) {
      db.prepare('DELETE FROM login_codes WHERE email = ?').run(normalized);
    }
    return false;
  }

  if (row.code !== code) {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_LOGIN_CODE_ATTEMPTS) {
      // Out of guesses — burn the code so a fresh one must be requested.
      db.prepare('DELETE FROM login_codes WHERE email = ?').run(normalized);
    } else {
      db.prepare('UPDATE login_codes SET attempts = ? WHERE email = ?').run(attempts, normalized);
    }
    return false;
  }

  db.prepare('DELETE FROM login_codes WHERE email = ?').run(normalized);
  return true;
};

// Expired/abandoned codes are otherwise only cleared on success or on the next
// upsert for the same email, so a flood of distinct addresses would grow the
// table without bound. Swept periodically alongside inactive-user cleanup.
export const cleanup_expired_login_codes = (): void => {
  const now = Math.floor(Date.now() / 1000);
  get_db().prepare('DELETE FROM login_codes WHERE expires_at < ?').run(now);
};

export const get_user_email = (user_id: number): string | null => {
  const db = get_db();
  const row = db.prepare('SELECT email FROM users WHERE id = ?').get(user_id) as
    { email: string | null } | undefined;
  return row?.email ?? null;
};

export const unlink_email = (user_id: number): void => {
  get_db().prepare('UPDATE users SET email = NULL WHERE id = ?').run(user_id);
};

/**
 * Fold an anonymous identity into an account, then delete the anon user row.
 *
 * - Votes: account wins on conflict (`DO NOTHING`); anon-only votes are adopted.
 * - Clicks: append-only, so they're relabeled to the account — the account's
 *   existing clicks are preserved and the anon clicks are *added*, not replaced.
 * - Tokens: every token of the anon identity is repointed to the account.
 *
 * Caller owns the transaction.
 */
const merge_anon_to_account = (
  db: ReturnType<typeof get_db>,
  current_uid: number,
  account_uid: number
): void => {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO user_items (user_id, item_id, like, updated_at)
     SELECT ?, item_id, like, updated_at FROM user_items WHERE user_id = ?
     ON CONFLICT(user_id, item_id) DO NOTHING`
  ).run(account_uid, current_uid);
  db.prepare('UPDATE user_clicks SET user_id = ? WHERE user_id = ?').run(account_uid, current_uid);
  db.prepare('UPDATE tokens SET user_id = ? WHERE user_id = ?').run(account_uid, current_uid);
  db.prepare('DELETE FROM user_items WHERE user_id = ?').run(current_uid);
  db.prepare('DELETE FROM users WHERE id = ?').run(current_uid);
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now, account_uid);
};

export const attach_login = (
  email: string,
  current_token: string | null,
  new_token: string
): string => {
  const db = get_db();
  const normalized = normalize_email(email);
  const now = Math.floor(Date.now() / 1000);

  db.exec('BEGIN IMMEDIATE');
  try {
    const current_token_row =
      current_token !== null
        ? (db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(current_token) as
            { user_id: number } | undefined)
        : undefined;
    const current_uid = current_token_row?.user_id ?? null;

    const current_user =
      current_uid !== null
        ? (db.prepare('SELECT email FROM users WHERE id = ?').get(current_uid) as
            { email: string | null } | undefined)
        : undefined;
    const current_email = current_user?.email ?? null;

    const account_row = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized) as
      { id: number } | undefined;
    const account_uid = account_row?.id ?? null;

    let result_token: string;

    if (account_uid !== null) {
      if (current_uid !== null && current_uid === account_uid) {
        // Already this account
        result_token = current_token as string;
      } else if (current_uid !== null && current_email === null) {
        // Merge anon → account
        merge_anon_to_account(db, current_uid, account_uid);
        result_token = current_token as string;
      } else if (current_uid !== null && current_email !== null) {
        // Switch accounts: repoint only this browser's token
        db.prepare('UPDATE tokens SET user_id = ? WHERE token = ?').run(account_uid, current_token);
        result_token = current_token as string;
      } else {
        // No current token: create new token for existing account
        db.prepare(
          'INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)'
        ).run(new_token, account_uid, now, now);
        result_token = new_token;
      }
    } else {
      if (current_uid !== null && current_email === null) {
        // First login – promote anonymous user
        db.prepare('UPDATE users SET email = ? WHERE id = ?').run(normalized, current_uid);
        result_token = current_token as string;
      } else {
        // First login – fresh: create new user + token
        const insert_result = db
          .prepare('INSERT INTO users (email, created_at, last_active_at) VALUES (?, ?, ?)')
          .run(normalized, now, now);
        const new_user_id = Number(insert_result.lastInsertRowid);
        db.prepare(
          'INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)'
        ).run(new_token, new_user_id, now, now);
        result_token = new_token;
      }
    }

    db.exec('COMMIT');
    return result_token;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw err;
  }
};
