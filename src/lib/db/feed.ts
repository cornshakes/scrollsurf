import { type FeedItem } from './types';
import { get_next_articles_internal } from './articles';
import { get_next_pictures_internal } from './pictures';

// Read at module load — use jest.resetModules() before importing to control
// the ratio in tests.
const PICTURE_RATIO =
  process.env.FEED_PICTURE_RATIO !== undefined ? parseFloat(process.env.FEED_PICTURE_RATIO) : 0.2;

// Merges articles and pictures into one list at the requested ratio. Evenly
// spaces pictures throughout the batch. Backfills with the other type when one
// source runs dry.
export const get_next_feed = (count: number, user_id: number | null): FeedItem[] => {
  const pics_wanted = Math.round(count * PICTURE_RATIO);
  const arts_wanted = count - pics_wanted;

  const pictures = get_next_pictures_internal(pics_wanted, user_id);
  const articles = get_next_articles_internal(
    arts_wanted + Math.max(0, pics_wanted - pictures.length),
    user_id
  );

  // Even spacing: insert one picture every `step` articles
  const result: FeedItem[] = [];
  const step =
    pictures.length > 0 ? Math.floor(articles.length / (pictures.length + 1)) + 1 : Infinity;
  let pic_idx = 0;
  let art_idx = 0;
  let next_pic_at = step;

  while (result.length < count && (art_idx < articles.length || pic_idx < pictures.length)) {
    if (pic_idx < pictures.length && result.length >= next_pic_at) {
      result.push(pictures[pic_idx++]);
      next_pic_at += step;
    } else if (art_idx < articles.length) {
      result.push(articles[art_idx++]);
    } else {
      result.push(pictures[pic_idx++]);
    }
  }

  return result;
};
