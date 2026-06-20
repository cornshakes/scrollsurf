'use server';

import { cookies } from 'next/headers';
import {
  get_next_feed,
  save_vote,
  record_click,
  get_voted_items,
  get_category_tree,
  get_or_create_user,
  type FeedItem,
  type CategoryTree,
  type LinkType,
} from '@/lib/db';
import { current_user_id } from '@/lib/user';
import { COOKIE_NAME, CONSENT_COOKIE, cookie_options, consent_cookie_options } from '@/lib/cookie';

export const get_next_feed_items = async (count: number): Promise<FeedItem[]> => {
  const uid = await current_user_id();
  return get_next_feed(count, uid);
};

export const vote_feed_item = async (id: number, value: -1 | 0 | 1) => {
  const uid = await current_user_id();
  if (uid === null) {
    return;
  }
  save_vote(uid, id, value);
};

export const record_link_click = async (
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
};

export const get_voted_feed_items = async (vote: -1 | 1): Promise<FeedItem[]> => {
  const uid = await current_user_id();
  if (uid === null) {
    return [];
  }
  return get_voted_items(vote, uid);
};

export const get_wiki_category_tree = async (): Promise<CategoryTree> => {
  // Categories are a local-dev-only tool; never expose the tree in deploys.
  if (process.env.NODE_ENV !== 'development') {
    return [];
  }
  const uid = await current_user_id();
  return get_category_tree(uid);
};

export const grant_consent = async () => {
  const store = await cookies();
  store.set(CONSENT_COOKIE, 'granted', consent_cookie_options());
  const token = crypto.randomUUID();
  store.set(COOKIE_NAME, token, cookie_options());
  get_or_create_user(token);
};

export const revoke_consent = async () => {
  const store = await cookies();
  store.set(CONSENT_COOKIE, 'denied', consent_cookie_options());
  store.delete(COOKIE_NAME);
};
