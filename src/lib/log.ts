import { headers } from 'next/headers';
import pino from 'pino';
import { current_user_id } from './user';

const is_development = process.env.NODE_ENV === 'development';
const is_test = process.env.NODE_ENV === 'test';

// Pretty, human-readable output in dev; structured JSON to stdout everywhere else
// (production + tests). The pino-pretty transport spins up a worker thread, so we keep
// it out of prod/test to avoid the overhead and any bundling surprises.
const transport = is_development
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
  : undefined;

export const log = pino({
  level: is_test ? 'silent' : is_development ? 'debug' : 'info',
  // Never let PII / secrets reach the logs. Covers both top-level and nested occurrences
  // of the login email and 6-digit code.
  redact: {
    paths: ['email', 'code', '*.email', '*.code', 'args[*].email', 'args[*].code'],
    censor: '###',
  },
  transport,
});

/**
 * Best-effort client identity (remote IP, user agent, user id) from the request.
 * Returns an empty object if called outside a request context (headers() throws).
 */
const request_meta = async (): Promise<{
  ip?: string;
  user_agent?: string;
  user_id?: number;
}> => {
  try {
    const header_list = await headers();
    const ip = header_list.get('x-forwarded-for')?.split(',')[0]?.trim();
    const user_agent = header_list.get('user-agent') ?? undefined;
    const user_id = (await current_user_id()) ?? undefined;
    return { ip: ip || undefined, user_agent, user_id };
  } catch {
    return {};
  }
};

/**
 * Wraps server actions to log each one after success/error
 */
export const with_log = <Args extends unknown[], Result>(
  action: string,
  fn: (...args: Args) => Promise<Result>
): ((...args: Args) => Promise<Result>) => {
  return async (...args: Args): Promise<Result> => {
    const started = performance.now();
    const meta = await request_meta();
    try {
      const result = await fn(...args);
      const ms = Math.round(performance.now() - started);
      log.info({ action, ms, ...meta, args, result: 'ok' });
      return result;
    } catch (error) {
      const ms = Math.round(performance.now() - started);
      log.error({ action, ms, ...meta, args, error });
      throw error;
    }
  };
};
