import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerExplorerRoutes } from '../../explorer/routes.js';
import type { CollectionInfo } from '../../introspection/index.js';

// Mock inference
vi.mock('../../openapi/inference.js', () => ({
  inferCollectionSchema: async () => ({ fields: {}, sampleCount: 0 }),
  buildSchemaObject: () => ({ type: 'object', properties: {}, required: [] }),
  SAMPLE_LIMIT: 20,
}));

const mockCollections: CollectionInfo[] = [
  { name: 'pokemon', slug: 'pokemon' },
  { name: 'records', slug: 'records' },
];

const mockDb = {
  collection: () => ({
    estimatedDocumentCount: async () => 42,
  }),
} as unknown as import('mongodb').Db;

function makeConfig(overrides: Record<string, unknown> = {}): import('../../config/index.js').AutoRestConfig {
  return overrides as import('../../config/index.js').AutoRestConfig;
}

async function buildApp(
  config: import('../../config/index.js').AutoRestConfig,
  collections: CollectionInfo[] = mockCollections,
  env?: string
): Promise<FastifyInstance> {
  const origEnv = process.env['NODE_ENV'];
  if (env !== undefined) process.env['NODE_ENV'] = env;
  const app = Fastify({ logger: false });
  await registerExplorerRoutes(app, { db: mockDb, config, collections, prefix: '/api' });
  await app.ready();
  if (env !== undefined) process.env['NODE_ENV'] = origEnv;
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registerExplorerRoutes', () => {
  describe('/explorer in dev (default)', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildApp(makeConfig(), mockCollections, 'test');
    });
    afterAll(async () => { await app.close(); });

    it('returns 200 text/html for /explorer', async () => {
      const res = await app.inject({ method: 'GET', url: '/explorer' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('HTML contains expected structure', async () => {
      const res = await app.inject({ method: 'GET', url: '/explorer' });
      expect(res.body).toContain('<!DOCTYPE html>');
      expect(res.body).toContain('id="sidebar"');
    });
  });

  describe('/explorer in production (disabled by default)', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildApp(makeConfig(), mockCollections, 'production');
    });
    afterAll(async () => { await app.close(); });

    it('returns 404 for /explorer in production by default', async () => {
      const res = await app.inject({ method: 'GET', url: '/explorer' });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for /explorer-api/collections in production by default', async () => {
      const res = await app.inject({ method: 'GET', url: '/explorer-api/collections' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('/explorer with config.explorer = true in production (enabled)', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      const origEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';
      app = Fastify({ logger: false });
      await registerExplorerRoutes(app, {
        db: mockDb,
        config: makeConfig({ explorer: true }),
        collections: mockCollections,
        prefix: '/api',
      });
      await app.ready();
      process.env['NODE_ENV'] = origEnv;
    });
    afterAll(async () => { await app.close(); });

    it('serves /explorer in production when explorer: true', async () => {
      const res = await app.inject({ method: 'GET', url: '/explorer' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('/explorer with config.explorer = false (disabled)', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildApp(makeConfig({ explorer: false }), mockCollections, 'test');
    });
    afterAll(async () => { await app.close(); });

    it('returns 404 for /explorer when explorer: false', async () => {
      const res = await app.inject({ method: 'GET', url: '/explorer' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('/explorer-api/collections', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildApp(makeConfig(), mockCollections, 'test');
    });
    afterAll(async () => { await app.close(); });

    it('returns 200 JSON with correct shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/explorer-api/collections' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ collections: unknown[] }>();
      expect(Array.isArray(body.collections)).toBe(true);
    });

    it('includes collection entries with name, slug, count, schema', async () => {
      const res = await app.inject({ method: 'GET', url: '/explorer-api/collections' });
      const body = res.json<{ collections: Array<{ name: string; slug: string; count: number; schema: unknown }> }>();
      expect(body.collections.length).toBe(2);
      const pokemon = body.collections.find(c => c.name === 'pokemon');
      expect(pokemon).toBeDefined();
      expect(pokemon?.slug).toBe('pokemon');
      expect(typeof pokemon?.count).toBe('number');
      expect(pokemon?.schema).toBeDefined();
    });
  });

  describe('/explorer-api/collections with empty collections', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildApp(makeConfig(), [], 'test');
    });
    afterAll(async () => { await app.close(); });

    it('returns empty array when no collections', async () => {
      const res = await app.inject({ method: 'GET', url: '/explorer-api/collections' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ collections: unknown[] }>();
      expect(body.collections).toEqual([]);
    });
  });

  describe('publicly accessible even when auth is configured', () => {
    // Explorer routes bypass auth entirely — same philosophy as Swagger UI.
    // /explorer and /explorer-api/collections serve the UI shell and collection
    // metadata; neither exposes sensitive data. The explorer UI has an API key
    // input field for authenticating the /api/* data fetches client-side.
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildApp(
        makeConfig({
          auth: { type: 'api-key', header: 'x-api-key', keys: ['valid-key'] },
        }),
        mockCollections,
        'test'
      );
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
        headers: { 'x-api-key': 'valid-key' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 200 for /explorer WITH a wrong api key (still public)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/explorer',
        headers: { 'x-api-key': 'wrong-key' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 200 for /explorer-api/collections WITHOUT any api key (public)', async () => {
      const res = await app.inject({ method: 'GET', url: '/explorer-api/collections' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ collections: unknown[] }>();
      expect(Array.isArray(body.collections)).toBe(true);
    });

    it('returns 200 for /explorer-api/collections WITH a wrong api key (still public)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/explorer-api/collections',
        headers: { 'x-api-key': 'wrong-key' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 200 for /explorer-api/collections WITH a valid api key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/explorer-api/collections',
        headers: { 'x-api-key': 'valid-key' },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
