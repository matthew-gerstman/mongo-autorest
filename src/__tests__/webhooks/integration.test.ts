import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
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
  mongoUri = mongod.getUri() + 'webhooktest';
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

// ─── EventEmitter integration ─────────────────────────────────────────────────

describe('EventEmitter — integration via plugin', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(['products']);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.collection('products').deleteMany({});
  });

  // ── document.created ────────────────────────────────────────────────────────

  it('emits document.created after successful POST', async () => {
    const listener = vi.fn();
    app.autoRestEmitter.on('document.created', listener);

    const res = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { name: 'Widget', price: 9.99 },
    });

    app.autoRestEmitter.off('document.created', listener);

    expect(res.statusCode).toBe(201);
    expect(listener).toHaveBeenCalledOnce();
    const payload = listener.mock.calls[0][0] as { collection: string; document: Record<string, unknown> };
    expect(payload.collection).toBe('products');
    expect(payload.document).toMatchObject({ name: 'Widget', price: 9.99 });
  });

  it('does NOT emit document.created on a failed POST (bad content-type causes 415)', async () => {
    const listener = vi.fn();
    app.autoRestEmitter.on('document.created', listener);

    // Send raw text to trigger a parse error / 4xx
    const res = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: { 'content-type': 'text/plain' },
      payload: 'not json',
    });

    app.autoRestEmitter.off('document.created', listener);

    // Fastify returns 415 for unsupported media type
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(listener).not.toHaveBeenCalled();
  });

  // ── document.updated (PUT) ──────────────────────────────────────────────────

  it('emits document.updated after successful PUT', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { name: 'Gadget' },
    });
    const { _id } = createRes.json<{ _id: string }>();

    const listener = vi.fn();
    app.autoRestEmitter.on('document.updated', listener);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/products/${_id}`,
      payload: { name: 'Gadget Pro' },
    });

    app.autoRestEmitter.off('document.updated', listener);

    expect(res.statusCode).toBe(200);
    expect(listener).toHaveBeenCalledOnce();
    const payload = listener.mock.calls[0][0] as {
      collection: string;
      id: string;
      changes: Record<string, unknown>;
    };
    expect(payload.collection).toBe('products');
    expect(payload.id).toBe(_id);
    expect(payload.changes).toMatchObject({ name: 'Gadget Pro' });
  });

  it('does NOT emit document.updated when PUT returns 404', async () => {
    const listener = vi.fn();
    app.autoRestEmitter.on('document.updated', listener);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/products/000000000000000000000001',
      payload: { name: 'Ghost' },
    });

    app.autoRestEmitter.off('document.updated', listener);

    expect(res.statusCode).toBe(404);
    expect(listener).not.toHaveBeenCalled();
  });

  // ── document.updated (PATCH) ────────────────────────────────────────────────

  it('emits document.updated after successful PATCH', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { name: 'Thing', qty: 1 },
    });
    const { _id } = createRes.json<{ _id: string }>();

    const listener = vi.fn();
    app.autoRestEmitter.on('document.updated', listener);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/products/${_id}`,
      payload: { qty: 5 },
    });

    app.autoRestEmitter.off('document.updated', listener);

    expect(res.statusCode).toBe(200);
    expect(listener).toHaveBeenCalledOnce();
    const payload = listener.mock.calls[0][0] as {
      collection: string;
      id: string;
      changes: Record<string, unknown>;
    };
    expect(payload.collection).toBe('products');
    expect(payload.id).toBe(_id);
    expect(payload.changes).toMatchObject({ qty: 5 });
  });

  it('does NOT emit document.updated when PATCH returns 404', async () => {
    const listener = vi.fn();
    app.autoRestEmitter.on('document.updated', listener);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/products/000000000000000000000001',
      payload: { qty: 5 },
    });

    app.autoRestEmitter.off('document.updated', listener);

    expect(res.statusCode).toBe(404);
    expect(listener).not.toHaveBeenCalled();
  });

  // ── document.deleted ────────────────────────────────────────────────────────

  it('emits document.deleted after successful DELETE', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { name: 'ToDelete' },
    });
    const { _id } = createRes.json<{ _id: string }>();

    const listener = vi.fn();
    app.autoRestEmitter.on('document.deleted', listener);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/products/${_id}`,
    });

    app.autoRestEmitter.off('document.deleted', listener);

    expect(res.statusCode).toBe(204);
    expect(listener).toHaveBeenCalledOnce();
    const payload = listener.mock.calls[0][0] as { collection: string; id: string };
    expect(payload.collection).toBe('products');
    expect(payload.id).toBe(_id);
  });

  it('does NOT emit document.deleted when DELETE returns 404', async () => {
    const listener = vi.fn();
    app.autoRestEmitter.on('document.deleted', listener);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/products/000000000000000000000001',
    });

    app.autoRestEmitter.off('document.deleted', listener);

    expect(res.statusCode).toBe(404);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── Webhook config wiring ────────────────────────────────────────────────────

describe('Outbound webhook delivery — wired via config', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 } as Response));

    app = await buildApp(['items'], {
      webhooks: [
        {
          url: 'https://receiver.example.com/hook',
          events: ['document.created', 'document.updated', 'document.deleted'],
          secret: 'test-secret',
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    await db.collection('items').deleteMany({});
    vi.mocked(fetch).mockClear();
  });

  it('calls the webhook URL after POST', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/items',
      payload: { label: 'hello' },
    });
    expect(res.statusCode).toBe(201);

    // give async delivery a tick
    await new Promise((r) => setTimeout(r, 50));

    expect(fetch).toHaveBeenCalledOnce();
    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://receiver.example.com/hook');
  });

  it('includes x-autorest-signature header in webhook delivery', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/items',
      payload: { label: 'signed' },
    });
    expect(res.statusCode).toBe(201);

    await new Promise((r) => setTimeout(r, 50));

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const sig = (init.headers as Record<string, string>)['x-autorest-signature'];
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

// ─── Per-collection webhook filtering ────────────────────────────────────────

describe('Per-collection webhook filtering — wired via config', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 } as Response));

    app = await buildApp(['cats', 'dogs'], {
      webhooks: [
        {
          url: 'https://cats-only.example.com/hook',
          events: ['document.created'],
          collections: ['cats'],
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    await db.collection('cats').deleteMany({});
    await db.collection('dogs').deleteMany({});
    vi.mocked(fetch).mockClear();
  });

  it('fires webhook for cats (matched collection)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cats',
      payload: { name: 'Whiskers' },
    });
    expect(res.statusCode).toBe(201);

    await new Promise((r) => setTimeout(r, 50));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does NOT fire webhook for dogs (filtered out)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/dogs',
      payload: { name: 'Rex' },
    });
    expect(res.statusCode).toBe(201);

    await new Promise((r) => setTimeout(r, 50));
    expect(fetch).not.toHaveBeenCalled();
  });
});
