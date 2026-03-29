/**
 * Targeted tests to cover the remaining branch/line gaps identified in
 * the coverage report. These complement the existing test files.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply, type FastifyError } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { createAuthHook } from '../middleware/auth.js';
import { errorHandler } from '../middleware/errors.js';
import { startIntrospectionInterval } from '../introspection/index.js';
import { parseFilter } from '../routes/filtering.js';
import { buildSchemaObject } from '../openapi/inference.js';
import { registerOpenApiRoutes } from '../openapi/swagger.js';
import { generateOpenApiSpec } from '../openapi/spec-generator.js';
import { introspectDatabase } from '../introspection/index.js';
import { autoRest } from '../plugin.js';

// ─── 1. Auth — wrong key → 403 (buffer comparison) ──────────────────────────
// Covers middleware/auth.ts:39-40 — the timingSafeEqual rejection

describe('Auth hook — wrong key rejected', () => {
  it('returns 403 when provided key does not match', async () => {
    const hook = createAuthHook({ type: 'api-key', header: 'x-api-key', keys: ['correct-key'] });

    let sentCode = 0;
    let sentBody: unknown = null;
    const mockReply = {
      code(c: number) { sentCode = c; return this; },
      send(b: unknown) { sentBody = b; return this; },
    };
    const mockReq = { headers: { 'x-api-key': 'wrong-key' } } as FastifyRequest;
    await hook(mockReq, mockReply as unknown as FastifyReply);
    expect(sentCode).toBe(403);
    expect((sentBody as { error: string }).error).toBe('Forbidden');
  });

  it('returns 403 when key is a different (shorter) value', async () => {
    // Forces the length-mismatch guard path — SHA-256 always 64 hex chars so
    // the lengths are always equal; the timingSafeEqual itself rejects → 403.
    const hook = createAuthHook({ type: 'api-key', header: 'x-api-key', keys: ['abc'] });

    let sentCode = 0;
    const mockReply = {
      code(c: number) { sentCode = c; return this; },
      send() { return this; },
    };
    const mockReq = { headers: { 'x-api-key': 'xyz' } } as FastifyRequest;
    await hook(mockReq, mockReply as unknown as FastifyReply);
    expect(sentCode).toBe(403);
  });
});

// ─── 2. Error handler — 400 with empty message ───────────────────────────────
// Covers middleware/errors.ts:31 (message ?? 'Bad request' fallback)

describe('Error handler — 400 with empty/falsy message', () => {
  it('falls back to "Bad request" when error.message is empty string', () => {
    let sentCode = 0;
    let sentBody: unknown = null;
    const mockReply = {
      code(c: number) { sentCode = c; return this; },
      send(b: unknown) { sentBody = b; return this; },
    };
    const mockReq = { log: { error: vi.fn() } };

    const err = Object.assign(new Error(''), {
      statusCode: 400,
      validation: undefined,
      validationContext: undefined,
      name: 'FastifyError',
      code: 'FST_ERR_TEST',
    }) as FastifyError;
    // Force message to be falsy-ish (empty string; ?? only triggers on null/undefined)
    Object.defineProperty(err, 'message', { value: undefined, writable: true });

    errorHandler(err, mockReq as unknown as FastifyRequest, mockReply as unknown as FastifyReply);
    expect(sentCode).toBe(400);
    expect((sentBody as { error: string }).error).toBe('Bad request');
  });
});

// ─── 3. Introspection interval — error in re-introspection ───────────────────
// Covers introspection/index.ts:95-96

describe('startIntrospectionInterval — error path', () => {
  it('logs error and continues when introspectDatabase throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Fake db that always throws on listCollections
    const badDb = {
      listCollections: () => ({
        toArray: async () => { throw new Error('DB exploded'); },
      }),
    };

    const initial = { collections: [], introspectedAt: new Date() };
    const onChange = vi.fn();

    const stop = startIntrospectionInterval(
      badDb as unknown as Db,
      { introspectionInterval: 50 },
      initial,
      onChange
    );

    await new Promise<void>((r) => setTimeout(r, 150));
    stop();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[mongo-autorest] Re-introspection error:'),
      expect.any(Error)
    );
    expect(onChange).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// ─── 4. Filtering — non-Error JSON.parse exception ───────────────────────────
// Covers routes/filtering.ts:82 (String fallback when e is not an Error)

describe('parseFilter — non-Error parse exception', () => {
  it('falls back to "JSON parse error" when thrown value is not an Error instance', () => {
    const originalParse = JSON.parse;
    // Override JSON.parse to throw a plain string (not an Error)
    JSON.parse = () => { throw 'boom'; };

    let sentBody: unknown = null;
    const mockReply = {
      code() { return this; },
      send(b: unknown) { sentBody = b; return this; },
    };

    const result = parseFilter(
      'trigger-parse',
      mockReply as unknown as FastifyReply
    );

    JSON.parse = originalParse;

    expect(result).toBeUndefined();
    expect((sentBody as { detail: string }).detail).toBe('JSON parse error');
  });
});

// ─── 5. OpenAPI schema inference — threshold boundary ────────────────────────
// Covers openapi/inference.ts:173 (seenCount exactly at 50% boundary)

describe('buildSchemaObject — 50% threshold boundary', () => {
  it('excludes field from required when seenCount equals exactly half of sampleCount', () => {
    // 4 samples, seenCount=2 → 2 > 2 is false → NOT required
    const inferred = {
      sampleCount: 4,
      fields: {
        sometimes: {
          types: new Set(['string' as const]),
          presentInAll: false,
          seenCount: 2, // exactly 50% — NOT > threshold → not required
        },
        usually: {
          types: new Set(['number' as const]),
          presentInAll: false,
          seenCount: 3, // 75% → required
        },
      },
    };
    const schema = buildSchemaObject(inferred);
    const required = (schema as { required?: string[] }).required ?? [];
    expect(required).not.toContain('sometimes');
    expect(required).toContain('usually');
  });
});

// ─── 6. OpenAPI spec — collection-level auth scheme (not global) ──────────────
// Covers openapi/spec-generator.ts:418

describe('generateOpenApiSpec — collection-level auth without global auth', () => {
  let mongod: MongoMemoryServer;
  let mongoUri: string;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoUri = mongod.getUri() + 'specauthdb';
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db();
    await db.collection('gadgets').insertOne({ name: 'gizmo' });
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  it('registers collection-level ApiKeyAuth when no global auth is set', async () => {
    const config = {
      collections: {
        gadgets: {
          auth: { type: 'api-key' as const, keys: ['colkey'], header: 'x-col-key' },
        },
      },
    };
    const { collections } = await introspectDatabase(db, config);
    const spec = await generateOpenApiSpec({ db, config, collections });
    expect(spec.components.securitySchemes?.['ApiKeyAuth']).toBeDefined();
    expect(spec.components.securitySchemes?.['ApiKeyAuth']?.name).toBe('x-col-key');
    // Global security should NOT be set (only per-collection)
    expect(spec.security).toBeUndefined();
  });
});

// ─── 7. OpenAPI /openapi.json — specPromise resets on error ──────────────────
// Covers openapi/swagger.ts:50-51

describe('registerOpenApiRoutes — /openapi.json error resets specPromise', () => {
  let mongod: MongoMemoryServer;
  let mongoUri: string;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoUri = mongod.getUri() + 'swaggererrordb';
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db();
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  it('returns 500 when spec generation throws and resets promise for next request', async () => {
    const app = Fastify({ logger: false });

    // Override generateOpenApiSpec to always throw
    vi.spyOn(
      await import('../openapi/spec-generator.js'),
      'generateOpenApiSpec'
    ).mockRejectedValueOnce(new Error('spec gen failed'));

    await registerOpenApiRoutes(app, {
      db,
      config: {},
      collections: [],
      prefix: '/api',
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    // Should propagate as 500 internal server error
    expect(res.statusCode).toBe(500);

    await app.close();
    vi.restoreAllMocks();
  });
});

// ─── 8. Plugin — MongoDB connect throws non-Error ────────────────────────────
// Covers plugin.ts:84-87 (String(err) branch)

describe('Plugin — connect throws non-Error value', () => {
  it('wraps non-Error in message string', async () => {
    const { MongoClient: MC } = await import('mongodb');
    const original = MC.prototype.connect;
    MC.prototype.connect = async function () {
      throw 'plain string thrown'; // not an Error instance
    };

    const app = Fastify({ logger: false });
    try {
      await app.register(autoRest, { mongoUri: 'mongodb://localhost:27017/test' });
      await app.ready();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err instanceof Error).toBe(true);
      expect((err as Error).message).toContain('plain string thrown');
    } finally {
      MC.prototype.connect = original;
      await app.close().catch(() => undefined);
    }
  });
});

// ─── 9. CRUD — routes without emitter, all write paths ───────────────────────
// Covers routes/crud.ts:91,107,127 (write ops with no emitter passed)

describe('CRUD — write routes work when plugin has no explicit emitter config', () => {
  let mongod: MongoMemoryServer;
  let mongoUri: string;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoUri = mongod.getUri() + 'noemitterdb';
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db();
    // Seed to create collection for introspection
    await db.collection('widgets').insertOne({ _seed: true });
    await db.collection('widgets').deleteMany({});

    app = Fastify({ logger: false });
    await app.register(autoRest, { mongoUri, prefix: '/api' });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await client.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await db.collection('widgets').deleteMany({});
  });

  it('POST /api/widgets — creates without emitter', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/widgets',
      payload: { color: 'blue' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ color: string }>().color).toBe('blue');
  });

  it('PUT /api/widgets/:id — replaces without emitter', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/widgets',
      payload: { color: 'red' },
    });
    const id = post.json<{ _id: string }>()._id;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/widgets/${id}`,
      payload: { color: 'green' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ color: string }>().color).toBe('green');
  });

  it('PATCH /api/widgets/:id — patches without emitter', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/widgets',
      payload: { color: 'red', size: 'M' },
    });
    const id = post.json<{ _id: string }>()._id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/widgets/${id}`,
      payload: { size: 'L' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ size: string }>().size).toBe('L');
  });
});
