import { test, expect } from '@playwright/test';
import { goto_feed, grant_consent, open_consent } from '../helpers/pages';

test('granting consent sets the consent and uid cookies', async ({ page, context }) => {
  await goto_feed(page);
  await grant_consent(page);

  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === 'ss_consent')?.value).toBe('granted');
  expect(cookies.find((c) => c.name === 'ss_uid')?.value).toBeTruthy();
});

test('withdrawing consent clears the uid cookie', async ({ page, context }) => {
  await goto_feed(page);
  await grant_consent(page);

  await open_consent(page);
  const withdraw = page.getByRole('button', { name: 'Withdraw consent' });
  await withdraw.click();
  await expect(withdraw).toBeHidden();

  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === 'ss_uid')).toBeFalsy();
});
