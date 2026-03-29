import { type Collection, type Document, type Filter, type Sort } from 'mongodb';
import { type AutoRestConfig } from '../config/index.js';
import { getDefaultPageSize } from '../config/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Present and true when fast count (estimatedDocumentCount) was used */
  totalEstimated?: true;
}

export interface PageResult {
  data: Document[];
  pagination: PaginationMeta;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse an integer from a string. Returns `fallback` if the string is absent
 * or does not parse as a finite integer (NaN, Infinity, etc.).
 * Unlike `parseInt(s) || fallback`, this correctly handles the value "0".
 */
function parseIntOrDefault(s: string | undefined, fallback: number): number {
  if (s === undefined || s === '') return fallback;
  const n = parseInt(s, 10);
  return isNaN(n) ? fallback : n;
}

// ─── Param parsing ────────────────────────────────────────────────────────────

/**
 * Parse and clamp pagination query params.
 *
 * - `page` defaults to 1, minimum 1.
 * - `pageSize` defaults to config.defaultPageSize (default 100), capped at 1000.
 */
export function parsePaginationParams(
  pageStr: string | undefined,
  pageSizeStr: string | undefined,
  config: AutoRestConfig
): PaginationParams {
  const defaultPageSize = getDefaultPageSize(config);

  const page = Math.max(1, parseIntOrDefault(pageStr, 1));
  const pageSize = Math.min(
    1000,
    Math.max(1, parseIntOrDefault(pageSizeStr, defaultPageSize))
  );

  return { page, pageSize };
}

/**
 * Parse the `sort` query param into a MongoDB Sort spec.
 *
 * Format: field name, prefix `-` for descending.
 * Returns `undefined` if no sort param is provided.
 */
export function parseSortParam(sortStr: string | undefined): Sort | undefined {
  if (!sortStr) {
    return undefined;
  }

  const field = sortStr.startsWith('-') ? sortStr.slice(1) : sortStr;
  const dir: 1 | -1 = sortStr.startsWith('-') ? -1 : 1;
  return { [field]: dir };
}

// ─── Query execution ──────────────────────────────────────────────────────────

/**
 * Execute a paginated MongoDB query and return documents + pagination metadata.
 *
 * When `config.useFastCount` is true, uses `estimatedDocumentCount()` instead
 * of `countDocuments()` for large collections. The response will include
 * `totalEstimated: true` in the pagination envelope.
 */
export async function executePaginatedQuery(
  collection: Collection<Document>,
  filter: Filter<Document>,
  sort: Sort | undefined,
  params: PaginationParams,
  config: AutoRestConfig
): Promise<PageResult> {
  const { page, pageSize } = params;
  const skip = (page - 1) * pageSize;

  const docsPromise = collection
    .find(filter)
    .sort(sort ?? {})
    .skip(skip)
    .limit(pageSize)
    .toArray();

  let total: number;
  let totalEstimated = false;

  if (config.useFastCount) {
    // Fast path: estimatedDocumentCount ignores the filter but is O(1).
    // Useful for very large collections where approximate counts suffice.
    total = await collection.estimatedDocumentCount();
    totalEstimated = true;
  } else {
    total = await collection.countDocuments(filter);
  }

  const docs = await docsPromise;

  const pagination: PaginationMeta = {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    ...(totalEstimated ? { totalEstimated: true as const } : {}),
  };

  return { data: docs, pagination };
}
