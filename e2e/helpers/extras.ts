import { type Page } from '@playwright/test';
import { get_user_for_token } from './db';
import { get_cookies } from './pages';

export type View = 'random' | 'liked' | 'disliked' | 'categories';

export const get_current_user = async (page: Page) => {
  const cookies = await get_cookies(page);
  if (!cookies.uid) {
    throw new Error('No uid cookie: no user!');
  }
  const user = get_user_for_token(cookies.uid);
  if (!user) {
    throw new Error('no user found for uid: ' + cookies.uid);
  }
  return user;
};
