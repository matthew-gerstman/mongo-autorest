import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { autoRest } from '../../plugin.js';
import type { AutoRestConfig } from '../../config/index.js';
import type { CollectionInfo } from '../../introspection/index.js';
import { registerOpenApiRoutes } from '../../openapi/swagger.js';

// ─── Shared MongoDB setup ─────────────────────────────────────────────────────

let mongod: MongoMemoryServer;
let mongoUri: string;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  mongoUri = mongod.getUri() + 'testswagger';
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db();
}, 60_000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

// ─── Helper: build a minimal Fastify app with the full autoRest plugin ─────────

async function buildPluginApp(
  config: AutoRestConfig = {},
  extraCollections: string[] = []
): Promise<FastifyInstance> {
  // Ensure collections exist
  for (const name of extraCollections) {
    const col = db.collection(name);
    const { insertedId } = await col.insertOne({ _seed: true });
    await col.deleteOne({ _id: insertedId });
  }

  const app = Fastify({ logger: false });
  await app.register(autoRest, {
    mongoUri,
    prefix: '/api',
    config,
  });
  await app.ready();
  return app;
}

// ─── Helper: build a standalone app with registerOpenApiRoutes only ───────────

async function buildOpenApiApp(
  collections: CollectionInfo[],
  config: AutoRestConfig = {},
  env?: string
): Promise<FastifyInstance> {
  const savedEnv = process.env['NODE_ENV'];
  if (env !== undefined) {
    process.env['NODE_ENV'] = env;
  }

  const app = Fastify({ logger: false });

  await registerOpenApiRoutes(app, {
    db,
    config,
    collections,
    prefix: '/api',
  });

  await app.ready();

  if (env !== undefined) {
    process.env['NODE_ENV'] = savedEnv;
  }

  return app;
}

// ─── /openapi.json endpoint ───────────────────────────────────────────────────

describe('/openapi.json endpoint', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildOpenApiApp([
      { name: 'sw_col', slug: 'sw-col' },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with application/json content type', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('returns a valid OpenAPI 3.1 spec', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    const body = res.json<{ openapi: string; 'x-schema-inference': string }>();
    expect(body.openapi).toBe('3.1.0');
    expect(body['x-schema-inference']).toBe('sampled');
  });

  it('returns the same cached spec on repeated requests', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/openapi.json' });
    const res2 = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res1.body).toBe(res2.body);
  });

  it('includes paths for registered collections', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    const body = res.json<{ paths: Record<string, unknown> }>();
    expect(body.paths['/api/sw-col']).toBeDefined();
    expect(body.paths['/api/sw-col/{id}']).toBeDefined();
  });
});

// ─── serveOpenApi: false ──────────────────────────────────────────────────────

describe('serveOpenApi: false', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildOpenApiApp([], { serveOpenApi: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 for /openapi.json when disabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Swagger UI — dev vs prod behaviour ──────────────────────────────────────

describe('Swagger UI', () => {
  it('serves /docs in non-production by default', async () => {
    const savedEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';

    const app = Fastify({ logger: false });
    await registerOpenApiRoutes(app, {
      db,
      config: {},
      collections: [],
      prefix: '/api',
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/docs' });
    // @fastify/swagger-ui serves a redirect or HTML — either way, NOT 404
    expect(res.statusCode).not.toBe(404);

    await app.close();
    process.env['NODE_ENV'] = savedEnv;
  });

  it('does NOT serve /docs in production by default', async () => {
    const savedEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';

    const app = Fastify({ logger: false });
    await registerOpenApiRoutes(app, {
      db,
      config: {},
      collections: [],
      prefix: '/api',
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(404);

    await app.close();
    process.env['NODE_ENV'] = savedEnv;
  });

  it('serves /docs in production when swaggerUi: true', async () => {
    const savedEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';

    const app = Fastify({ logger: false });
    await registerOpenApiRoutes(app, {
      db,
      config: { swaggerUi: true },
      collections: [],
      prefix: '/api',
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).not.toBe(404);

    await app.close();
    process.env['NODE_ENV'] = savedEnv;
  });

  it('does NOT serve /docs when swaggerUi: false even in dev', async () => {
    const savedEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';

    const app = Fastify({ logger: false });
    await registerOpenApiRoutes(app, {
      db,
      config: { swaggerUi: false },
      collections: [],
      prefix: '/api',
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(404);

    await app.close();
    process.env['NODE_ENV'] = savedEnv;
  });
});

// ─── Integration via autoRest plugin ─────────────────────────────────────────

describe('autoRest plugin — /openapi.json integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildPluginApp({}, ['sw_plugin_col']);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('mounts /openapi.json via the autoRest plugin', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ openapi: string }>();
    expect(body.openapi).toBe('3.1.0');
  });

  it('/openapi.json reflects the same collection that CRUD routes target', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    const body = res.json<{ paths: Record<string, unknown> }>();
    // The plugin should have registered sw-plugin-col (normalized slug)
    const pathKeys = Object.keys(body.paths);
    expect(pathKeys.some((k) => k.includes('sw-plugin-col'))).toBe(true);
  });
});
