import { open_db } from '@/lib/db/connection';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { type DatabaseSync } from 'node:sqlite';

const articles = {
  'unusual.db': [
    'https://en.wikipedia.org/wiki/Null_Island',
    'https://en.wikipedia.org/wiki/Night_of_the_Day_of_the_Dawn_of_the_Son_of_the_Bride_of_the_Return_of_the_Revenge_of_the_Terror_of_the_Attack_of_the_Evil%2C_Mutant%2C_Alien%2C_Flesh_Eating%2C_Hellbound%2C_Zombified_Living_Dead',
  ],
  'good_articles.db': [
    'https://en.wikipedia.org/wiki/Yoga',
    'https://en.wikipedia.org/wiki/Write_amplification',
  ],
  'vital_50000.db': [
    'https://en.wikipedia.org/wiki/Airbus_A320_family',
    'https://en.wikipedia.org/wiki/Rescue',
  ],
  'featured_articles.db': [
    'https://en.wikipedia.org/wiki/Black_hole',
    'https://en.wikipedia.org/wiki/Sun',
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
        INSERT OR IGNORE INTO main.articles (title, extract, url, description, image_url)
        SELECT a.title, a.extract, a.url, a.description, a.image_url
        FROM ref.articles a
        JOIN wanted_urls w ON w.url = a.url
      `);
      e2e_db.exec(`
        INSERT OR IGNORE INTO main.categories (name, hidden)
        SELECT DISTINCT rac.name, rac.hidden
        FROM ref.article_categories rac
        JOIN wanted_urls w ON w.url = rac.url
      `);
      e2e_db.exec(`
        INSERT OR IGNORE INTO main.article_categories (article_id, category_id)
        SELECT a.id, c.id
        FROM ref.article_categories rac
        JOIN wanted_urls w ON w.url = rac.url
        JOIN main.articles a ON a.url = rac.url
        JOIN main.categories c ON c.name = rac.name
      `);
      e2e_db.exec(`
        INSERT OR IGNORE INTO main.article_topics (article_id, dataset, topic)
        SELECT a.id, '${dataset}', rt.topic
        FROM ref.article_topics rt
        JOIN wanted_urls w ON w.url = rt.url
        JOIN main.articles a ON a.url = rt.url
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
        INSERT OR IGNORE INTO main.pictures (title, url, image_url, caption, credit)
        SELECT p.file_title, p.url, p.image_url, COALESCE(d.caption, ''), p.credit
        FROM ref.pictures p
        LEFT JOIN ref.discovered_pictures d ON d.file_title = p.file_title
        JOIN wanted_urls w ON w.url = p.url
      `);
      e2e_db.exec(`
        INSERT OR IGNORE INTO main.picture_topics (picture_id, dataset, topic)
        SELECT p.id, '${dataset}', rpt.topic
        FROM ref.picture_topics rpt
        JOIN wanted_urls w ON w.url = rpt.url
        JOIN main.pictures p ON p.url = rpt.url
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

  const count = (table: string) =>
    (e2e_db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  // eslint-disable-next-line no-console
  console.log(
    `Imported into ${e2e_db_path}:` +
      `${count('articles')} articles, ${count('pictures')} pictures, ` +
      `${count('datasets')} datasets, ${count('article_topics')} article_topics, ` +
      `${count('picture_topics')} picture_topics`
  );
};

const init_db = async () => {
  const e2e_db_path = path.join('e2e', '.data', 'scrollsurf.db');
  const db = open_db(e2e_db_path);
  const article_count = db.prepare('select 1 from articles limit 1').get();
  if (!article_count) {
    await import_feed_items(db);
  }
  db.close();
};

export default init_db;
