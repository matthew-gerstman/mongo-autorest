import Fastify from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { autoRest } from 'mongo-autorest';
import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';
import { transformDiscogsData } from './seed.mjs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('🎵 Gerstman\'s Records — Starting up...');

  // Start MongoDB
  console.log('📀 Starting MongoDB...');
  const mongod = await MongoMemoryServer.create();
  const baseUri = mongod.getUri();
  // Append db name so autoRest uses the right database
  const mongoUri = baseUri + 'gerstmans_records';
  console.log(`   MongoDB running at ${mongoUri}`);

  // Seed the database
  console.log('🌱 Seeding database...');
  const raw = JSON.parse(readFileSync(new URL('./data/discogs-collection.json', import.meta.url).pathname, 'utf-8'));
  const { records, artists } = transformDiscogsData(raw);

  const seedClient = new MongoClient(mongoUri);
  await seedClient.connect();
  const db = seedClient.db();
  
  await db.collection('records').insertMany(records);
  await db.collection('artists').insertMany(artists);
  // sales + wishlist start empty
  await db.createCollection('sales');
  await db.createCollection('wishlist');
  await seedClient.close();
  
  console.log(`✅ Seeded: ${records.length} records, ${artists.length} artists`);

  // Create Fastify app
  const app = Fastify({ logger: false });

  // === THIS IS THE ENTIRE BACKEND — one config object ===
  await app.register(autoRest, {
    mongoUri,
    prefix: '/api',
    config: {
      readOnly: false,
      auth: {
        type: 'api-key',
        header: 'x-api-key',
        keys: ['gerstmans-demo-key-2024'],
      },
      defaultPageSize: 24,
      collections: {
        records: { readOnly: true, alias: 'vinyl', auth: false },
        artists: { readOnly: true, auth: false },
        sales: { readOnly: false },
        wishlist: { readOnly: false },
      },
      webhooks: [
        {
          url: 'http://localhost:3000/hooks/sale',
          events: ['document.created'],
          secret: 'gerstmans-webhook-secret',
          collections: ['sales'],
        },
      ],
      serveOpenApi: true,
      swaggerUi: true,
    },
  });

  // === SSE for live "Just Sold" ticker ===
  const sseClients = new Set();

  app.get('/api/live', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.write('data: {"type":"connected"}\n\n');
    sseClients.add(reply.raw);
    req.raw.on('close', () => sseClients.delete(reply.raw));
  });

  // Webhook receiver → broadcast to SSE
  app.post('/hooks/sale', async (req, reply) => {
    const payload = req.body;
    const event = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try { client.write(event); } catch { sseClients.delete(client); }
    }
    return { ok: true };
  });

  // === Serve static frontend ===
  const staticDir = new URL('./public', import.meta.url).pathname;
  
  app.get('/', async (req, reply) => {
    reply.type('text/html').send(readFileSync(join(staticDir, 'index.html'), 'utf-8'));
  });

  app.get('/records.json', async (req, reply) => {
    reply.type('application/json').send(readFileSync(join(staticDir, 'records.json'), 'utf-8'));
  });

  const port = 3000;
  await app.listen({ host: '0.0.0.0', port });
  console.log(`\n🎶 Gerstman's Records is live!`);
  console.log(`   🌐 http://localhost:${port}`);
  console.log(`   📖 http://localhost:${port}/docs`);
  console.log(`   📀 ${records.length} records | ${artists.length} artists`);
  console.log(`   🔑 API Key: gerstmans-demo-key-2024`);
}

main().catch(err => { console.error('❌', err); process.exit(1); });
