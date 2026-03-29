import Fastify from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { autoRest } from 'mongo-autorest';
import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';
import { seedDatabase } from './seed.mjs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('🔴 Pokédex — Starting up...');

  // Start MongoDB
  console.log('📦 Starting MongoDB...');
  const mongod = await MongoMemoryServer.create();
  const baseUri = mongod.getUri();
  const mongoUri = baseUri + 'pokedex';
  console.log(`   MongoDB running at ${mongoUri}`);

  // Seed the database
  console.log('🌱 Seeding Pokédex data (1,025 Pokémon)...');
  await seedDatabase(mongoUri);

  // Create Fastify app
  const app = Fastify({ logger: false });

  // === THIS IS THE ENTIRE BACKEND — one autoRest config ===
  await app.register(autoRest, {
    mongoUri,
    prefix: '/api',
    config: {
      auth: {
        type: 'api-key',
        header: 'x-api-key',
        keys: ['pokedex-demo-key'],
      },
      defaultPageSize: 24,
      collections: {
        // Read-only public Pokédex, aliased from "pokemon" to "pokedex"
        pokemon: { readOnly: true, alias: 'pokedex', auth: false },
        // Type effectiveness data — public read-only
        types: { readOnly: true, auth: false },
        // Battle log — requires API key to write
        battles: { readOnly: false },
        // Team builder — requires API key to write
        teams: { readOnly: false },
      },
      webhooks: [
        {
          url: 'http://localhost:3001/hooks/battle',
          events: ['document.created'],
          secret: 'pokedex-webhook-secret',
          collections: ['battles'],
        },
      ],
      serveOpenApi: true,
      swaggerUi: true,
    },
  });

  // === SSE — Live battle ticker ===
  const sseClients = new Set();

  app.get('/api/live', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.write('data: {"type":"connected","message":"Live battle feed connected"}\n\n');
    sseClients.add(reply.raw);
    req.raw.on('close', () => sseClients.delete(reply.raw));
  });

  // Webhook receiver → broadcast to SSE clients
  app.post('/hooks/battle', async (req, reply) => {
    const payload = req.body;
    const event = `data: ${JSON.stringify({ type: 'battle', ...payload })}\n\n`;
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

  const port = 3001;
  await app.listen({ host: '0.0.0.0', port });

  console.log(`\n🔴 Pokédex is live!`);
  console.log(`   🌐 http://localhost:${port}`);
  console.log(`   📖 http://localhost:${port}/docs`);
  console.log(`   📡 SSE: http://localhost:${port}/api/live`);
  console.log(`   🔑 API Key: pokedex-demo-key`);
  console.log(`   📊 1,025 Pokémon | 18 types | battles & teams via CRUD`);
}

main().catch(err => { console.error('❌', err); process.exit(1); });
