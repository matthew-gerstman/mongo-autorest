/**
 * Integration: Explorer routes
 *
 * Full integration with MongoMemoryServer. Tests /explorer and
 * /explorer-api/collections endpoints via the autoRest plugin.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { autoRest } from '../../plugin.js';

let mongod: MongoMemoryServer;
let mongoUri: string;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  mongoUri = mongod.getUri() + 'explorerintegrationdb';
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db();

  // Seed some data
  await db.createCollection('pokemon');
  await db.createCollection('records');
  await db.collection('pokemon').insertMany([
    { name: 'Bulbasaur', type: 'Grass', level: 5 },
    { name: 'Charmander', type: 'Fire', level: 5 },
    { name: 'Squirtle', type: 'Water', level: 5 },
  ]);
  await db.collection('records').insertMany([
    { title: 'Dark Side of the Moon', artist: 'Pink Floyd', year: 1973 },
    { title: 'Abbey Road', artist: 'Beatles', year: 1969 },
  ]);
}, 60_000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

describe('/explorer — enabled by default in non-production', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(autoRest, { mongoUri, prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it('returns 200 HTML for GET /explorer', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<!DOCTYPE html>');
  });

  it('HTML contains expected structure', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer' });
    expect(res.body).toContain('id="sidebar"');
    expect(res.body).toContain('id="collections-list"');
    expect(res.body).toContain('id="detail-panel"');
  });

  it('returns 200 JSON for GET /explorer-api/collections', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer-api/collections' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ collections: Array<{ name: string; slug: string; count: number; schema: unknown }> }>();
    expect(Array.isArray(body.collections)).toBe(true);
    expect(body.collections.length).toBeGreaterThan(0);
  });

  it('/explorer-api/collections includes pokemon and records', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer-api/collections' });
    const body = res.json<{ collections: Array<{ name: string; slug: string; count: number }> }>();
    const names = body.collections.map(c => c.name);
    expect(names).toContain('pokemon');
    expect(names).toContain('records');
  });

  it('/explorer-api/collections has count and schema fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer-api/collections' });
    const body = res.json<{ collections: Array<{ name: string; count: number; schema: unknown }> }>();
    for (const col of body.collections) {
      expect(typeof col.count).toBe('number');
      expect(col.schema).toBeDefined();
    }
  });
});

describe('/explorer — disabled in production (default)', () => {
  let app: FastifyInstance;
  const origEnv = process.env['NODE_ENV'];

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'production';
    app = Fastify({ logger: false });
    await app.register(autoRest, { mongoUri, prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    process.env['NODE_ENV'] = origEnv;
    await app.close();
  });

  it('returns 404 for /explorer in production by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for /explorer-api/collections in production by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer-api/collections' });
    expect(res.statusCode).toBe(404);
  });
});

describe('/explorer — force-enabled in production via config.explorer = true', () => {
  let app: FastifyInstance;
  const origEnv = process.env['NODE_ENV'];

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'production';
    app = Fastify({ logger: false });
    await app.register(autoRest, {
      mongoUri,
      prefix: '/api',
      config: { explorer: true },
    });
    await app.ready();
  });

  afterAll(async () => {
    process.env['NODE_ENV'] = origEnv;
    await app.close();
  });

  it('serves /explorer in production when config.explorer = true', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer' });
    expect(res.statusCode).toBe(200);
  });
});

describe('/explorer — disabled via config.explorer = false', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(autoRest, {
      mongoUri,
      prefix: '/api',
      config: { explorer: false },
    });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it('returns 404 for /explorer when config.explorer = false', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer' });
    expect(res.statusCode).toBe(404);
  });
});

describe('/explorer — respects excluded collections', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(autoRest, {
      mongoUri,
      prefix: '/api',
      config: {
        collections: {
          records: { exclude: true },
        },
      },
    });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it('excluded collection does not appear in /explorer-api/collections', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer-api/collections' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ collections: Array<{ name: string }> }>();
    const names = body.collections.map(c => c.name);
    expect(names).not.toContain('records');
  });
});

describe('/explorer — publicly accessible even when auth is configured', () => {
  // Explorer routes bypass auth entirely. The /explorer HTML page and
  // /explorer-api/collections metadata endpoint are public — just like Swagger UI.
  // The explorer's client-side JS fetches /api/* routes which DO require auth,
  // and the UI exposes an API key input field for that purpose.
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(autoRest, {
      mongoUri,
      prefix: '/api',
      config: {
        auth: { type: 'api-key', keys: ['test-secret-key'] },
      },
    });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it('returns 200 for /explorer WITHOUT any api key (public)', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('returns 200 for /explorer WITH a valid api key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/explorer',
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 200 for /explorer-api/collections WITHOUT any api key (public)', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer-api/collections' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ collections: unknown[] }>();
    expect(Array.isArray(body.collections)).toBe(true);
  });

  it('returns 200 for /explorer-api/collections WITH a valid api key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/explorer-api/collections',
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('HTML includes api-key-input field when auth is configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer' });
    expect(res.body).toContain('api-key-input');
  });

  it('/api/* data routes still require auth (401 without key)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pokemon' });
    expect(res.statusCode).toBe(401);
  });

  it('/api/* data routes still require auth (403 with wrong key)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/pokemon',
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('/api/* data routes work with valid key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/pokemon',
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('/explorer — custom explorerOptions', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(autoRest, {
      mongoUri,
      prefix: '/api',
      config: {
        explorer: true,
        explorerOptions: {
          title: 'My Custom Explorer',
          theme: 'dark',
          defaultPageSize: 50,
        },
      },
    });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it('uses custom title in the HTML', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer' });
    expect(res.body).toContain('My Custom Explorer');
  });

  it('applies dark theme class', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer' });
    expect(res.body).toContain('theme-dark');
  });

  it('uses custom defaultPageSize', async () => {
    const res = await app.inject({ method: 'GET', url: '/explorer' });
    expect(res.body).toContain('pageSize: 50');
  });
});
