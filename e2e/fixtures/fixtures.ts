// Test fixtures: a curated selection of rows from the local `datasets/*.db`
// reference DBs, chosen by URL. `seed-test-db.ts` copies each selected row's
// real content (title, extract, image, topics, categories) into the test DB at
// `e2e/.data/scrollsurf.db`, so previews show real content and tests run offline.
//
// To add a fixture: paste a URL from the relevant dataset into the right group
// below. Find candidate URLs with:  npm run fixtures:list -- <dataset.db> [search]
// Keep at least 2 URLs per dataset. The map key is the reference DB filename;
// the dataset's display name comes from that DB's own metadata at seed time.

export const ARTICLE_FIXTURES: Record<string, string[]> = {
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

export const PICTURE_FIXTURES: Record<string, string[]> = {
  'commons_featured_pictures.db': [
    'https://commons.wikimedia.org/wiki/File:Priegendorf_Kirche-20250302-RM-155839.jpg',
    'https://commons.wikimedia.org/wiki/File:Inside_Ngorongoro_crater.jpg',
  ],
  'featured_pictures.db': [
    'https://commons.wikimedia.org/wiki/File:%27One_of_the_wards_in_the_hospital_at_Scutari%27._Wellcome_M0007724_-_restoration,_cropped.jpg',
    'https://commons.wikimedia.org/wiki/File:Portrait_of_King_Yeongjo_-_Chae_Yong_Shin_(%E8%94%A1%E9%BE%8D%E8%87%A3_1850-1941)_Cho_Seok-jin_(%E8%B6%99%E9%8C%AB%E6%99%89_1853-1920)_et_(cropped).jpg',
  ],
};
