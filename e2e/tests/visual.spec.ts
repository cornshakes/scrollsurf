import { test, expect } from '@playwright/test';
import { cards, goto_feed, grant_consent, open_consent } from '../helpers/pages';

test('home feed', async ({ page }) => {
  await goto_feed(page);
  await expect(page).toHaveScreenshot({ mask: [cards(page)] });
});

test('consent dialog - pre-consent', async ({ page }) => {
  await goto_feed(page);
  await open_consent(page);
  const popover = page.getByTestId('consent-popover');
  await popover.waitFor();
  await expect(popover).toHaveScreenshot({ maxDiffPixels: 5 });
});

test('consent dialog - post-consent', async ({ page }) => {
  await goto_feed(page);
  await grant_consent(page);
  await open_consent(page);
  const popover = page.getByTestId('consent-popover');
  await popover.waitFor();
  await expect(popover).toHaveScreenshot({ maxDiffPixels: 5 });
});

test('privacy page', async ({ page }) => {
  await page.goto('/privacy');
  await page.getByRole('heading').first().waitFor();
  await expect(page).toHaveScreenshot();
});
