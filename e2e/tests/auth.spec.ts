import { test, expect, type Page } from '@playwright/test';
import {
  click_reloading,
  expect_logged_in_menu,
  find_card_by_text,
  load_page,
  login_via_dialog,
  logout_via_menu,
  open_menu,
  remove_all_cards,
  scroll_to_load_all,
  switch_view,
  vote_card,
  wait_for_download,
} from '../helpers/pages';
import { read_login_code, seed_account, test_email } from '../helpers/db';

const YOGA_URL = 'https://en.wikipedia.org/wiki/Yoga';

test.describe('Login dialog', () => {
  test('logs in via email code and shows the account in the menu', async ({ page }) => {
    const email = test_email();
    await load_page(page, true);
    await scroll_to_load_all(page);

    const yoga_card = find_card_by_text(page, 'Yoga');
    await expect(yoga_card).toBeVisible();
    await vote_card(yoga_card, 'up');

    await login_via_dialog(page, email);

    await open_menu(page);
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.getByText('Log out')).toBeVisible();

    await switch_view(page, 'liked');
    await expect(find_card_by_text(page, 'Yoga')).toBeVisible();
  });

  test('rejects an invalid email', async ({ page }) => {
    await load_page(page, true);

    await open_menu(page);
    await page.getByText('Log in', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Email' }).fill('not-an-email');
    await page.getByRole('button', { name: 'Send code' }).click();

    await expect(page.getByText('Invalid email')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '6-digit code' })).not.toBeVisible();
  });

  test('rejects a wrong code, then accepts the correct one', async ({ page }) => {
    const email = test_email();
    await load_page(page, true);

    await open_menu(page);
    await page.getByText('Log in', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();

    await expect.poll(() => read_login_code(email) !== null, { timeout: 10_000 }).toBe(true);
    const real_code = read_login_code(email) ?? '';

    const wrong_code = real_code === '000000' ? '111111' : '000000';
    await page.getByRole('textbox', { name: '6-digit code' }).fill(wrong_code);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('Invalid or expired code')).toBeVisible();

    // The wrong attempt didn't delete the code, so the correct one still works.
    await page.getByRole('textbox', { name: '6-digit code' }).fill(real_code);
    await click_reloading(page, page.getByRole('button', { name: 'Verify' }));
    await expect_logged_in_menu(page);

    await open_menu(page);
    await expect(page.getByText(email, { exact: true })).toBeVisible();
  });

  test('renders the email and code steps', async ({ page }) => {
    const email = test_email();
    await load_page(page, true);

    await open_menu(page);
    await page.getByText('Log in', { exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await remove_all_cards(page);
    await expect(page.getByRole('dialog')).toHaveScreenshot('login-dialog-email.png', {
      maxDiffPixels: 5,
    });

    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('textbox', { name: '6-digit code' })).toBeVisible();

    // The email is deterministic per (project, test), so the "sent a 6-digit
    // code to <email>" line is stable and needs no mask.
    await expect(page.getByRole('dialog')).toHaveScreenshot('login-dialog-code.png', {
      maxDiffPixels: 5,
    });
  });
});

test.describe('Menu', () => {
  // Scope the snapshot to the drawer paper so the cards behind the backdrop
  // don't affect it.
  const drawer = (page: Page) => page.locator('.MuiDrawer-paper');

  test('renders the logged-out menu', async ({ page }) => {
    await load_page(page, true);

    await open_menu(page);
    await expect(page.getByText('Log in', { exact: true })).toBeVisible();

    await expect(drawer(page)).toHaveScreenshot('menu-logged-out.png', { maxDiffPixels: 5 });
  });

  test.describe('Download my data', () => {
    test('is hidden without cookie consent', async ({ page }) => {
      await load_page(page, false);

      await open_menu(page);
      await expect(page.getByText('Log in', { exact: true })).toBeVisible();
      await expect(page.getByTestId('download-data')).toHaveCount(0);

      await expect(drawer(page)).toHaveScreenshot('menu-no-consent.png', { maxDiffPixels: 5 });
    });

    test('enables the user to download their data', async ({ page }) => {
      await load_page(page, true);
      await open_menu(page);
      const download = wait_for_download(page);
      await page.getByTestId('download-data').click();
      const result = await download;
      expect(result.name).toBe('scrollsurf-data.json');
      expect(result.data).toMatchObject({ liked: [], disliked: [], clicked: [] });
    });
  });

  test('renders the logged-in menu', async ({ page }) => {
    const email = test_email();
    await load_page(page, true);

    await login_via_dialog(page, email);

    await open_menu(page);
    // The email is deterministic per (project, test), so the account line is
    // stable and needs no mask.
    await expect(page.getByText(email, { exact: true })).toBeVisible();

    await expect(drawer(page)).toHaveScreenshot('menu-logged-in.png', { maxDiffPixels: 5 });
  });
});

test.describe('Logout', () => {
  test('logs out and returns to the anonymous menu', async ({ page }) => {
    const email = test_email();
    await load_page(page, true);

    await login_via_dialog(page, email);

    await open_menu(page);
    await expect(page.getByText(email, { exact: true })).toBeVisible();

    await page.getByText('Log out').click();
    await expect(page.getByTestId('feed-card').first()).toBeVisible();

    await open_menu(page);
    await expect(page.getByText('Log in', { exact: true })).toBeVisible();
    await expect(page.getByText(email, { exact: true })).not.toBeVisible();
  });
});

test.describe('Account switch', () => {
  test('switching accounts swaps the visible history', async ({ page }) => {
    // Two logins plus a logout, each with a reload round-trip, exceeds the
    // default 10s per-test budget.
    test.slow();
    const email_a = test_email('a');
    const email_b = test_email('b');

    // Account B already exists with a liked "Yoga" article.
    seed_account(email_b, YOGA_URL);

    await load_page(page, true);
    await scroll_to_load_all(page);

    // As the anonymous session, like "Write amplification".
    const write_amp_card = find_card_by_text(page, 'Write amplification');
    await expect(write_amp_card).toBeVisible();
    await vote_card(write_amp_card, 'up');

    // Promote the anonymous session to account A — A now owns that like.
    await login_via_dialog(page, email_a);
    await switch_view(page, 'liked');
    await expect(find_card_by_text(page, 'Write amplification')).toBeVisible();

    // Log out, then log in as B — the visible history must now be B's.
    await logout_via_menu(page);
    await login_via_dialog(page, email_b);

    await switch_view(page, 'liked');
    await expect(find_card_by_text(page, 'Yoga')).toBeVisible();
    await expect(find_card_by_text(page, 'Write amplification')).not.toBeVisible();

    await open_menu(page);
    await expect(page.getByText(email_b, { exact: true })).toBeVisible();
  });
});
