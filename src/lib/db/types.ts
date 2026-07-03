export interface Link {
  title: string;
  url: string;
  type: 'dataset' | 'topic' | 'category';
}

interface BaseFeedItem {
  id: number;
  title: string;
  url: string;
  like: -1 | 0 | 1;
  links: Link[];
}

export interface Article extends BaseFeedItem {
  type: 'article';
  extract: string;
  description: string | null;
  image_url: string | null;
}

export interface Picture extends BaseFeedItem {
  type: 'picture';
  image_url: string;
  caption: string;
  credit: string | null;
}

export interface Quote extends BaseFeedItem {
  type: 'quote';
  author: string;
  author_url: string;
  author_image: string | null;
  quote_year: string | null;
}

export type FeedItem = Article | Picture | Quote;

export interface TopicStat {
  topic: string;
  article_count: number;
  liked: number;
  disliked: number;
}

export interface CategoryGroup {
  top_level: string;
  article_count: number;
  liked: number;
  disliked: number;
  categories: TopicStat[];
}

export type CategoryTree = CategoryGroup[];
