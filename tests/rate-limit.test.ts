import { rate_limit } from '@/lib/rate-limit';

describe('rate_limit', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('allows up to `max` calls then blocks within the window', () => {
    const key = `k-${Math.random()}`;
    expect(rate_limit(key, 3, 600)).toBe(true);
    expect(rate_limit(key, 3, 600)).toBe(true);
    expect(rate_limit(key, 3, 600)).toBe(true);
    expect(rate_limit(key, 3, 600)).toBe(false);
  });

  test('resets after the window elapses', () => {
    const key = `k-${Math.random()}`;
    expect(rate_limit(key, 1, 600)).toBe(true);
    expect(rate_limit(key, 1, 600)).toBe(false);

    jest.setSystemTime(new Date('2024-06-01T00:10:01Z')); // > 600s later
    expect(rate_limit(key, 1, 600)).toBe(true);
  });

  test('tracks distinct keys independently', () => {
    const key_a = `a-${Math.random()}`;
    const key_b = `b-${Math.random()}`;
    expect(rate_limit(key_a, 1, 600)).toBe(true);
    expect(rate_limit(key_a, 1, 600)).toBe(false);
    // key_b has its own budget
    expect(rate_limit(key_b, 1, 600)).toBe(true);
  });
});
