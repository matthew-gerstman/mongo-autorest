/**
 * Integration: Auth & read-only flows end-to-end.
 *
 * Tests the full auth middleware stack against a real MongoDB instance:
 *   missing key → 401 | wrong key → 403 | correct key → 200
 *
 * Tests read-only registration:
 *   GET works | POST/PUT/PATCH/DELETE → 405
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { autoRest } from '../../plugin.js';
import { seedDatabase, cleanDatabase } from '../helpers/seed.js';

// ─── Shared infrastructure ────────────────────────────────────────────────────

let mongod: MongoMemoryServer;
let mongoUri: string;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  mongoUri = mongod.getUri() + 'authdb';
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db();

  // Pre-create collections so they survive introspection
  await db.createCollection('orders');
  await db.createCollection('products');
}, 60_000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

// ─── Auth flow ─────────────────────────────────────────────────────────────────

describe('Auth flow end-to-end', () => {
  let authApp: FastifyInstance;

  beforeAll(async () => {
    await cleanDatabase(db);
    await seedDatabase(db);

    authApp = Fastify({ logger: false });
    await authApp.register(autoRest, {
      mongoUri,
      prefix: '/api',
      config: {
        auth: {
          type: 'api-key',
          header: 'x-api-key',
          keys: ['valid-test-key-abc'],
        },
        collections: {
          // products has auth disabled — public access
          products: { auth: false },
        },
      },
    });
    await authApp.ready();
  }, 60_000);

  afterAll(async () => { await authApp.close(); });

  it('missing x-api-key header → 401', async () => {
    const res = await authApp.inject({ method: 'GET', url: '/api/orders' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('Authentication required');
  });

  it('wrong key → 403', async () => {
    const res = await authApp.inject({
      method: 'GET',
      url: '/api/orders',
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('Forbidden');
  });

  it('correct key → 200 with data', async () => {
    const res = await authApp.inject({
      method: 'GET',
      url: '/api/orders',
      headers: { 'x-api-key': 'valid-test-key-abc' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; pagination: { total: number } }>();
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('collection with auth: false is publicly accessible', async () => {
    // products has auth: false — no key needed
    const res = await authApp.inject({ method: 'GET', url: '/api/products' });
    expect(res.statusCode).toBe(200);
  });

  it('write to auth-protected resource with correct key → 201', async () => {
    const res = await authApp.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'x-api-key': 'valid-test-key-abc' },
      payload: { orderNumber: 'ORD-AUTH', status: 'pending', total: 10 },
    });
    expect(res.statusCode).toBe(201);
  });

  it('write to auth-protected resource with no key → 401', async () => {
    const res = await authApp.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { orderNumber: 'ORD-NOAUTH', status: 'pending', total: 10 },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── Read-only flow ───────────────────────────────────────────────────────────

describe('Read-only mode end-to-end', () => {
  let readOnlyApp: FastifyInstance;

  beforeAll(async () => {
    await cleanDatabase(db);
    await seedDatabase(db);

    readOnlyApp = Fastify({ logger: false });
    await readOnlyApp.register(autoRest, {
      mongoUri,
      prefix: '/api',
      config: {
        readOnly: true,
        collections: {
          // orders overrides global readOnly — it allows writes
          orders: { readOnly: false },
        },
      },
    });
    await readOnlyApp.ready();
  }, 60_000);

  afterAll(async () => { await readOnlyApp.close(); });

  it('GET /api/products → 200 (read works in read-only mode)', async () => {
    const res = await readOnlyApp.inject({ method: 'GET', url: '/api/products' });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/products → 405 (write blocked by global readOnly)', async () => {
    const res = await readOnlyApp.inject({
      method: 'POST',
      url: '/api/products',
      payload: { sku: 'X', name: 'test', price: 1 },
    });
    expect(res.statusCode).toBe(405);
    expect(res.json<{ error: string }>().error).toBe('This resource is read-only');
  });

  it('PUT /api/products/:id → 405', async () => {
    const res = await readOnlyApp.inject({
      method: 'PUT',
      url: '/api/products/some-id',
      payload: { name: 'replaced' },
    });
    expect(res.statusCode).toBe(405);
  });

  it('PATCH /api/products/:id → 405', async () => {
    const res = await readOnlyApp.inject({
      method: 'PATCH',
      url: '/api/products/some-id',
      payload: { name: 'patched' },
    });
    expect(res.statusCode).toBe(405);
  });

  it('DELETE /api/products/:id → 405', async () => {
    const res = await readOnlyApp.inject({ method: 'DELETE', url: '/api/products/some-id' });
    expect(res.statusCode).toBe(405);
  });

  it('orders overrides global readOnly → POST returns 201', async () => {
    const res = await readOnlyApp.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { orderNumber: 'ORD-WRITE', status: 'pending', total: 5 },
    });
    expect(res.statusCode).toBe(201);
  });

  it('orders overrides global readOnly → GET returns 200', async () => {
    const res = await readOnlyApp.inject({ method: 'GET', url: '/api/orders' });
    expect(res.statusCode).toBe(200);
  });
});

// ─── Alias & exclude flow ─────────────────────────────────────────────────────

describe('Collection alias & exclude end-to-end', () => {
  let aliasApp: FastifyInstance;

  beforeAll(async () => {
    // Seed data directly into 'members' and a hidden 'internal_logs' collection
    await db.collection('members').insertMany([{ name: 'Alice' }, { name: 'Bob' }]);
    await db.collection('internal_logs').insertMany([{ msg: 'secret' }]);

    aliasApp = Fastify({ logger: false });
    await aliasApp.register(autoRest, {
      mongoUri,
      prefix: '/api',
      config: {
        collections: {
          internal_logs: { exclude: true },
        },
      },
    });
    await aliasApp.ready();
  }, 60_000);

  afterAll(async () => {
    await aliasApp.close();
    await db.collection('members').deleteMany({});
    await db.collection('internal_logs').deleteMany({});
  });

  it('members collection is routable at /api/members', async () => {
    const res = await aliasApp.inject({ method: 'GET', url: '/api/members' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { name: string }[] }>();
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  it('excluded collection internal_logs is NOT routable', async () => {
    const res = await aliasApp.inject({ method: 'GET', url: '/api/internal-logs' });
    expect(res.statusCode).toBe(404);
  });
});
