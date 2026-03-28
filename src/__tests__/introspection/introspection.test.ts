import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import {
  introspectDatabase,
  diffCollections,
  startIntrospectionInterval,
  type CollectionInfo,
} from '../../introspection/index.js';

describe('introspectDatabase', () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db('test');
  });

  afterEach(async () => {
    await client.close();
    await mongod.stop();
  });

  it('returns an empty list when no collections exist', async () => {
    const result = await introspectDatabase(db, {});
    expect(result.collections).toEqual([]);
    expect(result.introspectedAt).toBeInstanceOf(Date);
  });

  it('returns collection names with slugs', async () => {
    await db.createCollection('orders');
    await db.createCollection('user_accounts');

    const result = await introspectDatabase(db, {});
    const names = result.collections.map((c) => c.name).sort();
    const slugs = result.collections.map((c) => c.slug).sort();

    expect(names).toContain('orders');
    expect(names).toContain('user_accounts');
    expect(slugs).toContain('orders');
    expect(slugs).toContain('user-accounts');
  });

  it('filters out system.* collections', async () => {
    await db.createCollection('orders');
    // system.views is created automatically by MongoDB in some setups
    const result = await introspectDatabase(db, {});
    const systemCols = result.collections.filter((c) =>
      c.name.startsWith('system.')
    );
    expect(systemCols).toHaveLength(0);
  });

  it('filters out collections marked exclude: true in config', async () => {
    await db.createCollection('orders');
    await db.createCollection('internal_logs');

    const result = await introspectDatabase(db, {
      collections: { internal_logs: { exclude: true } },
    });

    const names = result.collections.map((c) => c.name);
    expect(names).toContain('orders');
    expect(names).not.toContain('internal_logs');
  });

  it('uses alias as slug when configured', async () => {
    await db.createCollection('users');

    const result = await introspectDatabase(db, {
      collections: { users: { alias: 'members' } },
    });

    const usersCol = result.collections.find((c) => c.name === 'users');
    expect(usersCol?.slug).toBe('members');
  });

  it('sets introspectedAt to a recent date', async () => {
    const before = new Date();
    const result = await introspectDatabase(db, {});
    const after = new Date();
    expect(result.introspectedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime()
    );
    expect(result.introspectedAt.getTime()).toBeLessThanOrEqual(
      after.getTime()
    );
  });
});

describe('diffCollections', () => {
  const mkCol = (name: string, slug?: string): CollectionInfo => ({
    name,
    slug: slug ?? name,
  });

  it('returns empty diff when collections are the same', () => {
    const cols = [mkCol('orders'), mkCol('users')];
    const diff = diffCollections(cols, cols);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('detects added collections', () => {
    const prev = [mkCol('orders')];
    const curr = [mkCol('orders'), mkCol('users')];
    const diff = diffCollections(prev, curr);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]?.name).toBe('users');
    expect(diff.removed).toHaveLength(0);
  });

  it('detects removed collections', () => {
    const prev = [mkCol('orders'), mkCol('users')];
    const curr = [mkCol('orders')];
    const diff = diffCollections(prev, curr);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]?.name).toBe('users');
    expect(diff.added).toHaveLength(0);
  });

  it('detects both added and removed collections simultaneously', () => {
    const prev = [mkCol('orders'), mkCol('users')];
    const curr = [mkCol('orders'), mkCol('products')];
    const diff = diffCollections(prev, curr);
    expect(diff.added.map((c) => c.name)).toContain('products');
    expect(diff.removed.map((c) => c.name)).toContain('users');
  });
});

describe('startIntrospectionInterval', () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db('test');
  });

  afterEach(async () => {
    await client.close();
    await mongod.stop();
  });

  it('returns a stop function when no interval configured', () => {
    const stop = startIntrospectionInterval(
      db,
      {},
      { collections: [], introspectedAt: new Date() },
      () => undefined
    );
    expect(typeof stop).toBe('function');
    stop(); // should not throw
  });

  it('fires onChange when a new collection appears', async () => {
    await db.createCollection('orders');
    const initial = await introspectDatabase(db, {});

    const onChange = vi.fn();

    const stop = startIntrospectionInterval(
      db,
      { introspectionInterval: 50 },
      initial,
      onChange
    );

    // Add a new collection while interval is running
    await db.createCollection('products');

    // Wait for at least one interval tick
    await new Promise((resolve) => setTimeout(resolve, 200));
    stop();

    expect(onChange).toHaveBeenCalled();
    const [added] = onChange.mock.calls[0] as [CollectionInfo[], CollectionInfo[]];
    expect(added.map((c: CollectionInfo) => c.name)).toContain('products');
  });

  it('does NOT fire onChange when collections are unchanged', async () => {
    await db.createCollection('orders');
    const initial = await introspectDatabase(db, {});

    const onChange = vi.fn();

    const stop = startIntrospectionInterval(
      db,
      { introspectionInterval: 50 },
      initial,
      onChange
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    stop();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('stop() cancels further ticks', async () => {
    const initial = { collections: [], introspectedAt: new Date() };
    const onChange = vi.fn();

    const stop = startIntrospectionInterval(
      db,
      { introspectionInterval: 50 },
      initial,
      onChange
    );

    stop(); // stop immediately

    await db.createCollection('orders');
    await new Promise((resolve) => setTimeout(resolve, 200));

    // onChange should never have been called since we stopped before any tick
    expect(onChange).not.toHaveBeenCalled();
  });
});
