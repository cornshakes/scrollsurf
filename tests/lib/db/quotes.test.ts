import { setup, insert_user, insert_quote, reset_db } from '../../helpers/test-db';
import { get_next_feed } from '@/lib/db/feed';
import { fetch_quotes_by_ids } from '@/lib/db/quotes';
import { save_vote } from '@/lib/db/votes';
import type { Quote } from '@/lib/db/types';

beforeAll(setup);
beforeEach(reset_db);

const get_next_quotes = (count: number, uid: number | null): Quote[] =>
  get_next_feed(count, uid).filter((row): row is Quote => row.type === 'quote');

// --- batch hydration ---

it('batch fetch: each quote gets the fixed Quotes/Quote of the Day topic with no cross-leak', () => {
  const uid = insert_user();
  const id1 = insert_quote({ text: 'Q1', url: 'https://q1', author: 'A1' });
  const id2 = insert_quote({ text: 'Q2', url: 'https://q2', author: 'A2' });
  const result = get_next_quotes(10, uid);
  expect(result).toHaveLength(2);
  const q1 = result.find((quote) => quote.id === id1) as Quote;
  const q2 = result.find((quote) => quote.id === id2) as Quote;
  expect(q1.topics).toHaveLength(1);
  expect(q1.topics[0]).toMatchObject({ dataset: 'Quotes', topic: 'Quote of the Day' });
  expect(q2.topics).toHaveLength(1);
  expect(q2.topics[0]).toMatchObject({ dataset: 'Quotes', topic: 'Quote of the Day' });
});

// --- quote-specific ---

it('fetch_quotes_by_ids returns correct fields for an unseen quote', () => {
  const id = insert_quote({
    text: 'To be or not to be.',
    url: 'https://en.wikiquote.org/wiki/test',
    author: 'Shakespeare',
    author_url: 'https://en.wikiquote.org/wiki/Shakespeare',
    author_image: 'https://upload.wikimedia.org/shakespeare.jpg',
  });
  const result = fetch_quotes_by_ids([id], null);
  expect(result).toHaveLength(1);
  expect(result[0].title).toBe('To be or not to be.');
  expect(result[0].author).toBe('Shakespeare');
  expect(result[0].author_url).toBe('https://en.wikiquote.org/wiki/Shakespeare');
  expect(result[0].author_image).toBe('https://upload.wikimedia.org/shakespeare.jpg');
  expect(result[0].type).toBe('quote');
  expect(result[0].like).toBe(0);
});

it('fetch_quotes_by_ids reflects like value for a voted quote', () => {
  const uid = insert_user();
  const id = insert_quote({
    text: 'Quote text',
    url: 'https://en.wikiquote.org/wiki/test2',
    author: 'Author',
  });
  save_vote(uid, id, 1);
  const result = fetch_quotes_by_ids([id], uid);
  expect(result[0].like).toBe(1);
});

it('fetch_quotes_by_ids returns empty array for empty ids', () => {
  expect(fetch_quotes_by_ids([], null)).toHaveLength(0);
});
