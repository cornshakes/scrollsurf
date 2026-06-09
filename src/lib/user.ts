import { cookies } from 'next/headers';
import { get_or_create_user } from './db';
import { COOKIE_NAME } from './cookie';

export const current_user_id = async (): Promise<number | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  return get_or_create_user(token);
};
