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
  'vital_50000.db': [
    'https://en.wikipedia.org/wiki/Pacific_Northwest',
    'https://en.wikipedia.org/wiki/Pacific_Games',
    'https://en.wikipedia.org/wiki/Pacific_bluefin_tuna',
    'https://en.wikipedia.org/wiki/Pacific_plate',
    'https://en.wikipedia.org/wiki/Pacific_Islands_Forum',
    'https://en.wikipedia.org/wiki/Pacific_temperate_rainforests',
    'https://en.wikipedia.org/wiki/Pacific%E2%80%93Antarctic_Ridge',
  ],
  'unusual.db': [
    'https://en.wikipedia.org/wiki/%C5%8Ckunoshima',
    'https://en.wikipedia.org/wiki/Toynbee_tiles',
    'https://en.wikipedia.org/wiki/Tarrare',
    'https://en.wikipedia.org/wiki/%C2%BFPor_qu%C3%A9_no_te_callas%3F',
    'https://en.wikipedia.org/wiki/%C3%84ngelholm_UFO_memorial',
    'https://en.wikipedia.org/wiki/%C5%A0akotis',
    'https://en.wikipedia.org/wiki/%C5%BDeljava_Air_Base',
  ],
  'good_articles.db': [
    'https://en.wikipedia.org/wiki/Beyonc%C3%A9_(album)',
    'https://en.wikipedia.org/wiki/Dua_Lipa_(album)',
    'https://en.wikipedia.org/wiki/Led_Zeppelin_(album)',
    'https://en.wikipedia.org/wiki/The_Beatles_(album)',
    'https://en.wikipedia.org/wiki/Autobahn_(album)',
    'https://en.wikipedia.org/wiki/Banksia_acanthopoda',
    'https://en.wikipedia.org/wiki/Hurricane_Katrina_(1981)',
  ],
  'featured_articles.db': [
    'https://en.wikipedia.org/wiki/Black_hole',
    'https://en.wikipedia.org/wiki/Mercury_(planet)',
    'https://en.wikipedia.org/wiki/Peregrine_falcon',
    'https://en.wikipedia.org/wiki/Sun',
    'https://en.wikipedia.org/wiki/%C3%86thelstan',
    'https://en.wikipedia.org/wiki/%C3%86thelfl%C3%A6d',
    'https://en.wikipedia.org/wiki/%C3%86thelberht_of_Kent',
  ],
};

export const PICTURE_FIXTURES: Record<string, string[]> = {
  'featured_pictures.db': [
    'https://commons.wikimedia.org/wiki/File:%22A_New_Sandow_Pose_(VIII)%22,_Eugen_Sandow_Wellcome_L0035270_-_restoration.jpg',
    'https://commons.wikimedia.org/wiki/File:%22The_School_of_Athens%22_by_Raffaello_Sanzio_da_Urbino.jpg',
    'https://commons.wikimedia.org/wiki/File:%27One_of_the_wards_in_the_hospital_at_Scutari%27._Wellcome_M0007724_-_restoration,_cropped.jpg',
    'https://commons.wikimedia.org/wiki/File:%C3%81gora,_Ciudad_de_las_Artes_y_las_Ciencias,_Valencia,_Espa%C3%B1a,_2014-06-29,_DD_58.jpg',
  ],
  'commons_featured_pictures.db': [
    'https://commons.wikimedia.org/wiki/File:%22A_sure_horse_for_the_first_money%22_LCCN2002695764-restored.jpg',
    'https://commons.wikimedia.org/wiki/File:%22Everything_is_Going_to_be_Alright%22_artwork,_Christchurch_Art_Gallery,_Christchurch,_New_Zealand.jpg',
    'https://commons.wikimedia.org/wiki/File:%22Horas_de_Chumbo%22,_by_Rui_Chafes,_Parque_das_Na%C3%A7%C3%B5es,_Lisbon,_Portugal_julesvernex2-2.jpg',
  ],
};
