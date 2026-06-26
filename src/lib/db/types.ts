export interface Link {
  title: string;
  url: string | null;
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
  author_url: string | null;
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

// Followed-link kinds we log for engagement. The image link on a picture card
// is recorded as 'title' (it is that card's primary link to the source page).
export type LinkType = 'title' | 'by' | 'category' | 'topic' | 'dataset';
