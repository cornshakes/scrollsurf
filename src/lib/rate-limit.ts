// In-memory fixed-window rate limiter. Adequate for the single standalone
// process this app deploys as; counters reset on restart and are not shared
// across instances (test/prod each track their own).

type window = { count: number; reset_at: number };

const windows = new Map<string, window>();

// Drop expired windows opportunistically so the map can't grow without bound
// under a flood of distinct keys (e.g. one key per attacker-supplied email).
const prune = (now: number): void => {
  for (const [key, value] of windows) {
    if (value.reset_at <= now) {
      windows.delete(key);
    }
  }
};

/**
 * Returns true if the action is allowed for `key`, false if the limit is hit.
 * Allows up to `max` calls per `window_seconds` per key.
 */
export const rate_limit = (key: string, max: number, window_seconds: number): boolean => {
  if (process.env.NODE_ENV === 'development') {
    return true;
  }
  const now = Date.now();
  if (windows.size > 10_000) {
    prune(now);
  }

  const existing = windows.get(key);
  if (!existing || existing.reset_at <= now) {
    windows.set(key, { count: 1, reset_at: now + window_seconds * 1000 });
    return true;
  }
  if (existing.count >= max) {
    return false;
  }
  existing.count += 1;
  return true;
};
