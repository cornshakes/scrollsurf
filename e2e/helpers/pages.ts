import { randomUUID } from 'node:crypto';
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
) => {
  const token = randomUUID();
  await context.addCookies([
    { name: 'ss_uid', value: token, url: base_url, httpOnly: true, sameSite: 'Lax' },
    { name: 'ss_consent', value: 'granted', url: base_url, sameSite: 'Lax' },
  ]);
  return token;
};

/**
 * Block real navigation to Wikipedia/Commons (target="_blank" link follows open
 * a popup) so link-click tests stay offline and fast; auto-close any popup.
 */
export const stub_external_navigation = async (page: Page) => {
  await page
    .context()
    .route(/wikipedia\.org|wikimedia\.org/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' })
    );
  page.on('popup', (popup) => {
    popup.close().catch(() => {});
  });
};

/**
 * Intercept image requests with a consistent 400×300 gray SVG so that
 * card snapshots are stable across runs.
 */
const mock_images = async (page: Page) => {
  // 2:1 ratio so 326px container (390 − 2×32px padding) gives height 163px — a
  // whole number. 4:3 (400×300) gives 244.5px which flips between 244/245px
  // non-deterministically, causing snapshot height mismatches.
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">' +
      '<rect width="400" height="200" fill="#c0c0c0"/>' +
      '</svg>'
  );
  // Match the image extension whether the URL ends there or carries a query
  // string — quote author thumbnails come from the pageimages API with trailing
  // `?utm_source=…` tracking params that a `*.jpg` glob would miss.
  await page.route(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i, (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg })
  );
};

/** Navigate to the home feed and wait for the first 10 cards to render. */
export const load_page = async (page: Page, cookie_consent = false) => {
  await mock_images(page);
  await stub_external_navigation(page);
  let token: string | undefined = undefined;
  if (cookie_consent) {
    token = await start_consented(page.context());
  }
  await page.goto('/');
  await expect(page.getByTestId('feed-card').nth(9)).toBeVisible();
  return token;
};

export const article_cards = (page: Page): Locator =>
  page.locator('[data-testid="feed-card"][data-card-type="article"]');

export const picture_cards = (page: Page): Locator =>
  page.locator('[data-testid="feed-card"][data-card-type="picture"]');

export const find_card_by_text = (page: Page, text: string): Locator => {
  return page.locator('[data-testid="feed-card"]').filter({ hasText: text }).first();
};

export const get_card_titles = async (page: Page) => {
  const cards = await page.getByTestId('feed-card').all();
  return await Promise.all(cards.map((card) => card.getAttribute('data-item-title')));
};

export const open_menu = async (page: Page) => {
  // scroll up to make button appear, then click
  await page
    .getByTestId('feed-scroll')
    .evaluate((el) => el.scrollBy({ behavior: 'instant', top: -1 }));
  await page.getByTestId('menu-button').click();
};

export const screenshot_card = async (page: Page, hasText: string, screenshot_title: string) => {
  await remove_buttons_and_commit_id(page);
  await remove_other_cards(page, hasText);
  const card = page.locator('[data-testid="feed-card"]').filter({ hasText }).first();
  await expect(card).toHaveScreenshot(`${screenshot_title}.png`);
};

const remove_buttons_and_commit_id = async (page: Page) => {
  await page.getByTestId('commit-id').evaluate((e) => e.remove());
  await page.getByTestId('cookie-button').evaluate((e) => e.remove());
  await page.getByTestId('menu-button').evaluate((e) => e.remove());
};

export const remove_all_cards = async (page: Page) => {
  const all_cards = await page.locator('[data-testid="feed-card"]').all();
  await Promise.all(all_cards.map((c) => c.evaluate((e) => e.remove())));
};

const remove_other_cards = async (page: Page, hasText: string) => {
  const other_cards = await page
    .locator('[data-testid="feed-card"]')
    .filter({ hasNotText: hasText })
    .all();

  await Promise.all(other_cards.map((c) => c.evaluate((e) => e.remove())));
};

export const scroll_to_load_all = async (page: Page) => {
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('feed-sentinel').scrollIntoViewIfNeeded();
    if ((await page.getByTestId('feed-card').count()) === 14) {
      return;
    }
  }
  await expect(page.getByTestId('feed-card')).toHaveCount(14);
};

export const switch_view = async (page: Page, view: View) => {
  await open_menu(page);
  const item = page.getByTestId(`view-${view}`);
  await item.click();
  await item.waitFor({ state: 'hidden' });
};

/**
 * Vote on a feed card. The article card renders the buttons twice (responsive
 * mobile/desktop), so target the visible one.
 */
export const vote_card = async (card: Locator, direction: 'up' | 'down') => {
  await card.locator(`[data-testid="vote-${direction}"]:visible`).click();
};

/** The title link text of an article card. */
export const article_title = async (card: Locator) => {
  return (await card.getByRole('heading').innerText()).trim();
};
