'use server';

import { cookies, headers } from 'next/headers';
import {
  get_next_feed,
  save_vote,
  record_click,
  get_voted_items,
  get_category_tree,
  get_or_create_user,
  delete_token,
  create_login_code,
  verify_login_code,
  get_user_email,
  unlink_email,
  attach_login,
  type FeedItem,
  type CategoryTree,
  type LinkType,
} from '@/lib/db';
import { current_user_id } from '@/lib/user';
import { COOKIE_NAME, CONSENT_COOKIE, cookie_options, consent_cookie_options } from '@/lib/cookie';
import { send_login_code } from '@/lib/email';
import { rate_limit } from '@/lib/rate-limit';
import { with_log } from '@/lib/log';

// Rejects whitespace (so no CR/LF header injection into the SMTP `to:` field)
// and requires a dotted domain — `a@b` and `x@y\nbcc:` don't pass.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const get_next_feed_items = with_log(
  'get_next_feed_items',
  async (count: number): Promise<FeedItem[]> => {
    const uid = await current_user_id();
    return get_next_feed(count, uid);
  }
);

export const vote_feed_item = with_log('vote_feed_item', async (id: number, value: -1 | 0 | 1) => {
  const uid = await current_user_id();
  if (uid === null) {
    return;
  }
  save_vote(uid, id, value);
});

export const record_link_click = with_log(
  'record_link_click',
  async (
    type: 'article' | 'picture' | 'quote',
    id: number,
    link_type: LinkType,
    link_label?: string
  ) => {
    const uid = await current_user_id();
    if (uid === null) {
      return;
    }
    record_click(type, id, link_type, link_label ?? null, uid);
  }
);

export const get_voted_feed_items = with_log(
  'get_voted_feed_items',
  async (vote: -1 | 1): Promise<FeedItem[]> => {
    const uid = await current_user_id();
    if (uid === null) {
      return [];
    }
    return get_voted_items(vote, uid);
  }
);

export const get_wiki_category_tree = with_log(
  'get_wiki_category_tree',
  async (): Promise<CategoryTree> => {
    // Categories are a local-dev-only tool; never expose the tree in deploys.
    if (process.env.NODE_ENV !== 'development') {
      return [];
    }
    const uid = await current_user_id();
    return get_category_tree(uid);
  }
);

export const grant_consent = with_log('grant_consent', async () => {
  const store = await cookies();
  store.set(CONSENT_COOKIE, 'granted', consent_cookie_options());
  const token = crypto.randomUUID();
  store.set(COOKIE_NAME, token, cookie_options());
  get_or_create_user(token);
});

export const revoke_consent = with_log('revoke_consent', async () => {
  const store = await cookies();
  const uid = await current_user_id();
  if (uid !== null && get_user_email(uid) !== null) {
    unlink_email(uid);
  }
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    delete_token(token);
  }
  store.set(CONSENT_COOKIE, 'denied', consent_cookie_options());
  store.delete(COOKIE_NAME);
});

export const request_login_code = with_log(
  'request_login_code',
  async ({ email }: { email: string }): Promise<{ ok: boolean; error?: string }> => {
    if (!EMAIL_RE.test(email.trim())) {
      return { ok: false, error: 'Invalid email' };
    }
    // Throttle outbound mail so the endpoint can't be used as a spam relay /
    // mail bomb: per-client (best-effort via forwarded IP) and a global ceiling.
    // this throttles logins globally to 50 per ten minutes
    const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!rate_limit(`login_ip:${ip}`, 5, 600) || !rate_limit('login_global', 50, 600)) {
      return { ok: false, error: 'Please wait before requesting another code' };
    }
    try {
      const code = create_login_code(email);
      await send_login_code(email, code);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'rate_limit') {
        return { ok: false, error: 'Please wait before requesting another code' };
      }
      return { ok: false, error: 'Failed to send code' };
    }
    return { ok: true };
  }
);

export const submit_login_code = with_log(
  'submit_login_code',
  async ({
    email,
    code,
  }: {
    email: string;
    code: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    const valid = verify_login_code(email, code);
    if (!valid) {
      return { ok: false, error: 'Invalid or expired code' };
    }
    const store = await cookies();
    const current_token = store.get(COOKIE_NAME)?.value ?? null;
    const token = attach_login(email, current_token, crypto.randomUUID());
    store.set(COOKIE_NAME, token, cookie_options());
    store.set(CONSENT_COOKIE, 'granted', consent_cookie_options());
    return { ok: true };
  }
);

export const logout = with_log('logout', async (): Promise<void> => {
  const store = await cookies();
  // Invalidate the existing browser token server-side so the old cookie value
  // can never be reused to resolve back to the account.
  const old_token = store.get(COOKIE_NAME)?.value;
  if (old_token) {
    delete_token(old_token);
  }
  const token = crypto.randomUUID();
  store.set(COOKIE_NAME, token, cookie_options());
  get_or_create_user(token);
});

export const get_current_account = with_log(
  'get_current_account',
  async (): Promise<{ email: string } | null> => {
    const uid = await current_user_id();
    if (uid === null) {
      return null;
    }
    const email = get_user_email(uid);
    if (email === null) {
      return null;
    }
    return { email };
  }
);
