import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db, ObjectId } from 'mongodb';
import { autoRest } from '../../plugin.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

let mongod: MongoMemoryServer;
let mongoUri: string;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  mongoUri = mongod.getUri() + 'testdb';
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db();
}, 60_000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

async function buildApp(
  collectionNames: string[],
  config?: Record<string, unknown>
): Promise<FastifyInstance> {
  // Ensure all collections exist before introspection so routes are mounted.
  // insertOne + deleteOne creates the collection, then cleans up.
  for (const name of collectionNames) {
    const col = db.collection(name);
    const exists = await col.findOne({});
    if (!exists) {
      const { insertedId } = await col.insertOne({ _seed: true });
      await col.deleteOne({ _id: insertedId });
    }
  }

  const app = Fastify({ logger: false });
  await app.register(autoRest, {
    mongoUri,
    prefix: '/api',
    config: config as Parameters<typeof autoRest>[1]['config'],
  });
  await app.ready();
  return app;
}

// ─── CRUD Tests ───────────────────────────────────────────────────────────────

describe('CRUD — orders collection', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(['orders']);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.collection('orders').deleteMany({});
  });

  it('POST /api/orders — creates a document and returns 201 with _id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { product: 'widget', qty: 5 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ _id: string; product: string; qty: number }>();
    expect(body._id).toBeDefined();
    expect(body.product).toBe('widget');
    expect(body.qty).toBe(5);
  });

  it('GET /api/orders — lists documents with pagination envelope', async () => {
    await db.collection('orders').insertMany([
      { product: 'a' },
      { product: 'b' },
      { product: 'c' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/orders' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; pagination: { total: number; page: number } }>();
    expect(body.data).toHaveLength(3);
    expect(body.pagination.total).toBe(3);
    expect(body.pagination.page).toBe(1);
  });

  it('GET /api/orders — page and pageSize params work', async () => {
    await db.collection('orders').insertMany([
      { product: 'a' },
      { product: 'b' },
      { product: 'c' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/orders?page=2&pageSize=2' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; pagination: { page: number; pageSize: number; totalPages: number } }>();
    expect(body.data).toHaveLength(1);
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.pageSize).toBe(2);
    expect(body.pagination.totalPages).toBe(2);
  });

  it('GET /api/orders/:id — returns the document', async () => {
    const { insertedId } = await db.collection('orders').insertOne({ product: 'widget' });

    const res = await app.inject({ method: 'GET', url: `/api/orders/${insertedId.toString()}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ product: string }>();
    expect(body.product).toBe('widget');
  });

  it('GET /api/orders/:id — returns 404 for non-existent id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/orders/${new ObjectId().toString()}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('Not found');
  });

  it('PUT /api/orders/:id — replaces the document and returns 200', async () => {
    const { insertedId } = await db.collection('orders').insertOne({ product: 'old', qty: 1 });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/orders/${insertedId.toString()}`,
      payload: { product: 'new', qty: 99 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ product: string; qty: number }>();
    expect(body.product).toBe('new');
    expect(body.qty).toBe(99);
  });

  it('PUT /api/orders/:id — returns 404 for non-existent id (no upsert)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/orders/${new ObjectId().toString()}`,
      payload: { product: 'x' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('Not found');
  });

  it('PATCH /api/orders/:id — applies $set and returns updated doc', async () => {
    const { insertedId } = await db.collection('orders').insertOne({ product: 'old', qty: 1 });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${insertedId.toString()}`,
      payload: { qty: 42 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ product: string; qty: number }>();
    expect(body.product).toBe('old'); // unchanged
    expect(body.qty).toBe(42);       // updated
  });

  it('PATCH /api/orders/:id — returns 404 for non-existent id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${new ObjectId().toString()}`,
      payload: { qty: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('Not found');
  });

  it('DELETE /api/orders/:id — returns 204 on success', async () => {
    const { insertedId } = await db.collection('orders').insertOne({ product: 'doomed' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orders/${insertedId.toString()}`,
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');

    // Confirm it's actually gone
    const doc = await db.collection('orders').findOne({ _id: insertedId });
    expect(doc).toBeNull();
  });

  it('DELETE /api/orders/:id — returns 404 for non-existent id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orders/${new ObjectId().toString()}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('Not found');
  });

  it('handles plain string _id (non-ObjectId)', async () => {
    await db.collection('orders').insertOne({ _id: 'my-string-id' as unknown as ObjectId, product: 'special' });

    const res = await app.inject({ method: 'GET', url: '/api/orders/my-string-id' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ product: string }>();
    expect(body.product).toBe('special');
  });
});

// ─── Auth Tests ───────────────────────────────────────────────────────────────

describe('Auth middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(['protected'], {
      auth: { type: 'api-key', header: 'x-api-key', keys: ['secret-key'] },
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 when auth header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('Authentication required');
  });

  it('returns 403 when auth header has wrong key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('Forbidden');
  });

  it('returns 200 when auth header has valid key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { 'x-api-key': 'secret-key' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Auth — per-collection bypass', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(['public', 'private'], {
      auth: { type: 'api-key', keys: ['secret-key'] },
      collections: {
        public: { auth: false },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('bypasses auth for collection with auth: false', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/public' });
    // No auth header — should still work
    expect(res.statusCode).toBe(200);
  });

  it('still requires auth for protected collections', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/private' });
    expect(res.statusCode).toBe(401);
  });
});

// ─── Read-Only Tests ──────────────────────────────────────────────────────────

describe('Read-only mode', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(['readonly-items'], { readOnly: true });
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('GET still works in read-only mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/readonly-items' });
    expect(res.statusCode).toBe(200);
  });

  it('POST returns 405 in read-only mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/readonly-items',
      payload: { name: 'new' },
    });
    expect(res.statusCode).toBe(405);
    expect(res.json<{ error: string }>().error).toBe('This resource is read-only');
  });

  it('PUT returns 405 in read-only mode', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/readonly-items/${new ObjectId().toString()}`,
      payload: { name: 'replaced' },
    });
    expect(res.statusCode).toBe(405);
    expect(res.json<{ error: string }>().error).toBe('This resource is read-only');
  });

  it('PATCH returns 405 in read-only mode', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/readonly-items/${new ObjectId().toString()}`,
      payload: { name: 'patched' },
    });
    expect(res.statusCode).toBe(405);
    expect(res.json<{ error: string }>().error).toBe('This resource is read-only');
  });

  it('DELETE returns 405 in read-only mode', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/readonly-items/${new ObjectId().toString()}`,
    });
    expect(res.statusCode).toBe(405);
    expect(res.json<{ error: string }>().error).toBe('This resource is read-only');
  });
});

// ─── Collection Exclusion & Aliasing ─────────────────────────────────────────

describe('Collection exclusion and aliasing', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await db.collection('users').deleteMany({});
    await db.collection('users').insertOne({ name: 'Alice' });

    app = await buildApp(['users', 'secret-internal'], {
      collections: {
        users: { alias: 'members' },
        'secret-internal': { exclude: true },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('alias renames the URL segment', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/members' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ name: string }> }>();
    expect(body.data.some((d) => d.name === 'Alice')).toBe(true);
  });

  it('original collection name is not accessible (returns 404)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/users' });
    // 'users' was aliased to 'members' — the /api/users route is not mounted
    expect(res.statusCode).toBe(404);
  });

  it('excluded collection returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/secret-internal' });
    expect(res.statusCode).toBe(404);
  });
});

// ─── system.* Exclusion ───────────────────────────────────────────────────────

describe('system.* collection exclusion', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp([]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('system.users is not accessible (no routes registered)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system.users' });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Sorting Tests ────────────────────────────────────────────────────────────

describe('List — sorting', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await db.collection('sortable').deleteMany({});
    await db.collection('sortable').insertMany([
      { value: 30 },
      { value: 10 },
      { value: 20 },
    ]);
    app = await buildApp(['sortable']);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('sort ascending by field', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sortable?sort=value' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ value: number }> }>();
    expect(body.data.map((d) => d.value)).toEqual([10, 20, 30]);
  });

  it('sort descending by field with - prefix', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sortable?sort=-value' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ value: number }> }>();
    expect(body.data.map((d) => d.value)).toEqual([30, 20, 10]);
  });
});

// ─── Filter Tests ─────────────────────────────────────────────────────────────

describe('List — filter param', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await db.collection('filterable').deleteMany({});
    await db.collection('filterable').insertMany([
      { status: 'active', score: 10 },
      { status: 'inactive', score: 20 },
      { status: 'active', score: 30 },
    ]);
    app = await buildApp(['filterable']);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('filter JSON param filters documents', async () => {
    const filter = encodeURIComponent(JSON.stringify({ status: 'active' }));
    const res = await app.inject({ method: 'GET', url: `/api/filterable?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ status: string }> }>();
    expect(body.data).toHaveLength(2);
    expect(body.data.every((d) => d.status === 'active')).toBe(true);
  });

  it('invalid filter JSON returns 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/filterable?filter=not-json' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('Invalid filter');
  });

  it('flat query params filter documents', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/filterable?status=inactive' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ status: string }> }>();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.status).toBe('inactive');
  });
});

// ─── Plugin connection failure ────────────────────────────────────────────────

describe('Plugin — MongoDB connection failure', () => {
  it('throws on bad mongo URI', async () => {
    const app = Fastify({ logger: false });
    await expect(
      app.register(autoRest, {
        mongoUri: 'mongodb://127.0.0.1:1/invalid',  // port 1 — nothing listening
        prefix: '/api',
      })
    ).rejects.toThrow();
  });
});
