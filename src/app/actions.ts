'use server';

import {
  get_next_feed,
  set_like,
  get_voted_articles,
  get_voted_pictures,
  get_topic_tree,
  get_category_tree,
  set_dataset_enabled,
  get_datasets_enabled,
  type FeedItem,
  type Article,
  type Picture,
  type TopicTree,
  type CategoryTree,
} from '@/lib/db';
import { current_user_id } from '@/lib/user';

export const get_next_wiki_articles = async (count: number): Promise<FeedItem[]> => {
  const uid = await current_user_id();
  return get_next_feed(count, uid);
};

export const set_article_like = async (
  type: 'article' | 'picture',
  id: number,
  value: -1 | 0 | 1
) => {
  const uid = await current_user_id();
  set_like(type, id, value, uid);
};

export const get_voted_wiki_articles = async (vote: -1 | 1): Promise<FeedItem[]> => {
  const uid = await current_user_id();
  const articles: Article[] = get_voted_articles(vote, uid);
  const pictures: Picture[] = get_voted_pictures(vote, uid);
  return [...articles, ...pictures].sort((a, b) => b.id - a.id);
};

export const get_wiki_topic_tree = async (): Promise<TopicTree> => {
  const uid = await current_user_id();
  return get_topic_tree(uid);
};

export const set_wiki_dataset_enabled = async (dataset: string, enabled: boolean) => {
  const uid = await current_user_id();
  set_dataset_enabled(dataset, enabled, uid);
};

export const get_wiki_datasets_enabled = async (): Promise<Record<string, boolean>> => {
  const uid = await current_user_id();
  return get_datasets_enabled(uid);
};

export const get_wiki_category_tree = async (): Promise<CategoryTree> => {
  const uid = await current_user_id();
  return get_category_tree(uid);
};
