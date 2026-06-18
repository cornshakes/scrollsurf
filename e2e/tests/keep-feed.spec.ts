import { test, expect } from '@playwright/test';
import { load_page, switch_view, open_menu } from '../helpers/pages';

test.describe('Feed persistence', () => {
  test('items are preserved after switching views and back', async ({ page }) => {
    await load_page(page);
    const first_title = await page
      .getByTestId('feed-card')
      .first()
      .getByTestId('link-title')
      .textContent();

    await switch_view(page, 'liked');
    await switch_view(page, 'random');

    const title_after = await page
      .getByTestId('feed-card')
      .first()
      .getByTestId('link-title')
      .textContent();
    expect(title_after).toBe(first_title);
  });

  test('scroll position is restored after switching views and back', async ({ page }) => {
    await load_page(page);
    const scroll_container = page.getByTestId('feed-scroll');

    await scroll_container.evaluate((el) => {
      el.scrollTop = 300;
    });

    await switch_view(page, 'liked');
    await switch_view(page, 'random');

    const scroll_top_after = await scroll_container.evaluate((el) => el.scrollTop);
    expect(scroll_top_after).toBeGreaterThan(0);
  });

  test('items are preserved after navigating to /privacy and back', async ({ page }) => {
    await load_page(page);
    const first_title = await page
      .getByTestId('feed-card')
      .first()
      .getByTestId('link-title')
      .textContent();

    // Use the menu link for SPA navigation (preserves React tree / App Router layout)
    await open_menu(page);
    await page.getByRole('link', { name: 'Privacy' }).click();
    await page.waitForURL('**/privacy');

    await page.goBack();
    await expect(page.getByTestId('feed-card').first()).toBeVisible();

    const title_after = await page
      .getByTestId('feed-card')
      .first()
      .getByTestId('link-title')
      .textContent();
    expect(title_after).toBe(first_title);
  });
});
