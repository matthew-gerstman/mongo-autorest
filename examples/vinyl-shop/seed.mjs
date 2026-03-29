import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';

export function transformDiscogsData(releases) {
  const records = [];
  const artistMap = new Map();

  for (const r of releases) {
    const info = r.basic_information;
    const artistNames = info.artists
      .filter(a => a.name !== 'Various')
      .map(a => a.name);
    const artist = artistNames.join(', ') || 'Various Artists';
    const year = info.year || 0;
    const decade = year ? `${Math.floor(year / 10) * 10}s` : 'Unknown';
    
    const formats = [];
    for (const fmt of info.formats || []) {
      formats.push(fmt.name);
      for (const desc of fmt.descriptions || []) {
        formats.push(desc);
      }
    }

    const record = {
      discogsId: info.id,
      title: info.title,
      artist,
      year,
      decade,
      genres: info.genres || [],
      styles: info.styles || [],
      formats,
      label: info.labels?.[0]?.name || 'Unknown',
      catalogNo: info.labels?.[0]?.catno || '',
      coverImage: info.cover_image || '',
      thumb: info.thumb || '',
      dateAdded: r.date_added || '',
      country: info.country || '',
    };
    records.push(record);

    // Build artist profiles
    for (const a of info.artists.filter(x => x.name !== 'Various')) {
      if (!artistMap.has(a.name)) {
        artistMap.set(a.name, {
          name: a.name,
          discogsId: a.id,
          recordCount: 0,
          genres: new Set(),
          decades: new Set(),
        });
      }
      const ap = artistMap.get(a.name);
      ap.recordCount++;
      for (const g of info.genres || []) ap.genres.add(g);
      if (decade !== 'Unknown') ap.decades.add(decade);
    }
  }

  const artists = [...artistMap.values()].map(a => ({
    ...a,
    genres: [...a.genres],
    decades: [...a.decades],
  }));

  return { records, artists };
}

export async function seedDatabase(mongoUri) {
  const raw = JSON.parse(readFileSync('/home/user/work/discogs-data/full-collection.json', 'utf-8'));
  const { records, artists } = transformDiscogsData(raw);

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db();

  // Drop existing
  await db.collection('records').drop().catch(() => {});
  await db.collection('artists').drop().catch(() => {});
  await db.collection('sales').drop().catch(() => {});
  await db.collection('wishlist').drop().catch(() => {});

  // Insert
  await db.collection('records').insertMany(records);
  await db.collection('artists').insertMany(artists);
  // Sales starts empty — populated via POST
  // Wishlist starts empty — populated via POST

  console.log(`✅ Seeded: ${records.length} records, ${artists.length} artists`);
  console.log(`   Collections: records, artists, sales, wishlist`);
  
  await client.close();
  return { recordCount: records.length, artistCount: artists.length };
}
