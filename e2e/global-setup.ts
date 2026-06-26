import { open_db } from '@/lib/db/connection';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { type DatabaseSync } from 'node:sqlite';

const articles = {
  'unusual.db': [
    'https://en.wikipedia.org/wiki/Null_Island',
    'https://en.wikipedia.org/wiki/Night_of_the_Day_of_the_Dawn_of_the_Son_of_the_Bride_of_the_Return_of_the_Revenge_of_the_Terror_of_the_Attack_of_the_Evil%2C_Mutant%2C_Alien%2C_Flesh_Eating%2C_Hellbound%2C_Zombified_Living_Dead',
    // Anglo-Zanzibar War also appears in vital_50000.db and featured_articles.db
    // (with a distinct topic per dataset) — exercises a card with multiple
    // dataset chips. Keep this URL in sync across all three datasets below.
    'https://en.wikipedia.org/wiki/Anglo-Zanzibar_War',
  ],
  'good_articles.db': [
    'https://en.wikipedia.org/wiki/Yoga',
    'https://en.wikipedia.org/wiki/Write_amplification',
  ],
  'vital_50000.db': [
    'https://en.wikipedia.org/wiki/Airbus_A320_family',
    'https://en.wikipedia.org/wiki/Rescue',
    'https://en.wikipedia.org/wiki/Anglo-Zanzibar_War',
  ],
  'featured_articles.db': [
    'https://en.wikipedia.org/wiki/Black_hole',
    'https://en.wikipedia.org/wiki/Sun',
    'https://en.wikipedia.org/wiki/Anglo-Zanzibar_War',
  ],
};

const pictures = {
  'commons_featured_pictures.db': [
    'https://commons.wikimedia.org/wiki/File:Priegendorf_Kirche-20250302-RM-155839.jpg',
    'https://commons.wikimedia.org/wiki/File:Inside_Ngorongoro_crater.jpg',
  ],
  'featured_pictures.db': [
    'https://commons.wikimedia.org/wiki/File:%27One_of_the_wards_in_the_hospital_at_Scutari%27._Wellcome_M0007724_-_restoration,_cropped.jpg',
    'https://commons.wikimedia.org/wiki/File:Portrait_of_King_Yeongjo_-_Chae_Yong_Shin_(%E8%94%A1%E9%BE%8D%E8%87%A3_1850-1941)_Cho_Seok-jin_(%E8%B6%99%E9%8C%AB%E6%99%89_1853-1920)_et_(cropped).jpg',
  ],
};

const e2e_db_path = path.join('e2e', 'fixtures', 'scrollsurf-e2e-test.db');

const seed_quotes = (e2e_db: DatabaseSync) => {
  const quotes_data = [
    {
      text: 'Movement will cease before we are weary of being useful.',
      url: 'https://en.wikiquote.org/wiki/Wikiquote:Quote_of_the_day/April_15,_2024',
      author: 'Leonardo da Vinci',
      author_url: 'https://en.wikiquote.org/wiki/Leonardo_da_Vinci',
      author_image:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Leonardo_da_Vinci_-_presumed_self-portrait_-_WGA12798.jpg/250px-Leonardo_da_Vinci_-_presumed_self-portrait_-_WGA12798.jpg?utm_source=en.wikiquote.org&utm_campaign=api&utm_content=thumbnail',
    },
    {
      text: 'It is at night that faith in light is admirable.',
      url: 'https://en.wikiquote.org/wiki/Wikiquote:Quote_of_the_day/April_1,_2024',
      author: 'Edmond Rostand',
      author_url: 'https://en.wikiquote.org/wiki/Edmond_Rostand',
      author_image:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Edmond_Rostand.jpg/250px-Edmond_Rostand.jpg?utm_source=en.wikiquote.org&utm_campaign=api&utm_content=thumbnail',
    },
  ];

  e2e_db.exec(
    `INSERT OR REPLACE INTO datasets (name, source_url) VALUES ('Quotes', 'https://en.wikiquote.org/wiki/Wikiquote:QOTD_by_month')`
  );

  for (const quote of quotes_data) {
    const item = e2e_db
      .prepare('INSERT OR IGNORE INTO items (type, title, url) VALUES (?, ?, ?) RETURNING id')
      .get('quote', quote.text, quote.url) as { id: number } | undefined;

    if (item) {
      e2e_db
        .prepare(
          'INSERT OR IGNORE INTO quotes (item_id, author, author_url, author_image) VALUES (?, ?, ?, ?)'
        )
        .run(item.id, quote.author, quote.author_url, quote.author_image);

      e2e_db
        .prepare('INSERT OR IGNORE INTO item_topics (item_id, dataset, topic) VALUES (?, ?, ?)')
        .run(item.id, 'Quotes', 'Quote of the Day');
    }
  }
};

const import_feed_items = async (e2e_db: DatabaseSync) => {
  e2e_db.exec('CREATE TEMP TABLE wanted_urls (url TEXT PRIMARY KEY)');
  const urls = [...Object.values(articles).flat(), ...Object.values(pictures).flat()];
  const insert_wanted = e2e_db.prepare('INSERT OR IGNORE INTO wanted_urls (url) VALUES (?)');
  for (const url of urls) {
    insert_wanted.run(url);
  }

  const dataset_path = (filename: string) => path.join('datasets', filename);

  const import_articles = (filename: string) => {
    const ref_path = dataset_path(filename);
    if (!existsSync(ref_path)) {
      throw new Error(`missing reference DB: ${ref_path} (build it with its download-* script)`);
    }

    e2e_db.exec(`ATTACH '${ref_path}' AS ref`);
    try {
      const row = e2e_db.prepare("SELECT value FROM ref.metadata WHERE key = 'title'").get() as
        | { value: string }
        | undefined;
      if (!row) {
        throw new Error(`${filename}: no 'title' key in metadata`);
      }
      const dataset = row.value.replace(/'/g, "''");

      e2e_db.exec(`
        INSERT OR IGNORE INTO main.items (type, title, url)
        SELECT 'article', a.title, a.url
        FROM ref.articles a
        JOIN wanted_urls w ON w.url = a.url
      `);
      e2e_db.exec(`
        INSERT OR IGNORE INTO main.articles (item_id, extract, description, image_url)
        SELECT i.id, a.extract, a.description, a.image_url
        FROM ref.articles a
        JOIN wanted_urls w ON w.url = a.url
        JOIN main.items i ON i.url = a.url
      `);
      e2e_db.exec(`
        INSERT OR IGNORE INTO main.categories (name, hidden)
        SELECT DISTINCT rac.name, rac.hidden
        FROM ref.article_categories rac
        JOIN wanted_urls w ON w.url = rac.url
      `);
      e2e_db.exec(`
        INSERT OR IGNORE INTO main.item_categories (item_id, category_id)
        SELECT i.id, c.id
        FROM ref.article_categories rac
        JOIN wanted_urls w ON w.url = rac.url
        JOIN main.items i ON i.url = rac.url
        JOIN main.categories c ON c.name = rac.name
      `);
      e2e_db.exec(`
        INSERT OR IGNORE INTO main.item_topics (item_id, dataset, topic)
        SELECT i.id, '${dataset}', rt.topic
        FROM ref.article_topics rt
        JOIN wanted_urls w ON w.url = rt.url
        JOIN main.items i ON i.url = rt.url
      `);
      e2e_db.exec(`
        INSERT OR REPLACE INTO main.datasets (name, source_url)
        VALUES ('${dataset}', (SELECT value FROM ref.metadata WHERE key = 'source_url'))
      `);
    } finally {
      e2e_db.exec('DETACH ref');
    }
  };

  const import_pictures = (filename: string) => {
    const ref_path = dataset_path(filename);
    if (!existsSync(ref_path)) {
      throw new Error(`missing reference DB: ${ref_path} (build it with its download-* script)`);
    }
    e2e_db.exec(`ATTACH '${ref_path}' AS ref`);
    try {
      const row = e2e_db.prepare("SELECT value FROM ref.metadata WHERE key = 'title'").get() as
        | { value: string }
        | undefined;
      if (!row) {
        throw new Error(`${filename}: no 'title' key in metadata`);
      }
      const dataset = row.value.replace(/'/g, "''");

      e2e_db.exec(`
        INSERT OR IGNORE INTO main.items (type, title, url)
        SELECT 'picture', p.file_title, p.url
        FROM ref.pictures p
        JOIN wanted_urls w ON w.url = p.url
      `);
      e2e_db.exec(`
        INSERT INTO main.pictures (item_id, image_url, caption, credit)
        SELECT i.id, p.image_url, COALESCE(d.caption, ''), p.credit
        FROM ref.pictures p
        LEFT JOIN ref.discovered_pictures d ON d.file_title = p.file_title
        JOIN wanted_urls w ON w.url = p.url
        JOIN main.items i ON i.url = p.url
        ON CONFLICT(item_id) DO UPDATE SET caption = excluded.caption
        WHERE main.pictures.caption = ''
      `);
      e2e_db.exec(`
        INSERT OR IGNORE INTO main.item_topics (item_id, dataset, topic)
        SELECT i.id, '${dataset}', rpt.topic
        FROM ref.picture_topics rpt
        JOIN wanted_urls w ON w.url = rpt.url
        JOIN main.items i ON i.url = rpt.url
      `);
      e2e_db.exec(`
        INSERT OR IGNORE INTO main.categories (name)
        SELECT DISTINCT rcc.name
        FROM ref.commons_categories rcc
        JOIN wanted_urls w ON w.url = rcc.url
      `);
      e2e_db.exec(`
        INSERT OR IGNORE INTO main.item_categories (item_id, category_id)
        SELECT i.id, c.id
        FROM ref.commons_categories rcc
        JOIN wanted_urls w ON w.url = rcc.url
        JOIN main.items i ON i.url = rcc.url
        JOIN main.categories c ON c.name = rcc.name
      `);
      e2e_db.exec(`
        INSERT OR REPLACE INTO main.datasets (name, source_url)
        VALUES ('${dataset}', (SELECT value FROM ref.metadata WHERE key = 'source_url'))
      `);
    } finally {
      e2e_db.exec('DETACH ref');
    }
  };

  for (const filename of Object.keys(articles)) {
    import_articles(filename);
  }
  for (const filename of Object.keys(pictures)) {
    import_pictures(filename);
  }
  seed_quotes(e2e_db);

  const count = (table: string) =>
    (e2e_db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  // eslint-disable-next-line no-console
  console.log(
    `Imported into ${e2e_db_path}:` +
      `${count('items')} items, ${count('articles')} articles, ${count('pictures')} pictures, ${count('quotes')} quotes, ` +
      `${count('datasets')} datasets, ${count('item_topics')} item_topics, ${count('item_categories')} item_categories`
  );
};

const init_db = async () => {
  const e2e_db_path = path.join('e2e', '.data', 'scrollsurf.db');
  const db = open_db(e2e_db_path);
  const item_count = db.prepare('select 1 from items limit 1').get();
  if (!item_count) {
    await import_feed_items(db);
  }
  const quote_count = db.prepare('select 1 from quotes limit 1').get();
  if (!quote_count) {
    seed_quotes(db);
  }
  db.close();
};

export default init_db;
