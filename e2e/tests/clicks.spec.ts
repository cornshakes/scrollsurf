import { test, expect } from '@playwright/test';
import {
  article_cards,
  goto_feed,
  mock_images,
  picture_cards,
  read_clicks,
  scroll_to_load_all,
  start_consented,
  stub_external_navigation,
  type ClickRow,
} from '../helpers/pages';

const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Poll the seeded DB until a logged click row matches the expected fields. When
 * `link_label` is given it's compared with whitespace normalized (rendered link
 * text collapses whitespace; the stored label keeps the source's raw spacing).
 */
const expect_click = async (
  token: string,
  expected: {
    item_type: ClickRow['item_type'];
    link_type: ClickRow['link_type'];
    link_label?: string;
  },
  message: string
) => {
  const match = (c: ClickRow) =>
    c.item_type === expected.item_type &&
    c.link_type === expected.link_type &&
    (expected.link_label === undefined || norm(c.link_label) === norm(expected.link_label));
  await expect.poll(() => read_clicks(token).some(match), { message, timeout: 10_000 }).toBe(true);
};

test('every article link click is recorded', async ({ page, context }) => {
  const token = await start_consented(context);
  await mock_images(page);
  await stub_external_navigation(page);
  await goto_feed(page);
  await scroll_to_load_all(page);

  // title — the article heading link; label is the title text.
  const title_link = article_cards(page).first().getByTestId('link-title');
  const title = (await title_link.innerText()).trim();
  await title_link.click();
  await expect_click(
    token,
    { item_type: 'article', link_type: 'title', link_label: title },
    `title click for "${title}"`
  );

  // dataset / topic / category chips — label is the chip text.
  for (const link_type of ['dataset', 'topic', 'category'] as const) {
    const chip = page
      .locator(`[data-card-type="article"] [data-testid="link-${link_type}"]`)
      .first();
    const label = (await chip.innerText()).trim();
    await chip.click();
    await expect_click(
      token,
      { item_type: 'article', link_type, link_label: label },
      `${link_type} click for "${label}"`
    );
  }
});

test('every picture link click is recorded', async ({ page, context }) => {
  const token = await start_consented(context);
  await mock_images(page);
  await stub_external_navigation(page);
  await goto_feed(page);
  await scroll_to_load_all(page);

  // title — the image link (no text, so assert on type only).
  await picture_cards(page).first().getByTestId('link-title').click();
  await expect_click(
    token,
    { item_type: 'picture', link_type: 'title' },
    'picture image (title) click'
  );

  // by — the credit link; label is the credit name.
  const by_link = page.locator('[data-card-type="picture"] [data-testid="link-by"]').first();
  const credit = (await by_link.innerText()).trim();
  await by_link.click();
  await expect_click(
    token,
    { item_type: 'picture', link_type: 'by', link_label: credit },
    `picture credit (by) click for "${credit}"`
  );
});

test('without consent, following a link fires no request', async ({ page }) => {
  // No start_consented → no consent cookie. The client guard must skip the
  // server action entirely, so no POST to the app should occur on a link click.
  await mock_images(page);
  await stub_external_navigation(page);

  let server_posts = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().startsWith('http://localhost:3100/')) {
      server_posts += 1;
    }
  });

  await goto_feed(page);

  // Let any in-flight pagination POSTs settle, then watch from a clean baseline.
  await page.waitForTimeout(500);
  const before = server_posts;

  await article_cards(page).first().getByTestId('link-title').click();
  await page.waitForTimeout(500);

  expect(server_posts).toBe(before);
});
