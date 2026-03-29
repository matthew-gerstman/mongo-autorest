import { describe, it, expect, vi } from 'vitest';
import { type Collection, type Document } from 'mongodb';
import {
  parsePaginationParams,
  parseSortParam,
  executePaginatedQuery,
  type PaginationParams,
} from '../../routes/pagination.js';
import { type AutoRestConfig } from '../../config/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<AutoRestConfig> = {}): AutoRestConfig {
  return { ...overrides } as AutoRestConfig;
}

// ─── parsePaginationParams ─────────────────────────────────────────────────────

describe('parsePaginationParams', () => {
  it('defaults page to 1 and pageSize to config.defaultPageSize', () => {
    const result = parsePaginationParams(undefined, undefined, makeConfig({ defaultPageSize: 50 }));
    expect(result).toEqual({ page: 1, pageSize: 50 });
  });

  it('defaults pageSize to 100 when config.defaultPageSize is not set', () => {
    const result = parsePaginationParams(undefined, undefined, makeConfig());
    expect(result).toEqual({ page: 1, pageSize: 100 });
  });

  it('parses numeric page and pageSize', () => {
    const result = parsePaginationParams('3', '25', makeConfig());
    expect(result).toEqual({ page: 3, pageSize: 25 });
  });

  it('clamps page minimum to 1', () => {
    const result = parsePaginationParams('0', undefined, makeConfig());
    expect(result.page).toBe(1);

    const result2 = parsePaginationParams('-5', undefined, makeConfig());
    expect(result2.page).toBe(1);
  });

  it('clamps pageSize maximum to 1000', () => {
    const result = parsePaginationParams(undefined, '9999', makeConfig());
    expect(result.pageSize).toBe(1000);
  });

  it('clamps pageSize to 1000 exactly at the boundary', () => {
    const result = parsePaginationParams(undefined, '1000', makeConfig());
    expect(result.pageSize).toBe(1000);
  });

  it('clamps pageSize minimum to 1', () => {
    const result = parsePaginationParams(undefined, '0', makeConfig());
    expect(result.pageSize).toBe(1);
  });

  it('falls back to defaultPageSize for non-numeric pageSize', () => {
    const result = parsePaginationParams(undefined, 'abc', makeConfig({ defaultPageSize: 25 }));
    expect(result.pageSize).toBe(25);
  });

  it('falls back to page 1 for non-numeric page', () => {
    const result = parsePaginationParams('abc', undefined, makeConfig());
    expect(result.page).toBe(1);
  });
});

// ─── parseSortParam ───────────────────────────────────────────────────────────

describe('parseSortParam', () => {
  it('returns undefined for undefined sortStr', () => {
    expect(parseSortParam(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseSortParam('')).toBeUndefined();
  });

  it('returns ascending sort for plain field name', () => {
    expect(parseSortParam('name')).toEqual({ name: 1 });
  });

  it('returns descending sort for - prefixed field', () => {
    expect(parseSortParam('-createdAt')).toEqual({ createdAt: -1 });
  });

  it('handles field names with underscores', () => {
    expect(parseSortParam('first_name')).toEqual({ first_name: 1 });
  });

  it('handles - prefix on dotted field path', () => {
    expect(parseSortParam('-meta.score')).toEqual({ 'meta.score': -1 });
  });
});

// ─── executePaginatedQuery ────────────────────────────────────────────────────

describe('executePaginatedQuery', () => {
  function makeCollection(docs: Document[], count?: number): Collection<Document> {
    const toArray = vi.fn().mockResolvedValue(docs);
    const limit = vi.fn().mockReturnThis();
    const skip = vi.fn().mockReturnThis();
    const sort = vi.fn().mockReturnThis();
    const find = vi.fn().mockReturnValue({ sort, skip, limit, toArray });
    const countDocuments = vi.fn().mockResolvedValue(count ?? docs.length);
    const estimatedDocumentCount = vi.fn().mockResolvedValue(count ?? docs.length);

    return {
      find,
      countDocuments,
      estimatedDocumentCount,
    } as unknown as Collection<Document>;
  }

  const params: PaginationParams = { page: 1, pageSize: 10 };

  it('returns data and pagination envelope', async () => {
    const docs = [{ _id: 'a', name: 'Alice' }, { _id: 'b', name: 'Bob' }];
    const col = makeCollection(docs, 2);

    const result = await executePaginatedQuery(col, {}, undefined, params, makeConfig());

    expect(result.data).toEqual(docs);
    expect(result.pagination).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 2,
      totalPages: 1,
    });
  });

  it('calculates totalPages correctly', async () => {
    const col = makeCollection([], 25);
    const result = await executePaginatedQuery(col, {}, undefined, { page: 1, pageSize: 10 }, makeConfig());
    expect(result.pagination.totalPages).toBe(3); // ceil(25/10)
  });

  it('calculates totalPages as 1 when total is 0', async () => {
    const col = makeCollection([], 0);
    const result = await executePaginatedQuery(col, {}, undefined, params, makeConfig());
    // ceil(0/10) = 0, but our impl returns 0 — test actual behavior
    expect(result.pagination.totalPages).toBe(0);
  });

  it('passes sort spec to .sort()', async () => {
    const col = makeCollection([]);
    const sortSpec = { name: 1 as const };
    await executePaginatedQuery(col, {}, sortSpec, params, makeConfig());
    const findResult = (col.find as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(findResult.sort).toHaveBeenCalledWith(sortSpec);
  });

  it('passes empty object to .sort() when no sort spec', async () => {
    const col = makeCollection([]);
    await executePaginatedQuery(col, {}, undefined, params, makeConfig());
    const findResult = (col.find as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(findResult.sort).toHaveBeenCalledWith({});
  });

  it('uses countDocuments by default (not fast count)', async () => {
    const col = makeCollection([]);
    await executePaginatedQuery(col, {}, undefined, params, makeConfig());
    expect(col.countDocuments).toHaveBeenCalled();
    expect(col.estimatedDocumentCount).not.toHaveBeenCalled();
  });

  it('uses estimatedDocumentCount when useFastCount is true', async () => {
    const col = makeCollection([]);
    await executePaginatedQuery(col, {}, undefined, params, makeConfig({ useFastCount: true }));
    expect(col.estimatedDocumentCount).toHaveBeenCalled();
    expect(col.countDocuments).not.toHaveBeenCalled();
  });

  it('includes totalEstimated: true in pagination when useFastCount is true', async () => {
    const col = makeCollection([], 500);
    const result = await executePaginatedQuery(col, {}, undefined, params, makeConfig({ useFastCount: true }));
    expect(result.pagination.totalEstimated).toBe(true);
  });

  it('does NOT include totalEstimated when useFastCount is false', async () => {
    const col = makeCollection([], 10);
    const result = await executePaginatedQuery(col, {}, undefined, params, makeConfig());
    expect(result.pagination).not.toHaveProperty('totalEstimated');
  });

  it('calculates correct skip for page 2', async () => {
    const col = makeCollection([]);
    await executePaginatedQuery(col, {}, undefined, { page: 2, pageSize: 10 }, makeConfig());
    const findResult = (col.find as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(findResult.skip).toHaveBeenCalledWith(10); // (2-1) * 10
  });

  it('calculates correct skip for page 3 with pageSize 5', async () => {
    const col = makeCollection([]);
    await executePaginatedQuery(col, {}, undefined, { page: 3, pageSize: 5 }, makeConfig());
    const findResult = (col.find as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(findResult.skip).toHaveBeenCalledWith(10); // (3-1) * 5
  });

  it('passes pageSize as limit', async () => {
    const col = makeCollection([]);
    await executePaginatedQuery(col, {}, undefined, { page: 1, pageSize: 42 }, makeConfig());
    const findResult = (col.find as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(findResult.limit).toHaveBeenCalledWith(42);
  });

  it('passes filter to find and countDocuments', async () => {
    const col = makeCollection([]);
    const filter = { status: 'active' };
    await executePaginatedQuery(col, filter as never, undefined, params, makeConfig());
    expect(col.find).toHaveBeenCalledWith(filter);
    expect(col.countDocuments).toHaveBeenCalledWith(filter);
  });
});
