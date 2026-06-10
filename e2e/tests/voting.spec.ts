import { test, expect } from '@playwright/test';
import {
  article_cards,
  article_title,
  start_consented,
  goto_feed,
  switch_view,
  vote_card,
} from '../helpers/pages';

test('liking an article surfaces it in the Liked view', async ({ page, context }) => {
  await start_consented(context);
  await goto_feed(page);

  const card = article_cards(page).first();
  const title = await article_title(card);
  await vote_card(card, 'up');
  await expect(card.locator('[data-testid="vote-up"]:visible')).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await switch_view(page, 'liked');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});

test('disliking an article surfaces it in the Disliked view', async ({ page, context }) => {
  await start_consented(context);
  await goto_feed(page);

  const card = article_cards(page).first();
  const title = await article_title(card);
  await vote_card(card, 'down');

  await switch_view(page, 'disliked');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});
