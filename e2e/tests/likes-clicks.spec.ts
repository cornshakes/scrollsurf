import { test, expect } from '@playwright/test';
import {
  load_page,
  switch_view,
  vote_card,
  scroll_to_load_all,
  screenshot_card,
  find_card_by_text,
  article_cards,
  picture_cards,
} from '../helpers/pages';
import { expect_click_in_db } from '../helpers/db';

test.describe('Like/Dislike', () => {
  test('liking an article surfaces it in the Liked view', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    const card = find_card_by_text(page, 'Black hole');
    await vote_card(card, 'up');
    await switch_view(page, 'liked');
    await screenshot_card(page, 'Black hole', 'article-liked');
  });

  test('disliking an article surfaces it in the Disliked view', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    const card = find_card_by_text(page, 'Sun');
    await vote_card(card, 'down');
    await switch_view(page, 'disliked');
    await screenshot_card(page, 'Sun', 'article-disliked');
  });

  test('liking a picture surfaces it in the Liked view', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    const card = find_card_by_text(page, 'Chae Yong-sin');
    await vote_card(card, 'up');
    await switch_view(page, 'liked');
    await screenshot_card(page, 'Chae Yong-sin', 'picture-liked');
  });

  test('disliking a picture surfaces it in the Disliked view', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    const card = find_card_by_text(page, 'Chae Yong-sin');
    await vote_card(card, 'down');
    await switch_view(page, 'disliked');
    await screenshot_card(page, 'Chae Yong-sin', 'picture-disliked');
  });
});

test.describe('Click Tracking', () => {
  test('without consent, following a link fires no request', async ({ page }) => {
    // No start_consented → no consent cookie. The client guard must skip the
    // server action entirely, so no POST to the app should occur on a link click.

    let server_posts = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().startsWith('http://localhost:3100/')) {
        server_posts += 1;
      }
    });

    await load_page(page);

    // Let any in-flight pagination POSTs settle, then watch from a clean baseline.
    await page.waitForTimeout(500);
    const before = server_posts;

    await article_cards(page).first().getByTestId('link-title').click();
    await page.waitForTimeout(500);

    expect(server_posts).toBe(before);
  });

  test('every article link click is recorded', async ({ page }) => {
    const token = (await load_page(page, true)) || '';

    // title — the article heading link; label is the title text.
    const title_link = article_cards(page).first().getByTestId('link-title');
    const title = (await title_link.innerText()).trim();
    await title_link.click();
    await expect_click_in_db(
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
      await expect_click_in_db(
        token,
        { item_type: 'article', link_type, link_label: label },
        `${link_type} click for "${label}"`
      );
    }
  });

  test('every picture link click is recorded', async ({ page }) => {
    const token = (await load_page(page, true)) || '';
    await picture_cards(page).first().getByTestId('link-title').click();
    await expect_click_in_db(
      token,
      { item_type: 'picture', link_type: 'title' },
      'picture image (title) click'
    );

    // by — the credit link; label is the credit name.
    const by_link = page.locator('[data-card-type="picture"] [data-testid="link-by"]').first();
    const credit = (await by_link.innerText()).trim();
    await by_link.click();
    await expect_click_in_db(
      token,
      { item_type: 'picture', link_type: 'by', link_label: credit },
      `picture credit (by) click for "${credit}"`
    );
  });
});
