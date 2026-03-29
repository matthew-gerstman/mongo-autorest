import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import SwaggerParser from '@apidevtools/swagger-parser';
import { generateOpenApiSpec } from '../../openapi/spec-generator.js';
import type { AutoRestConfig } from '../../config/index.js';
import type { CollectionInfo } from '../../introspection/index.js';

// ─── Test harness ─────────────────────────────────────────────────────────────

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri() + 'testspec');
  await client.connect();
  db = client.db();
}, 60_000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function genSpec(
  collectionDefs: Array<{ name: string; slug: string; docs?: Record<string, unknown>[] }>,
  config: AutoRestConfig = {}
) {
  for (const { name, docs = [] } of collectionDefs) {
    if (docs.length > 0) {
      await db.collection(name).insertMany(docs.map((d) => ({ ...d })));
    } else {
      // Ensure collection exists even if empty
      await db.createCollection(name).catch(() => {/* already exists */});
    }
  }

  const collections: CollectionInfo[] = collectionDefs.map(({ name, slug }) => ({
    name,
    slug,
  }));

  return generateOpenApiSpec({ db, config, collections, prefix: '/api' });
}

// ─── Core shape ───────────────────────────────────────────────────────────────

describe('generateOpenApiSpec', () => {
  it('returns openapi: "3.1.0" and x-schema-inference: "sampled"', async () => {
    const spec = await genSpec([]);
    expect(spec.openapi).toBe('3.1.0');
    expect(spec['x-schema-inference']).toBe('sampled');
  });

  it('passes @apidevtools/swagger-parser validation for an empty collection set', async () => {
    const spec = await genSpec([]);
    // SwaggerParser.validate mutates the object — clone first
    await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(spec)) as never)).resolves.toBeDefined();
  });

  it('passes swagger-parser for a spec with real collections', async () => {
    const spec = await genSpec([
      {
        name: 'sg_users',
        slug: 'users',
        docs: [
          { name: 'Alice', email: 'alice@example.com', age: 30 },
          { name: 'Bob', email: 'bob@example.com', age: 25 },
        ],
      },
    ]);
    await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(spec)) as never)).resolves.toBeDefined();
  });

  it('generates paths for each collection: list + document routes', async () => {
    const spec = await genSpec([
      { name: 'sg_orders', slug: 'orders' },
    ]);

    expect(spec.paths['/api/orders']).toBeDefined();
    expect(spec.paths['/api/orders/{id}']).toBeDefined();
    expect(spec.paths['/api/orders'].get).toBeDefined();
    expect(spec.paths['/api/orders'].post).toBeDefined();
    expect(spec.paths['/api/orders/{id}'].get).toBeDefined();
    expect(spec.paths['/api/orders/{id}'].put).toBeDefined();
    expect(spec.paths['/api/orders/{id}'].patch).toBeDefined();
    expect(spec.paths['/api/orders/{id}'].delete).toBeDefined();
  });

  it('adds pagination query params on list endpoints', async () => {
    const spec = await genSpec([{ name: 'sg_items', slug: 'items' }]);
    const params = spec.paths['/api/items'].get?.parameters ?? [];
    const paramNames = params.map((p) => p.name);
    expect(paramNames).toContain('page');
    expect(paramNames).toContain('pageSize');
    expect(paramNames).toContain('sort');
    expect(paramNames).toContain('filter');
  });

  it('infers a component schema for each collection', async () => {
    const spec = await genSpec([
      {
        name: 'sg_products',
        slug: 'products',
        docs: [{ title: 'Widget', price: 9.99 }],
      },
    ]);

    expect(spec.components.schemas['Products']).toBeDefined();
    const schema = spec.components.schemas['Products'] as Record<string, unknown>;
    expect(schema['x-schema-inference']).toBe('sampled');
  });

  it('handles an empty collection gracefully (no crash)', async () => {
    const spec = await genSpec([{ name: 'sg_empty2', slug: 'empty2' }]);
    expect(spec.paths['/api/empty2']).toBeDefined();
    await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(spec)) as never)).resolves.toBeDefined();
  });

  it('omits write routes when readOnly is true', async () => {
    const spec = await genSpec(
      [{ name: 'sg_readonly_col', slug: 'readonly-col' }],
      { readOnly: true }
    );
    const collPath = spec.paths['/api/readonly-col'];
    const docPath = spec.paths['/api/readonly-col/{id}'];

    expect(collPath.get).toBeDefined();
    expect(collPath.post).toBeUndefined();
    expect(docPath.get).toBeDefined();
    expect(docPath.put).toBeUndefined();
    expect(docPath.patch).toBeUndefined();
    expect(docPath.delete).toBeUndefined();
  });

  it('applies per-collection readOnly override', async () => {
    const spec = await genSpec(
      [{ name: 'sg_ro_override', slug: 'ro-override' }],
      {
        collections: {
          sg_ro_override: { readOnly: true },
        },
      }
    );

    expect(spec.paths['/api/ro-override'].post).toBeUndefined();
    expect(spec.paths['/api/ro-override'].get).toBeDefined();
  });

  it('adds apiKey security scheme when auth is configured', async () => {
    const spec = await genSpec(
      [{ name: 'sg_secured', slug: 'secured' }],
      {
        auth: { type: 'api-key', header: 'x-api-key', keys: ['secret'] },
      }
    );

    expect(spec.components.securitySchemes?.['ApiKeyAuth']).toBeDefined();
    const scheme = spec.components.securitySchemes!['ApiKeyAuth'];
    expect(scheme.type).toBe('apiKey');
    expect(scheme.in).toBe('header');
    expect(scheme.name).toBe('x-api-key');
    // Global security applied
    expect(spec.security).toEqual([{ ApiKeyAuth: [] }]);
    // List endpoint has security requirement
    const listSec = spec.paths['/api/secured'].get?.security;
    expect(listSec).toBeDefined();
  });

  it('passes swagger-parser when auth scheme is configured', async () => {
    const spec = await genSpec(
      [{ name: 'sg_auth_parse', slug: 'auth-parse', docs: [{ val: 1 }] }],
      {
        auth: { type: 'api-key', header: 'x-my-key', keys: ['k1'] },
      }
    );
    await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(spec)) as never)).resolves.toBeDefined();
  });

  it('uses custom info when provided', async () => {
    const spec = await generateOpenApiSpec({
      db,
      config: {},
      collections: [],
      info: { title: 'My API', version: '2.0.0', description: 'Test desc' },
    });
    expect(spec.info.title).toBe('My API');
    expect(spec.info.version).toBe('2.0.0');
    expect(spec.info.description).toBe('Test desc');
  });

  it('includes servers when provided', async () => {
    const spec = await generateOpenApiSpec({
      db,
      config: {},
      collections: [],
      servers: [{ url: 'https://api.example.com', description: 'Production' }],
    });
    expect(spec.servers).toBeDefined();
    expect(spec.servers![0].url).toBe('https://api.example.com');
  });

  it('handles multi-word slug to PascalCase schema name', async () => {
    const spec = await genSpec([{ name: 'my_orders', slug: 'my-orders' }]);
    expect(spec.components.schemas['MyOrders']).toBeDefined();
  });

  it('auth:false on collection disables security for that collection', async () => {
    const spec = await genSpec(
      [{ name: 'sg_noauth', slug: 'noauth' }],
      {
        auth: { type: 'api-key', keys: ['k'] },
        collections: {
          sg_noauth: { auth: false },
        },
      }
    );
    // Collection with auth:false should have no security field on its operations
    const listOp = spec.paths['/api/noauth'].get;
    expect(listOp?.security).toBeUndefined();
  });

  it('required fields are detected: >50% sample presence', async () => {
    const col = db.collection('sg_required_test');
    // Insert 4 docs: name present in 3 (>50%), optional present in 1 (<50%)
    await col.insertMany([
      { name: 'A', optional: 'x' },
      { name: 'B' },
      { name: 'C' },
      { name: 'D' },
    ]);

    const spec = await generateOpenApiSpec({
      db,
      config: {},
      collections: [{ name: 'sg_required_test', slug: 'required-test' }],
    });

    const schema = spec.components.schemas['RequiredTest'] as {
      required?: string[];
    };
    expect(schema.required).toContain('name');
    expect(schema.required ?? []).not.toContain('optional');
  });
});
