import { test, expect } from '@playwright/test';
import {
  article_cards,
  find_card_by_heading,
  goto_feed,
  mock_images,
  picture_cards,
  scroll_card_to_top,
  start_consented,
  switch_view,
  vote_card,
} from '../helpers/pages';

// ── Article card snapshots ─────────────────────────────────────────────────

test('article card - long title', async ({ page, context }) => {
  await mock_images(page);
  await start_consented(context);
  await goto_feed(page);
  const card = await find_card_by_heading(page, /Night of the Day/);
  await scroll_card_to_top(page, card);
  await expect(card).toHaveScreenshot();
});

test('article card - with thumbnail', async ({ page, context }) => {
  await mock_images(page);
  await start_consented(context);
  await goto_feed(page);
  const card = await find_card_by_heading(page, 'Black hole');
  await scroll_card_to_top(page, card);
  await expect(card).toHaveScreenshot();
});

test('article card - without thumbnail', async ({ page, context }) => {
  await start_consented(context);
  await goto_feed(page);
  const card = await find_card_by_heading(page, 'Null Island');
  await scroll_card_to_top(page, card);
  await expect(card).toHaveScreenshot();
});

test('article card - liked', async ({ page, context }) => {
  await mock_images(page);
  await start_consented(context);
  await goto_feed(page);
  const card = await find_card_by_heading(page, 'Black hole');
  await vote_card(card, 'up');
  await switch_view(page, 'liked');
  await expect(page.getByRole('heading', { name: 'Black hole' })).toBeVisible();
  const liked = article_cards(page).first();
  await scroll_card_to_top(page, liked);
  await expect(liked).toHaveScreenshot();
});

test('article card - disliked', async ({ page, context }) => {
  await mock_images(page);
  await start_consented(context);
  await goto_feed(page);
  const card = await find_card_by_heading(page, 'Sun');
  await vote_card(card, 'down');
  await switch_view(page, 'disliked');
  await expect(page.getByRole('heading', { name: 'Sun' })).toBeVisible();
  const disliked = article_cards(page).first();
  await scroll_card_to_top(page, disliked);
  await expect(disliked).toHaveScreenshot();
});

// ── Picture card snapshots ─────────────────────────────────────────────────

test('picture card - long caption', async ({ page, context }) => {
  await mock_images(page);
  await start_consented(context);
  await goto_feed(page);
  const card = picture_cards(page)
    .filter({ hasText: /One of the wards/ })
    .first();
  await scroll_card_to_top(page, card);
  await expect(card).toHaveScreenshot();
});

test('picture card - long credit', async ({ page, context }) => {
  await mock_images(page);
  await start_consented(context);
  await goto_feed(page);
  const card = picture_cards(page)
    .filter({ hasText: /Chae Yong-sin/ })
    .first();
  await scroll_card_to_top(page, card);
  await expect(card).toHaveScreenshot();
});

test('picture card - liked', async ({ page, context }) => {
  await mock_images(page);
  await start_consented(context);
  await goto_feed(page);
  const card = picture_cards(page)
    .filter({ hasText: /Chae Yong-sin/ })
    .first();
  await vote_card(card, 'up');
  await switch_view(page, 'liked');
  const liked = picture_cards(page).first();
  await expect(liked).toBeVisible();
  await scroll_card_to_top(page, liked);
  await expect(liked).toHaveScreenshot();
});

test('picture card - disliked', async ({ page, context }) => {
  await mock_images(page);
  await start_consented(context);
  await goto_feed(page);
  const card = picture_cards(page)
    .filter({ hasText: /Chae Yong-sin/ })
    .first();
  await vote_card(card, 'down');
  await switch_view(page, 'disliked');
  const disliked = picture_cards(page).first();
  await expect(disliked).toBeVisible();
  await scroll_card_to_top(page, disliked);
  await expect(disliked).toHaveScreenshot();
});
