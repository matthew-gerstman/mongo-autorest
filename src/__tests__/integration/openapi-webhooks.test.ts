/**
 * Integration: OpenAPI spec generation & webhook delivery end-to-end.
 *
 * OpenAPI: generate spec from seeded data → validate with swagger-parser
 *          → verify schema shapes match actual document structure.
 *
 * Webhooks: register webhook → POST doc → verify event fired with correct
 *           payload and HMAC signature. We stub global.fetch so we can
 *           capture what would be sent without a real HTTP server.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import SwaggerParser from '@apidevtools/swagger-parser';
import { autoRest } from '../../plugin.js';
import { generateOpenApiSpec } from '../../openapi/spec-generator.js';
import { introspectDatabase } from '../../introspection/index.js';
import { buildSignature } from '../../webhooks/delivery.js';
import { seedDatabase, cleanDatabase } from '../helpers/seed.js';

// ─── Shared infrastructure ────────────────────────────────────────────────────

let mongod: MongoMemoryServer;
let mongoUri: string;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  mongoUri = mongod.getUri() + 'openapidb';
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db();

  await db.createCollection('orders');
  await db.createCollection('products');
  await db.createCollection('members');
}, 60_000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

// ─── OpenAPI spec generation ──────────────────────────────────────────────────

describe('OpenAPI spec generation from seeded data', () => {
  beforeAll(async () => {
    await cleanDatabase(db);
    await seedDatabase(db);
  }, 60_000);

  it('generates a spec that passes swagger-parser validation', async () => {
    const config = {};
    const { collections } = await introspectDatabase(db, config);
    const spec = await generateOpenApiSpec({
      db,
      config,
      collections,
      prefix: '/api',
      info: { title: 'Test API', version: '1.0.0' },
    });

    await expect(
      SwaggerParser.validate(spec as Parameters<typeof SwaggerParser.validate>[0])
    ).resolves.toBeDefined();
  });

  it('spec includes paths for all seeded collections', async () => {
    const config = {};
    const { collections } = await introspectDatabase(db, config);
    const spec = await generateOpenApiSpec({ db, config, collections });

    const paths = Object.keys(spec.paths);
    expect(paths.some((p) => p.includes('orders'))).toBe(true);
    expect(paths.some((p) => p.includes('products'))).toBe(true);
    expect(paths.some((p) => p.includes('members'))).toBe(true);
  });

  it('spec schemas include fields inferred from seeded documents', async () => {
    const config = {};
    const { collections } = await introspectDatabase(db, config);
    const spec = await generateOpenApiSpec({ db, config, collections });

    const ordersSchema = spec.components.schemas['Orders'] as Record<string, unknown>;
    expect(ordersSchema).toBeDefined();
    const props = ordersSchema['properties'] as Record<string, unknown> | undefined;
    expect(props).toBeDefined();
    expect(props!['orderNumber']).toBeDefined();
    expect(props!['status']).toBeDefined();
    expect(props!['total']).toBeDefined();
  });

  it('spec has x-schema-inference: sampled at top level', async () => {
    const config = {};
    const { collections } = await introspectDatabase(db, config);
    const spec = await generateOpenApiSpec({ db, config, collections });
    expect(spec['x-schema-inference']).toBe('sampled');
  });

  it('spec includes auth security scheme when auth is configured', async () => {
    const config = {
      auth: { type: 'api-key' as const, keys: ['key1'], header: 'x-api-key' },
    };
    const { collections } = await introspectDatabase(db, config);
    const spec = await generateOpenApiSpec({ db, config, collections });

    expect(spec.components.securitySchemes?.['ApiKeyAuth']).toBeDefined();
    expect(spec.components.securitySchemes?.['ApiKeyAuth']?.type).toBe('apiKey');
    expect(spec.security).toEqual([{ ApiKeyAuth: [] }]);
  });

  it('/openapi.json endpoint returns 200 with valid spec', async () => {
    const app = Fastify({ logger: false });
    await app.register(autoRest, { mongoUri, prefix: '/api' });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const spec = res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec['x-schema-inference']).toBe('sampled');

    await app.close();
  });

  it('spec excludes excluded collections', async () => {
    const config = {
      collections: { orders: { exclude: true } },
    };
    const { collections } = await introspectDatabase(db, config);
    const spec = await generateOpenApiSpec({ db, config, collections });

    const paths = Object.keys(spec.paths);
    expect(paths.every((p) => !p.includes('orders'))).toBe(true);
  });

  it('read-only collections omit POST/PUT/PATCH/DELETE from spec', async () => {
    const config = {
      collections: { products: { readOnly: true } },
    };
    const { collections } = await introspectDatabase(db, config);
    const spec = await generateOpenApiSpec({ db, config, collections });

    const productCollPath = spec.paths['/api/products'];
    expect(productCollPath?.get).toBeDefined();
    expect(productCollPath?.post).toBeUndefined();

    const productDocPath = spec.paths['/api/products/{id}'];
    expect(productDocPath?.get).toBeDefined();
    expect(productDocPath?.put).toBeUndefined();
    expect(productDocPath?.patch).toBeUndefined();
    expect(productDocPath?.delete).toBeUndefined();
  });
});

// ─── Webhook delivery ─────────────────────────────────────────────────────────

describe('Webhook delivery end-to-end', () => {
  let webhookApp: FastifyInstance;

  const WEBHOOK_SECRET = 'integration-test-secret';
  const WEBHOOK_URL = 'https://example.com/hooks/test';

  // We stub global.fetch to capture outbound webhook calls without a real server.
  // The delivery module calls fetch() directly — stubbing global is reliable.
  type FetchCall = { url: string; body: string; signature: string };
  let fetchCalls: FetchCall[] = [];

  function stubFetch(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        fetchCalls.push({
          url: _url,
          body: typeof init?.body === 'string' ? init.body : '',
          signature:
            (init?.headers as Record<string, string> | undefined)?.[
              'x-autorest-signature'
            ] ?? '',
        });
        return Promise.resolve(new Response(null, { status: 200 }));
      })
    );
  }

  beforeAll(async () => {
    await cleanDatabase(db);

    webhookApp = Fastify({ logger: false });
    await webhookApp.register(autoRest, {
      mongoUri,
      prefix: '/api',
      config: {
        webhooks: [
          {
            url: WEBHOOK_URL,
            events: ['document.created', 'document.updated', 'document.deleted'],
            secret: WEBHOOK_SECRET,
            collections: ['orders'],
          },
        ],
      },
    });
    await webhookApp.ready();
  }, 60_000);

  afterAll(async () => {
    await webhookApp.close();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    await db.collection('orders').deleteMany({});
    fetchCalls = [];
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('document.created event fires after POST with correct payload + HMAC', async () => {
    const res = await webhookApp.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { orderNumber: 'ORD-HOOK', status: 'pending', total: 55.5 },
    });
    expect(res.statusCode).toBe(201);

    // Allow async webhook delivery to complete
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
    const call = fetchCalls[0]!;
    expect(call.url).toBe(WEBHOOK_URL);

    const payload = JSON.parse(call.body) as { event: string; collection: string };
    expect(payload.event).toBe('document.created');
    expect(payload.collection).toBe('orders');

    // Verify HMAC
    const expectedSig = buildSignature(call.body, WEBHOOK_SECRET);
    expect(call.signature).toBe(expectedSig);
    expect(call.signature).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('document.deleted event fires after DELETE', async () => {
    const post = await webhookApp.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { orderNumber: 'ORD-DEL', status: 'pending', total: 10 },
    });
    const id = post.json<{ _id: string }>()._id;

    fetchCalls = []; // reset after create

    await webhookApp.inject({ method: 'DELETE', url: `/api/orders/${id}` });
    await new Promise<void>((r) => setTimeout(r, 100));

    const events = fetchCalls.map((c) => (JSON.parse(c.body) as { event: string }).event);
    expect(events).toContain('document.deleted');
  });

  it('document.updated event fires after PATCH', async () => {
    const post = await webhookApp.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { orderNumber: 'ORD-PATCH-HOOK', status: 'pending', total: 22 },
    });
    const id = post.json<{ _id: string }>()._id;

    fetchCalls = [];

    await webhookApp.inject({
      method: 'PATCH',
      url: `/api/orders/${id}`,
      payload: { status: 'shipped' },
    });
    await new Promise<void>((r) => setTimeout(r, 100));

    const events = fetchCalls.map((c) => (JSON.parse(c.body) as { event: string }).event);
    expect(events).toContain('document.updated');
  });

  it('webhook collection filter — products events do NOT trigger orders-only webhook', async () => {
    await webhookApp.inject({
      method: 'POST',
      url: '/api/products',
      payload: { sku: 'NO-HOOK', name: 'test', price: 9.99 },
    });
    await new Promise<void>((r) => setTimeout(r, 100));

    // No fetch calls should have been made for a products mutation
    expect(fetchCalls).toHaveLength(0);
  });

  it('EventEmitter API on fastify.autoRestEmitter fires on mutation', async () => {
    const received: string[] = [];
    webhookApp.autoRestEmitter.on('document.created', ({ collection }) => {
      received.push(collection);
    });

    await webhookApp.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { orderNumber: 'ORD-EMITTER', status: 'pending', total: 1 },
    });
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(received).toContain('orders');

    webhookApp.autoRestEmitter.removeAllListeners('document.created');
  });


});
