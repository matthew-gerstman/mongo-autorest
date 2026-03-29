import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  inferType,
  mergeDocument,
  inferCollectionSchema,
  buildPropertySchema,
  buildSchemaObject,
  SAMPLE_LIMIT,
  type InferredField,
} from '../../openapi/inference.js';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';

// ─── inferType ────────────────────────────────────────────────────────────────

describe('inferType', () => {
  it('returns null for null values', () => {
    expect(inferType(null)).toBe('null');
  });

  it('returns array for arrays', () => {
    expect(inferType([])).toBe('array');
    expect(inferType([1, 2, 3])).toBe('array');
  });

  it('returns object for plain objects', () => {
    expect(inferType({})).toBe('object');
    expect(inferType({ a: 1 })).toBe('object');
  });

  it('returns boolean for booleans', () => {
    expect(inferType(true)).toBe('boolean');
    expect(inferType(false)).toBe('boolean');
  });

  it('returns string for strings', () => {
    expect(inferType('')).toBe('string');
    expect(inferType('hello')).toBe('string');
  });

  it('returns integer for whole numbers', () => {
    expect(inferType(0)).toBe('integer');
    expect(inferType(42)).toBe('integer');
    expect(inferType(-7)).toBe('integer');
  });

  it('returns number for floats', () => {
    expect(inferType(3.14)).toBe('number');
    expect(inferType(-0.5)).toBe('number');
  });

  it('returns string for Date objects (unknown/special types)', () => {
    expect(inferType(new Date())).toBe('string');
  });

  it('returns string for undefined (unknown runtime type)', () => {
    expect(inferType(undefined)).toBe('string');
  });
});

// ─── mergeDocument ────────────────────────────────────────────────────────────

describe('mergeDocument', () => {
  it('adds new fields on the first document (total=0)', () => {
    const acc: Record<string, InferredField> = {};
    mergeDocument(acc, { name: 'Alice', age: 30 }, 0);

    expect(acc['name']).toBeDefined();
    expect(acc['name'].types.has('string')).toBe(true);
    expect(acc['name'].seenCount).toBe(1);
    expect(acc['name'].presentInAll).toBe(true); // first doc

    expect(acc['age']).toBeDefined();
    expect(acc['age'].types.has('integer')).toBe(true);
    expect(acc['age'].presentInAll).toBe(true);
  });

  it('marks a field presentInAll=false when absent in a later document', () => {
    const acc: Record<string, InferredField> = {};
    mergeDocument(acc, { name: 'Alice', age: 30 }, 0);
    mergeDocument(acc, { name: 'Bob' }, 1); // age absent

    expect(acc['name'].seenCount).toBe(2);
    expect(acc['name'].presentInAll).toBe(true);
    expect(acc['age'].seenCount).toBe(1);
    expect(acc['age'].presentInAll).toBe(false);
  });

  it('marks field presentInAll=false when first seen after first document', () => {
    const acc: Record<string, InferredField> = {};
    mergeDocument(acc, { a: 1 }, 0);
    mergeDocument(acc, { a: 2, b: 'new' }, 1); // b seen for first time at total=1

    expect(acc['b'].presentInAll).toBe(false);
  });

  it('accumulates multiple types for a field across documents', () => {
    const acc: Record<string, InferredField> = {};
    mergeDocument(acc, { value: 'text' }, 0);
    mergeDocument(acc, { value: 42 }, 1);
    mergeDocument(acc, { value: true }, 2);

    expect(acc['value'].types.has('string')).toBe(true);
    expect(acc['value'].types.has('integer')).toBe(true);
    expect(acc['value'].types.has('boolean')).toBe(true);
    expect(acc['value'].seenCount).toBe(3);
  });
});

// ─── inferCollectionSchema ────────────────────────────────────────────────────

describe('inferCollectionSchema', () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri() + 'testinfer');
    await client.connect();
    db = client.db();
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  it('returns empty fields and sampleCount=0 for an empty collection', async () => {
    await db.createCollection('empty_col');
    const result = await inferCollectionSchema(db, 'empty_col');
    expect(result.sampleCount).toBe(0);
    expect(Object.keys(result.fields)).toHaveLength(0);
  });

  it('infers schema from a single document', async () => {
    const col = db.collection('single_doc');
    await col.insertOne({ name: 'Alice', age: 30, active: true });

    const result = await inferCollectionSchema(db, 'single_doc');
    expect(result.sampleCount).toBe(1);
    expect(result.fields['name'].types.has('string')).toBe(true);
    expect(result.fields['age'].types.has('integer')).toBe(true);
    expect(result.fields['active'].types.has('boolean')).toBe(true);
    expect(result.fields['_id']).toBeDefined();
  });

  it('merges shapes from multiple documents with mixed fields', async () => {
    const col = db.collection('mixed_docs');
    await col.insertMany([
      { name: 'Alice', role: 'admin' },
      { name: 'Bob', score: 42 },
      { name: 'Carol', role: 'user', score: 99 },
    ]);

    const result = await inferCollectionSchema(db, 'mixed_docs');
    expect(result.sampleCount).toBe(3);
    expect(result.fields['name'].seenCount).toBe(3);
    expect(result.fields['name'].presentInAll).toBe(true);
    expect(result.fields['role'].seenCount).toBe(2);
    expect(result.fields['role'].presentInAll).toBe(false);
    expect(result.fields['score'].seenCount).toBe(2);
  });

  it('caps sampling at SAMPLE_LIMIT documents', async () => {
    const col = db.collection('big_col');
    const docs = Array.from({ length: SAMPLE_LIMIT + 10 }, (_, i) => ({ idx: i }));
    await col.insertMany(docs);

    const result = await inferCollectionSchema(db, 'big_col');
    expect(result.sampleCount).toBe(SAMPLE_LIMIT);
  });

  it('detects null values as type "null"', async () => {
    const col = db.collection('nullable_col');
    await col.insertOne({ tag: null });

    const result = await inferCollectionSchema(db, 'nullable_col');
    expect(result.fields['tag'].types.has('null')).toBe(true);
  });

  it('detects array values', async () => {
    const col = db.collection('array_col');
    await col.insertOne({ tags: ['a', 'b'] });

    const result = await inferCollectionSchema(db, 'array_col');
    expect(result.fields['tags'].types.has('array')).toBe(true);
  });
});

// ─── buildPropertySchema ──────────────────────────────────────────────────────

describe('buildPropertySchema', () => {
  it('returns { type } for a single-type field', () => {
    const field: InferredField = {
      types: new Set(['string']),
      presentInAll: true,
      seenCount: 5,
    };
    expect(buildPropertySchema(field)).toEqual({ type: 'string' });
  });

  it('returns anyOf for multi-type fields', () => {
    const field: InferredField = {
      types: new Set(['string', 'null']),
      presentInAll: false,
      seenCount: 3,
    };
    const result = buildPropertySchema(field);
    expect(result.anyOf).toBeDefined();
    const types = (result.anyOf as Array<{ type: string }>).map((s) => s.type);
    expect(types).toContain('string');
    expect(types).toContain('null');
  });
});

// ─── buildSchemaObject ────────────────────────────────────────────────────────

describe('buildSchemaObject', () => {
  it('builds a valid JSON Schema object with x-schema-inference', () => {
    const schema = buildSchemaObject({
      sampleCount: 4,
      fields: {
        name: { types: new Set(['string']), presentInAll: true, seenCount: 4 },
        score: { types: new Set(['integer']), presentInAll: false, seenCount: 1 },
      },
    });

    expect(schema['x-schema-inference']).toBe('sampled');
    expect(schema.type).toBe('object');
    const props = schema.properties as Record<string, unknown>;
    expect(props['name']).toEqual({ type: 'string' });
    expect(props['score']).toEqual({ type: 'integer' });
  });

  it('includes required for fields seen in > 50% of samples', () => {
    const schema = buildSchemaObject({
      sampleCount: 4,
      fields: {
        name: { types: new Set(['string']), presentInAll: false, seenCount: 3 },
        rare: { types: new Set(['string']), presentInAll: false, seenCount: 2 }, // exactly 50% — NOT included
      },
    });

    const required = schema.required as string[] | undefined;
    expect(required).toContain('name');
    expect(required ?? []).not.toContain('rare');
  });

  it('omits required array when no fields meet threshold', () => {
    const schema = buildSchemaObject({
      sampleCount: 4,
      fields: {
        rare: { types: new Set(['string']), presentInAll: false, seenCount: 1 },
      },
    });
    expect(schema.required).toBeUndefined();
  });

  it('handles empty fields (empty collection)', () => {
    const schema = buildSchemaObject({ sampleCount: 0, fields: {} });
    expect(schema['x-schema-inference']).toBe('sampled');
    expect(schema.properties).toEqual({});
    expect(schema.required).toBeUndefined();
  });
});
