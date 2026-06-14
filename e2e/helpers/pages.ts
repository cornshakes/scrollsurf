// Shared page-object helpers used by both the integration tests (e2e/tests) and
// the preview screenshot tool (scripts/screenshot.ts), so selectors live in one
// place. The app is a single page that swaps "views" via a drawer menu; the
// toolbar auto-hides on scroll-down, so menu helpers scroll back to the top
// first.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

export type View = 'random' | 'liked' | 'disliked' | 'categories';

/**
 * Inject consent + a fresh user-id cookie so the session starts already
 * consented. The server's `current_user_id` lazily creates the user row from the
 * token, so feed/seen/vote state is isolated per test. Returns the token.
 */
export const start_consented = async (
  context: BrowserContext,
  base_url = 'http://localhost:3100'
): Promise<string> => {
  const token = randomUUID();
  await context.addCookies([
    { name: 'ss_uid', value: token, url: base_url, httpOnly: true, sameSite: 'Lax' },
    { name: 'ss_consent', value: 'granted', url: base_url, sameSite: 'Lax' },
  ]);
  return token;
};

export const cards = (page: Page): Locator => page.getByTestId('feed-card');

export const article_cards = (page: Page): Locator =>
  page.locator('[data-testid="feed-card"][data-card-type="article"]');

export const picture_cards = (page: Page): Locator =>
  page.locator('[data-testid="feed-card"][data-card-type="picture"]');

/**
 * Intercept external image requests with a consistent 400×300 gray SVG so that
 * card snapshots are stable across runs regardless of CDN state or image loading.
 * Call before any navigation.
 */
export const mock_images = async (page: Page): Promise<void> => {
  // 2:1 ratio so 326px container (390 − 2×32px padding) gives height 163px — a
  // whole number. 4:3 (400×300) gives 244.5px which flips between 244/245px
  // non-deterministically, causing snapshot height mismatches.
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">' +
      '<rect width="400" height="200" fill="#c0c0c0"/>' +
      '</svg>'
  );
  await page.route('**/*.{jpg,jpeg,png,gif,webp}', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg })
  );
};

/**
 * Return the first feed card whose heading matches `text`. The whole fixture
 * feed fits on the first page (PAGE_SIZE > fixture item count), so no scrolling
 * is needed to surface every item.
 */
export const find_card_by_heading = (page: Page, text: string | RegExp): Locator => {
  return page
    .getByTestId('feed-card')
    .filter({ has: page.getByRole('heading', { name: text }) })
    .first();
};

/** Navigate to the home feed and wait for the first card to render. */
export const goto_feed = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(cards(page).first()).toBeVisible();
};

export const scroll_feed_to_top = async (page: Page): Promise<void> => {
  await page.getByTestId('feed-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
};

/**
 * Scroll the feed container so the given card is flush with the container's
 * top edge. This ensures a deterministic, whole-pixel viewport Y position
 * before a toHaveScreenshot call — macOS sub-pixel font antialiasing is
 * position-dependent, so fractional Y from the "scroll minimally" default
 * causes pixel diffs even when card content is identical.
 */
export const scroll_card_to_top = async (page: Page, card: Locator): Promise<void> => {
  await page.evaluate(
    ([container, el]) => {
      const offset =
        (el as HTMLElement).getBoundingClientRect().top -
        (container as HTMLElement).getBoundingClientRect().top +
        (container as HTMLElement).scrollTop;
      (container as HTMLElement).scrollTop = offset;
    },
    await Promise.all([page.getByTestId('feed-scroll').elementHandle(), card.elementHandle()])
  );
};

export const open_menu = async (page: Page): Promise<void> => {
  await scroll_feed_to_top(page);
  await page.getByTestId('menu-button').click();
};

/** Open the drawer and switch to the given view, waiting for the drawer to close. */
export const switch_view = async (page: Page, view: View): Promise<void> => {
  await open_menu(page);
  const item = page.getByTestId(`view-${view}`);
  await item.click();
  // The temporary drawer unmounts on close; wait for it so it doesn't overlay.
  await item.waitFor({ state: 'hidden' });
};

export const open_consent = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Cookie consent settings' }).click();
};

/** Open the consent popover and accept; waits for the popover to close. */
export const grant_consent = async (page: Page): Promise<void> => {
  await open_consent(page);
  const accept = page.getByRole('button', { name: 'Accept', exact: true });
  await accept.click();
  await expect(accept).toBeHidden();
};

/**
 * Vote on a feed card. The article card renders the buttons twice (responsive
 * mobile/desktop), so target the visible one.
 */
export const vote_card = async (card: Locator, direction: 'up' | 'down'): Promise<void> => {
  const testid = direction === 'up' ? 'vote-up' : 'vote-down';
  await card.locator(`[data-testid="${testid}"]:visible`).click();
};

/** The title link text of an article card. */
export const article_title = async (card: Locator): Promise<string> => {
  return (await card.getByRole('heading').innerText()).trim();
};

export interface ClickRow {
  item_type: 'article' | 'picture';
  item_id: number;
  link_type: 'title' | 'by' | 'category' | 'topic' | 'dataset';
  link_label: string | null;
}

/**
 * Read the engagement `user_clicks` rows logged for the given session token,
 * straight from the seeded test DB. Opens a short-lived read-only connection —
 * WAL mode lets it see the dev server's committed writes from this process.
 */
export const read_clicks = (token: string): ClickRow[] => {
  const db = new DatabaseSync(path.join('e2e', '.data', 'scrollsurf.db'), { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT c.item_type, c.item_id, c.link_type, c.link_label
         FROM user_clicks c
         JOIN users u ON u.id = c.user_id
         WHERE u.cookie_token = ?
         ORDER BY c.id`
      )
      .all(token) as unknown as ClickRow[];
  } finally {
    db.close();
  }
};

/**
 * Block real navigation to Wikipedia/Commons (target="_blank" link follows open
 * a popup) so link-click tests stay offline and fast; auto-close any popup.
 */
export const stub_external_navigation = async (page: Page): Promise<void> => {
  await page
    .context()
    .route(/wikipedia\.org|wikimedia\.org/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' })
    );
  page.on('popup', (popup) => {
    popup.close().catch(() => {});
  });
};
