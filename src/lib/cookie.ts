// INACTIVITY_DAYS drives both the DB sever cutoff and the browser cookie Max-Age.
// Browser eviction varies: Chrome/Firefox honor Max-Age (up to ~400d cap); Safari/ITP
// purges site storage after ~7d of inactivity regardless. Real retention is
// min(this, ~7d) on Safari, ~this elsewhere.
export const INACTIVITY_DAYS = Number(process.env.USER_INACTIVITY_DAYS ?? 14);
export const COOKIE_NAME = 'ss_uid';
export const COOKIE_MAX_AGE = INACTIVITY_DAYS * 24 * 60 * 60;

export const cookie_options = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: COOKIE_MAX_AGE, // no `secure` yet
});

// Consent cookie — records the user's choice. Not httpOnly so the client can
// read it to decide whether to show the consent icon/prompt.
export const CONSENT_COOKIE = 'ss_consent';
export const CONSENT_MAX_AGE = 180 * 24 * 60 * 60; // 180 days

export const consent_cookie_options = () => ({
  httpOnly: false,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: CONSENT_MAX_AGE,
});
