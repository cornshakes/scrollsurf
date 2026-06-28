import { test, expect, type Page } from '@playwright/test';
import { load_page, open_consent, open_menu, remove_all_cards } from '../helpers/pages';

const get_cookies = async (page: Page) => {
  const cookies = await page.context().cookies();
  return {
    uid: cookies.find((c) => c.name === 'ss_uid')?.value,
    consent: cookies.find((c) => c.name === 'ss_consent')?.value,
  };
};

test.describe('Cookie Consent Dialog', () => {
  test('works to grant/deny consent', async ({ page }) => {
    await load_page(page);
    await remove_all_cards(page);
    const popover = page.getByTestId('consent-popover');
    const accept_btn = popover.getByRole('button', { name: 'Accept' });
    const withdraw_btn = popover.getByRole('button', { name: 'Withdraw consent' });

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
    await expect(popover).toBeHidden();

    // Cookies explicitly say "denied"
    const unset_cookies = await get_cookies(page);
    expect(unset_cookies.consent).toEqual('denied');
    expect(unset_cookies.uid).toBeUndefined();
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
