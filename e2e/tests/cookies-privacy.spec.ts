import { test, expect } from '@playwright/test';
import {
  click_reloading,
  expect_logged_out_menu,
  find_card_by_text,
  get_cookies,
  load_page,
  login_via_dialog,
  open_consent,
  open_menu,
  remove_all_cards,
  scroll_to_load_all,
  vote_card,
} from '../helpers/pages';
import { count_user_items, does_email_exist, test_email } from '../helpers/db';
import { get_current_user } from '../helpers/extras';

test.describe('Cookie Consent Dialog', () => {
  test('works to grant/withdraw cookie consent', async ({ page }) => {
    await load_page(page);
    await remove_all_cards(page);
    const popover = page.getByTestId('consent-popover');
    const accept_btn = popover.getByRole('button', { name: 'Accept' });
    const withdraw_btn = popover.getByRole('button', { name: 'Withdraw' });
    const confirm_btn = popover.getByRole('button', { name: 'Confirm' });

    // Initially, there are no cookies
    const cookies_before = await get_cookies(page);
    expect(cookies_before.consent).toBeUndefined();
    expect(cookies_before.uid).toBeUndefined();

    // Open Cookie Consent dialog and accept cookies
    await open_consent(page);
    await expect(popover).toHaveScreenshot(
      'cookie-consent-dialog-pre-consent.png',
      { maxDiffPixels: 5 } /*border rounding tolerance*/
    );
    await accept_btn.click();
    await expect(popover).toBeHidden();

    // Now, cookies are set
    const set_cookies = await get_cookies(page);
    expect(set_cookies.consent).toBe('granted');
    expect(set_cookies.uid).toBeTruthy();

    // Open dialog again and withdraw consent
    await open_consent(page);
    await expect(popover).toHaveScreenshot(
      'cookie-consent-dialog-post-consent.png',
      { maxDiffPixels: 5 } /*border rounding tolerance*/
    );
    await withdraw_btn.click();

    // accept warning
    await expect(popover).toHaveScreenshot(
      'cookie-consent-dialog-revoke-warning.png',
      { maxDiffPixels: 5 } /*border rounding tolerance*/
    );
    await confirm_btn.click();
    await expect(popover).toBeHidden();

    // Cookies explicitly say "denied"
    const unset_cookies = await get_cookies(page);
    expect(unset_cookies.consent).toEqual('denied');
    expect(unset_cookies.uid).toBeUndefined();
  });

  test('cookie granted status can be viewed', async ({ page }) => {
    await load_page(page, true);
    const popover = page.getByTestId('consent-popover');
    const ok_btn = popover.getByRole('button', { name: 'Ok' });
    await open_consent(page);
    await ok_btn.click();
    await expect(popover).toBeHidden();
  });

  test('granting consent can be canceled', async ({ page }) => {
    await load_page(page);
    const popover = page.getByTestId('consent-popover');
    const nothanks_btn = popover.getByRole('button', { name: 'No Thanks' });
    await open_consent(page);
    await nothanks_btn.click();
    await expect(popover).toBeHidden();
  });

  test.describe('Withdrawing Consent', () => {
    test('withdrawing consent can be canceled', async ({ page }) => {
      await load_page(page, true);
      const popover = page.getByTestId('consent-popover');
      const withdraw_btn = popover.getByRole('button', { name: 'Withdraw consent' });
      const cancel_btn = popover.getByRole('button', { name: 'Cancel' });
      const ok_btn = popover.getByRole('button', { name: 'Ok' });

      await open_consent(page);
      await withdraw_btn.click();
      await cancel_btn.click();
      await ok_btn.click();
      await expect(popover).toBeHidden();

      // cookies are still set
      const set_cookies = await get_cookies(page);
      expect(set_cookies.consent).toBe('granted');
      expect(set_cookies.uid).toBeTruthy();
    });

    test('"keep my data"-checkbox unchecked means user history is deleted', async ({ page }) => {
      await load_page(page, true);
      await scroll_to_load_all(page);
      const yoga_card = find_card_by_text(page, 'Yoga');
      await expect(yoga_card).toBeVisible();
      await vote_card(yoga_card, 'up');

      const user = await get_current_user(page);
      await expect
        .poll(() => count_user_items(user.id), { message: 'the like should be recorded' })
        .toBeGreaterThan(0);

      await open_consent(page);
      await page.getByRole('button', { name: 'Withdraw consent' }).click();
      await page.getByRole('checkbox').uncheck();
      await click_reloading(page, page.getByRole('button', { name: 'Confirm' }));

      // Cookies are cleared...
      const cookies_after = await get_cookies(page);
      expect(cookies_after.consent).toBe('denied');
      expect(cookies_after.uid).toBeUndefined();

      // And history is gone too
      expect(count_user_items(user.id)).toBe(0);
    });

    test('"keep my data"-checkbox checked means user history is saved anonymously', async ({
      page,
    }) => {
      await load_page(page, true);
      await scroll_to_load_all(page);
      const yoga_card = find_card_by_text(page, 'Yoga');
      await expect(yoga_card).toBeVisible();
      await vote_card(yoga_card, 'up');

      const user = await get_current_user(page);

      await expect
        .poll(() => count_user_items(user.id), { message: 'the like should be recorded' })
        .toBeGreaterThan(0);

      // Withdraw consent, but tick "keep my anonymous data for research".
      await open_consent(page);
      await page.getByRole('button', { name: 'Withdraw consent' }).click();
      await page.getByRole('checkbox').check();
      await click_reloading(page, page.getByRole('button', { name: 'Confirm' }));

      // Cookies are cleared just like a normal revoke.
      const cookies_after = await get_cookies(page);
      expect(cookies_after.consent).toBe('denied');
      expect(cookies_after.uid).toBeUndefined();

      // But the history survives (anonymized): the user's votes are still in the DB.
      expect(count_user_items(user?.id)).toBeGreaterThan(0);
    });

    test('withdrawing consent removes the account and clears cookies', async ({ page }) => {
      const email = test_email();
      await load_page(page, true);

      await login_via_dialog(page, email);
      const user = await get_current_user(page);
      expect(user?.email).toBe(email);
      expect(does_email_exist(email)).toBe(true);

      await open_consent(page);
      await page.getByRole('button', { name: 'Withdraw consent' }).click();
      await click_reloading(page, page.getByRole('button', { name: 'Confirm' }));

      await expect(get_current_user(page)).rejects.toThrow('No uid cookie: no user!');
      expect(does_email_exist(email)).toBe(false);

      await expect_logged_out_menu(page);
    });
  });
});

test.describe('Privacy Page', () => {
  test('loads from /privacy url', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveScreenshot('privacy-page.png');
  });

  test('loads from the cookie consent popover', async ({ page }) => {
    await load_page(page);
    await remove_all_cards(page);
    const popover = page.getByTestId('consent-popover');
    const privacy_link = popover.getByRole('link', { name: 'Privacy Info' });
    await open_consent(page);
    await privacy_link.click();
    await page.waitForURL('/privacy');
  });

  test('loads from the menu', async ({ page }) => {
    await load_page(page);
    await open_menu(page);

    await page.getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
