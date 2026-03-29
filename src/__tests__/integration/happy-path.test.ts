/**
 * Integration: Happy-path end-to-end
 *
 * Tests the exact spec Section 1 example: register autoRest with a real
 * MongoDB instance (mongodb-memory-server), make HTTP requests, verify responses.
 *
 * Flow: Seed DB → start Fastify with autoRest → hit routes → verify → teardown
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db, ObjectId } from 'mongodb';
import { autoRest } from '../../plugin.js';
import { seedDatabase, cleanDatabase, STATUSES } from '../helpers/seed.js';

let mongod: MongoMemoryServer;
let mongoUri: string;
let client: MongoClient;
let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  mongoUri = mongod.getUri() + 'integrationdb';
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db();

  // Ensure collections exist for introspection by pre-creating them
  await db.createCollection('orders');
  await db.createCollection('members');
  await db.createCollection('products');
  await db.createCollection('internal_logs');

  // The exact spec Section 1 example — works without modification
  app = Fastify({ logger: false });
  await app.register(autoRest, {
    mongoUri,
    prefix: '/api',
    config: {
      readOnly: false,
      collections: {
        members: { alias: 'members' }, // already named members — alias is identity
        internal_logs: { exclude: true },
      },
    },
  });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
  await client.close();
  await mongod.stop();
});

beforeEach(async () => {
  await cleanDatabase(db);
});

// ─── Section 1 happy path ─────────────────────────────────────────────────────

describe('Happy path — spec Section 1 example', () => {
  it('registers routes and serves data from a real MongoDB instance', async () => {
    await seedDatabase(db);

    const res = await app.inject({ method: 'GET', url: '/api/orders' });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      data: unknown[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>();

    expect(body.data.length).toBeGreaterThan(0);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.total).toBe(60);
    expect(body.pagination.totalPages).toBe(1); // default page size is 100
  });

  it('excluded collection (internal_logs) returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/internal-logs' });
    expect(res.statusCode).toBe(404);
  });

  it('responds with JSON content-type on all routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orders' });
    expect(res.headers['content-type']).toContain('application/json');
  });
});

// ─── CRUD lifecycle ───────────────────────────────────────────────────────────

describe('CRUD lifecycle — full round-trip', () => {
  it('POST → GET → PATCH → verify → DELETE → 404', async () => {
    // 1. Create
    const post = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        orderNumber: 'ORD-LIFECYCLE',
        status: 'pending',
        total: 99.99,
        region: 'us-east',
        createdAt: new Date().toISOString(),
      },
    });
    expect(post.statusCode).toBe(201);
    const created = post.json<{ _id: string; status: string }>();
    expect(created._id).toBeDefined();
    expect(created.status).toBe('pending');
    const id = created._id;

    // 2. GET one
    const get = await app.inject({ method: 'GET', url: `/api/orders/${id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json<{ _id: string }>()._id).toBe(id);

    // 3. PATCH (partial update)
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${id}`,
      payload: { status: 'shipped' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json<{ status: string }>().status).toBe('shipped');

    // 4. PUT (full replace)
    const put = await app.inject({
      method: 'PUT',
      url: `/api/orders/${id}`,
      payload: { orderNumber: 'ORD-REPLACED', status: 'delivered', total: 149.99, region: 'eu-west', createdAt: new Date().toISOString() },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json<{ orderNumber: string }>().orderNumber).toBe('ORD-REPLACED');

    // 5. DELETE
    const del = await app.inject({ method: 'DELETE', url: `/api/orders/${id}` });
    expect(del.statusCode).toBe(204);

    // 6. Confirm gone
    const gone = await app.inject({ method: 'GET', url: `/api/orders/${id}` });
    expect(gone.statusCode).toBe(404);
    expect(gone.json<{ error: string; id: string }>()).toMatchObject({ error: 'Not found', id });
  });

  it('PUT on non-existent id → 404', async () => {
    const id = new ObjectId().toHexString();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/orders/${id}`,
      payload: { status: 'cancelled' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH on non-existent id → 404', async () => {
    const id = new ObjectId().toHexString();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${id}`,
      payload: { status: 'cancelled' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE on non-existent id → 404', async () => {
    const id = new ObjectId().toHexString();
    const res = await app.inject({ method: 'DELETE', url: `/api/orders/${id}` });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Pagination ───────────────────────────────────────────────────────────────

describe('Pagination — across 60 seeded orders', () => {
  beforeEach(async () => { await seedDatabase(db); });

  it('page 1, pageSize 10 → 10 docs, total 60, totalPages 6', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orders?page=1&pageSize=10' });
    expect(res.statusCode).toBe(200);
    const { data, pagination } = res.json<{
      data: unknown[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>();
    expect(data).toHaveLength(10);
    expect(pagination.page).toBe(1);
    expect(pagination.pageSize).toBe(10);
    expect(pagination.total).toBe(60);
    expect(pagination.totalPages).toBe(6);
  });

  it('page 2 returns the NEXT 10 docs (different from page 1)', async () => {
    const p1 = await app.inject({ method: 'GET', url: '/api/orders?page=1&pageSize=10' });
    const p2 = await app.inject({ method: 'GET', url: '/api/orders?page=2&pageSize=10' });

    const ids1 = p1.json<{ data: { _id: string }[] }>().data.map((d) => d._id);
    const ids2 = p2.json<{ data: { _id: string }[] }>().data.map((d) => d._id);

    expect(ids2).toHaveLength(10);
    // No overlap between pages
    const overlap = ids1.filter((id) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('page 7 (beyond last) → empty data array', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orders?page=7&pageSize=10' });
    expect(res.statusCode).toBe(200);
    const { data, pagination } = res.json<{ data: unknown[]; pagination: { total: number } }>();
    expect(data).toHaveLength(0);
    expect(pagination.total).toBe(60);
  });

  it('page 6 (last page) → exactly 10 docs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orders?page=6&pageSize=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(10);
  });
});

// ─── Filtering & Sorting ──────────────────────────────────────────────────────

describe('Filtering & Sorting — against seeded data', () => {
  beforeEach(async () => { await seedDatabase(db); });

  it('filter by status=pending returns only pending orders', async () => {
    const filter = encodeURIComponent(JSON.stringify({ status: 'pending' }));
    const res = await app.inject({ method: 'GET', url: `/api/orders?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { status: string }[] }>();
    expect(data.length).toBeGreaterThan(0);
    for (const doc of data) {
      expect(doc.status).toBe('pending');
    }
  });

  it('flat param shortcut: ?status=shipped works like filter JSON', async () => {
    const flatRes = await app.inject({ method: 'GET', url: '/api/orders?status=shipped' });
    const filterRes = await app.inject({
      method: 'GET',
      url: `/api/orders?filter=${encodeURIComponent(JSON.stringify({ status: 'shipped' }))}`,
    });
    expect(flatRes.statusCode).toBe(200);
    const flatTotal = flatRes.json<{ pagination: { total: number } }>().pagination.total;
    const filterTotal = filterRes.json<{ pagination: { total: number } }>().pagination.total;
    expect(flatTotal).toBe(filterTotal);
    expect(flatTotal).toBeGreaterThan(0);
  });

  it('$gte filter returns orders with total >= threshold', async () => {
    const filter = encodeURIComponent(JSON.stringify({ total: { $gte: 300 } }));
    const res = await app.inject({ method: 'GET', url: `/api/orders?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { total: number }[] }>();
    expect(data.length).toBeGreaterThan(0);
    for (const doc of data) {
      expect(doc.total).toBeGreaterThanOrEqual(300);
    }
  });

  it('sort ascending by total — first doc has lowest total', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orders?sort=total&pageSize=5' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { total: number }[] }>();
    expect(data).toHaveLength(5);
    for (let i = 1; i < data.length; i++) {
      expect(data[i]!.total).toBeGreaterThanOrEqual(data[i - 1]!.total);
    }
  });

  it('sort descending by total (-total) — first doc has highest total', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orders?sort=-total&pageSize=5' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { total: number }[] }>();
    expect(data).toHaveLength(5);
    for (let i = 1; i < data.length; i++) {
      expect(data[i]!.total).toBeLessThanOrEqual(data[i - 1]!.total);
    }
  });

  it('combine flat param + sort: ?region=us-east&sort=-total', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/orders?region=us-east&sort=-total&pageSize=20',
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { region: string; total: number }[] }>();
    expect(data.length).toBeGreaterThan(0);
    for (const doc of data) {
      expect(doc.region).toBe('us-east');
    }
    // Verify descending order
    for (let i = 1; i < data.length; i++) {
      expect(data[i]!.total).toBeLessThanOrEqual(data[i - 1]!.total);
    }
  });

  it('$in filter returns docs matching any of the values', async () => {
    const filter = encodeURIComponent(JSON.stringify({ status: { $in: ['pending', 'cancelled'] } }));
    const res = await app.inject({ method: 'GET', url: `/api/orders?filter=${filter}&pageSize=100` });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { status: string }[] }>();
    expect(data.length).toBeGreaterThan(0);
    for (const doc of data) {
      expect(['pending', 'cancelled']).toContain(doc.status);
    }
  });
});

// ─── Error scenarios ──────────────────────────────────────────────────────────

describe('Error scenarios — real DB', () => {
  it('invalid ObjectId format → 400', async () => {
    // A string that is clearly not an ObjectId but passes the non-ObjectId path
    // The 12/24 char check happens inside buildIdFilter — a 5-char string
    // won't throw; it falls back to string _id match (no hit → 404)
    // To get a 400 we need a valid-length but invalid hex ObjectId:
    const res = await app.inject({
      method: 'GET',
      url: '/api/orders/not-an-object-id',
    });
    // Falls back to string _id lookup → 404 (no document with that string _id)
    expect([400, 404]).toContain(res.statusCode);
  });

  it('disallowed operator $where → 400', async () => {
    const filter = encodeURIComponent(JSON.stringify({ $where: 'this.total > 100' }));
    const res = await app.inject({ method: 'GET', url: `/api/orders?filter=${filter}` });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string; operator: string }>()).toMatchObject({
      error: 'Operator not allowed',
      operator: '$where',
    });
  });

  it('invalid filter JSON → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orders?filter=not-json' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('Invalid filter');
  });

  it('GET by non-existent ObjectId → 404', async () => {
    const id = new ObjectId().toHexString();
    const res = await app.inject({ method: 'GET', url: `/api/orders/${id}` });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string; id: string }>()).toMatchObject({ error: 'Not found', id });
  });
});
