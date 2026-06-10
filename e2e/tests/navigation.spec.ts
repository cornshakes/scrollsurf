import { test, expect } from '@playwright/test';
import { goto_feed, open_menu } from '../helpers/pages';

test('navigates to the privacy page from the menu', async ({ page }) => {
  await goto_feed(page);
  await open_menu(page);

  await page.getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading').first()).toBeVisible();
});
