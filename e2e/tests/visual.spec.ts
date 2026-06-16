import { test, expect } from '@playwright/test';
import { load_page, remove_all_cards, screenshot_card, scroll_to_load_all } from '../helpers/pages';

test.describe('Visuals', () => {
  test('home feed', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    await remove_all_cards(page);
    await expect(page).toHaveScreenshot('home-feed.png');
  });

  test('article card - long title', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    await screenshot_card(page, 'Night of the Day', 'article-long-title');
  });

  test('article card - with thumbnail', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    await screenshot_card(page, 'Black hole', 'article-with-thumbnail');
  });

  test('article card - without thumbnail', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    await screenshot_card(page, 'Null Island', 'article-without-thumbnail');
  });

  test('picture card - long caption', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    await screenshot_card(page, 'One of the wards', 'picture-long-caption');
  });

  test('picture card - long credit', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    await screenshot_card(page, 'Chae Yong-sin', 'picture-long-credit');
  });
});
