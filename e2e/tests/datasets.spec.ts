import { test, expect } from '@playwright/test';
import { goto_feed, start_consented, switch_view } from '../helpers/pages';

const GOOD = 'Include Good Articles in random articles';

test('datasets view lists seeded datasets and a toggle persists', async ({ page, context }) => {
  await start_consented(context);
  await goto_feed(page);
  await switch_view(page, 'datasets');

  const checkbox = page.getByRole('checkbox', { name: GOOD });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toBeChecked();

  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  // Wait for all in-flight server actions (including set_wiki_dataset_enabled) to settle.
  await page.waitForLoadState('networkidle');

  // Same user (cookies) after reload — the unchecked state is persisted server-side.
  await page.reload();
  await switch_view(page, 'datasets');
  await expect(page.getByRole('checkbox', { name: GOOD })).not.toBeChecked();
});
