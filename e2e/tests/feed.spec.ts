import { test, expect } from '@playwright/test';
import { cards, goto_feed, scroll_feed_to_bottom, start_consented } from '../helpers/pages';

test('home renders feed cards', async ({ page }) => {
  await goto_feed(page);
  expect(await cards(page).count()).toBeGreaterThanOrEqual(5);
});

test('infinite scroll appends more cards', async ({ page, context }) => {
  // A consented user gets clean, de-duplicated pagination (seen-tracking).
  await start_consented(context);
  await goto_feed(page);
  const initial = await cards(page).count();

  await expect(async () => {
    await scroll_feed_to_bottom(page);
    expect(await cards(page).count()).toBeGreaterThan(initial);
  }).toPass({ timeout: 15_000 });
});
