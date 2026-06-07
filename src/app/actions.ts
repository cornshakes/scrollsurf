'use server';

import {
  get_next_articles,
  set_like,
  get_voted_articles,
  get_topic_tree,
  get_category_tree,
  set_dataset_enabled,
  get_datasets_enabled,
  type Article,
  type TopicTree,
  type CategoryTree,
} from '@/lib/db';

export const get_next_wiki_articles = async (count: number): Promise<Article[]> => {
  return get_next_articles(count);
};

export const set_article_like = async (article_id: number, value: -1 | 0 | 1) => {
  set_like(article_id, value);
};

export const get_voted_wiki_articles = async (vote: -1 | 1): Promise<Article[]> => {
  return get_voted_articles(vote);
};

export const get_wiki_topic_tree = async (): Promise<TopicTree> => {
  return get_topic_tree();
};

export const set_wiki_dataset_enabled = async (dataset: string, enabled: boolean) => {
  set_dataset_enabled(dataset, enabled);
};

export const get_wiki_datasets_enabled = async (): Promise<Record<string, boolean>> => {
  return get_datasets_enabled();
};

export const get_wiki_category_tree = async (): Promise<CategoryTree> => {
  return get_category_tree();
};
