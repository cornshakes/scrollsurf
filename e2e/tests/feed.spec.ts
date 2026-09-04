import { test, expect } from '@playwright/test';
import {
  get_card_titles,
  load_page,
  open_menu,
  remove_all_cards,
  scroll_to_load_all,
  switch_view,
} from '../helpers/pages';

test.describe('Home Feed', () => {
  test('loads more cards by scrolling', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    await remove_all_cards(page);
    await expect(page).toHaveScreenshot('home-feed.png');
  });

  test('preserves items and scroll position when switching views and back', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });

    const titles_b4 = await get_card_titles(page);

    await switch_view(page, 'liked');
    await switch_view(page, 'random');

    await expect(get_card_titles(page)).resolves.toStrictEqual(titles_b4);

    const scroll_top_after = await page.evaluate(() => window.scrollY);
    expect(scroll_top_after).toBeGreaterThanOrEqual(299);
    expect(scroll_top_after).toBeLessThanOrEqual(301);
  });

  test('items are preserved after navigating to /privacy and back', async ({ page }) => {
    await load_page(page, true);
    await scroll_to_load_all(page);
    const titles_b4 = await get_card_titles(page);

    // Use the menu link for SPA navigation (preserves React tree / App Router layout)
    await open_menu(page);
    await page.getByRole('link', { name: 'Privacy' }).click();
    await page.waitForURL('**/privacy');
    await page.goBack();

    await expect(get_card_titles(page)).resolves.toStrictEqual(titles_b4);
  });
});
