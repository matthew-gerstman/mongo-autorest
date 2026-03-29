import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { autoRest } from '../../plugin.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

let mongod: MongoMemoryServer;
let mongoUri: string;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  mongoUri = mongod.getUri() + 'filtertest';
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

// ─── Operator allowlist integration tests ─────────────────────────────────────

describe('Operator allowlist — integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(['items']);
    await db.collection('items').insertMany([
      { status: 'active', score: 10, category: 'A' },
      { status: 'inactive', score: 20, category: 'B' },
      { status: 'active', score: 30, category: 'A' },
    ]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.collection('items').deleteMany({});
    await db.collection('items').insertMany([
      { status: 'active', score: 10, category: 'A' },
      { status: 'inactive', score: 20, category: 'B' },
      { status: 'active', score: 30, category: 'A' },
    ]);
  });

  // ── Allowed operators ──────────────────────────────────────────────────────

  it('$eq operator filters correctly', async () => {
    const filter = encodeURIComponent(JSON.stringify({ status: { $eq: 'active' } }));
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  it('$ne operator filters correctly', async () => {
    const filter = encodeURIComponent(JSON.stringify({ status: { $ne: 'active' } }));
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(1);
  });

  it('$gt operator filters correctly', async () => {
    const filter = encodeURIComponent(JSON.stringify({ score: { $gt: 15 } }));
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  it('$gte operator filters correctly', async () => {
    const filter = encodeURIComponent(JSON.stringify({ score: { $gte: 20 } }));
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  it('$lt operator filters correctly', async () => {
    const filter = encodeURIComponent(JSON.stringify({ score: { $lt: 20 } }));
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(1);
  });

  it('$lte operator filters correctly', async () => {
    const filter = encodeURIComponent(JSON.stringify({ score: { $lte: 20 } }));
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  it('$in operator filters correctly', async () => {
    const filter = encodeURIComponent(JSON.stringify({ score: { $in: [10, 30] } }));
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  it('$nin operator filters correctly', async () => {
    const filter = encodeURIComponent(JSON.stringify({ score: { $nin: [10, 30] } }));
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(1);
  });

  it('$and operator filters correctly', async () => {
    const filter = encodeURIComponent(
      JSON.stringify({ $and: [{ status: 'active' }, { score: { $gt: 15 } }] })
    );
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(1);
  });

  it('$or operator filters correctly', async () => {
    const filter = encodeURIComponent(
      JSON.stringify({ $or: [{ score: 10 }, { score: 30 }] })
    );
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  it('$exists operator filters correctly', async () => {
    await db.collection('items').insertOne({ noScore: true, category: 'C' });
    const filter = encodeURIComponent(JSON.stringify({ score: { $exists: true } }));
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(3);
  });

  it('$regex operator filters correctly', async () => {
    const filter = encodeURIComponent(JSON.stringify({ status: { $regex: '^act' } }));
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  // ── Disallowed operators → 400 ─────────────────────────────────────────────

  const disallowedOps = ['$where', '$expr', '$function', '$accumulator', '$jsonSchema'];

  it.each(disallowedOps)('rejects disallowed operator %s with 400', async (op) => {
    const filter = encodeURIComponent(JSON.stringify({ [op]: 'something' }));
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; operator: string }>();
    expect(body.error).toBe('Operator not allowed');
    expect(body.operator).toBe(op);
  });

  it('rejects nested disallowed operator with 400', async () => {
    const filter = encodeURIComponent(
      JSON.stringify({ status: { $where: 'this.score > 0' } })
    );
    const res = await app.inject({ method: 'GET', url: `/api/items?filter=${filter}` });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('Operator not allowed');
  });

  // ── Invalid JSON → 400 ────────────────────────────────────────────────────

  it('returns 400 with error and detail for invalid filter JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/items?filter=not-json' });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; detail: string }>();
    expect(body.error).toBe('Invalid filter');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
  });
});

// ─── Flat params & merge integration tests ────────────────────────────────────

describe('Flat params and filter merge — integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(['products']);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.collection('products').deleteMany({});
    await db.collection('products').insertMany([
      { status: 'shipped', total: 99.99, category: 'electronics' },
      { status: 'pending', total: 49.99, category: 'clothing' },
      { status: 'shipped', total: 199.99, category: 'electronics' },
    ]);
  });

  it('flat params filter documents', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/products?status=shipped' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ status: string }> }>();
    expect(body.data).toHaveLength(2);
    expect(body.data.every((d) => d.status === 'shipped')).toBe(true);
  });

  it('multiple flat params narrow results', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/products?status=shipped&category=electronics' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[] }>();
    expect(body.data).toHaveLength(2);
  });

  it('explicit filter merges with flat params', async () => {
    // flat: status=shipped, filter: category=electronics
    const filter = encodeURIComponent(JSON.stringify({ category: 'electronics' }));
    const res = await app.inject({ method: 'GET', url: `/api/products?status=shipped&filter=${filter}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[] }>();
    expect(body.data).toHaveLength(2);
  });

  it('explicit filter wins over flat param on same key', async () => {
    // flat says status=pending, filter says status=shipped → filter wins
    const filter = encodeURIComponent(JSON.stringify({ status: 'shipped' }));
    const res = await app.inject({ method: 'GET', url: `/api/products?status=pending&filter=${filter}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ status: string }> }>();
    expect(body.data.every((d) => d.status === 'shipped')).toBe(true);
    expect(body.data).toHaveLength(2);
  });
});

// ─── Pagination integration tests ─────────────────────────────────────────────

describe('Pagination — integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(['paginated'], { defaultPageSize: 5 });
    await db.collection('paginated').deleteMany({});
    await db.collection('paginated').insertMany(
      Array.from({ length: 23 }, (_, i) => ({ idx: i }))
    );
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('returns correct page and pageSize in envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/paginated?page=2&pageSize=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ pagination: { page: number; pageSize: number; total: number; totalPages: number } }>();
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.pageSize).toBe(5);
    expect(body.pagination.total).toBe(23);
    expect(body.pagination.totalPages).toBe(5); // ceil(23/5)
  });

  it('returns correct number of items on last page', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/paginated?page=5&pageSize=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[] }>();
    expect(body.data).toHaveLength(3); // 23 - 4*5 = 3
  });

  it('pageSize > 1000 is capped at 1000', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/paginated?pageSize=9999' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ pagination: { pageSize: number } }>();
    expect(body.pagination.pageSize).toBe(1000);
  });

  it('uses defaultPageSize from config when pageSize not specified', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/paginated' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ pagination: { pageSize: number } }>();
    expect(body.pagination.pageSize).toBe(5); // from config above
  });
});

// ─── Fast count integration tests ─────────────────────────────────────────────

describe('Fast count mode — integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(['fastcountcol'], { useFastCount: true });
    await db.collection('fastcountcol').deleteMany({});
    await db.collection('fastcountcol').insertMany([
      { val: 1 }, { val: 2 }, { val: 3 },
    ]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('returns totalEstimated: true in pagination envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fastcountcol' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ pagination: { totalEstimated?: boolean } }>();
    expect(body.pagination.totalEstimated).toBe(true);
  });

  it('still returns data and other pagination fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fastcountcol' });
    const body = res.json<{ data: unknown[]; pagination: { page: number; pageSize: number; totalPages: number } }>();
    expect(body.data).toHaveLength(3);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.pageSize).toBe(100);
  });
});

// ─── Sort integration tests ───────────────────────────────────────────────────

describe('Sort — integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(['sortcol']);
    await db.collection('sortcol').deleteMany({});
    await db.collection('sortcol').insertMany([
      { val: 30 }, { val: 10 }, { val: 20 },
    ]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('sorts ascending by field name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sortcol?sort=val' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ val: number }> }>();
    expect(body.data.map((d) => d.val)).toEqual([10, 20, 30]);
  });

  it('sorts descending with - prefix', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sortcol?sort=-val' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ val: number }> }>();
    expect(body.data.map((d) => d.val)).toEqual([30, 20, 10]);
  });
});
