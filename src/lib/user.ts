import { cookies } from 'next/headers';
import { get_or_create_user } from './db';
import { COOKIE_NAME, cookie_options } from './cookie';

export const current_user_id = async (): Promise<number> => {
  const store = await cookies();
  let token = store.get(COOKIE_NAME)?.value;
  if (!token) {
    // Defensive: proxy normally sets the cookie before the action is reached.
    // Create one here as a fallback so we always have a valid user.
    token = crypto.randomUUID();
    store.set(COOKIE_NAME, token, cookie_options());
  }
  return get_or_create_user(token);
};
