import { type FastifyReply } from 'fastify';

// ─── Operator allowlist ───────────────────────────────────────────────────────

/**
 * The set of MongoDB query operators permitted in filter expressions.
 * Any other $ operator (e.g. $where, $expr) will be rejected with 400.
 *
 * Includes top-level operators and $text sub-operators ($search, $language,
 * $caseSensitive, $diacriticSensitive) which appear nested under $text.
 */
export const ALLOWED_OPERATORS = new Set([
  // Comparison
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
  // Logical
  '$and', '$or', '$not',
  // Element
  '$exists',
  // Evaluation
  '$regex', '$options', '$text',
  // $text sub-operators (appear nested under $text key)
  '$search', '$language', '$caseSensitive', '$diacriticSensitive',
]);

// ─── Operator validation ──────────────────────────────────────────────────────

/**
 * Recursively walk a parsed filter object and collect any $ keys that are not
 * in the allowlist. Returns a list of disallowed operator names.
 */
function collectDisallowedOperators(value: unknown): string[] {
  if (value === null || typeof value !== 'object') {
    return [];
  }

  const disallowed: string[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      disallowed.push(...collectDisallowedOperators(item));
    }
    return disallowed;
  }

  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('$')) {
      if (!ALLOWED_OPERATORS.has(key)) {
        disallowed.push(key);
      }
    }
    // Recurse into nested values regardless of whether the key is an operator
    disallowed.push(...collectDisallowedOperators(val));
  }

  return disallowed;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse and validate the `filter` query param.
 *
 * - Returns `null` on success (no filter) when `filterStr` is undefined/empty.
 * - Returns the parsed filter object on success.
 * - Sends a 400 reply and returns `undefined` on parse or validation error.
 *   (Callers should check for `undefined` and bail out early.)
 */
export function parseFilter(
  filterStr: string | undefined,
  reply: FastifyReply
): Record<string, unknown> | null | undefined {
  if (!filterStr) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(filterStr);
  } catch (e) {
    void reply.code(400).send({
      error: 'Invalid filter',
      detail: e instanceof Error ? e.message : 'JSON parse error',
    });
    return undefined; // signal: reply already sent
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    void reply.code(400).send({
      error: 'Invalid filter',
      detail: 'Filter must be a JSON object',
    });
    return undefined;
  }

  const disallowed = collectDisallowedOperators(parsed);
  if (disallowed.length > 0) {
    // Report only the first offending operator (consistent, deterministic)
    void reply.code(400).send({
      error: 'Operator not allowed',
      operator: disallowed[0],
    });
    return undefined;
  }

  return parsed as Record<string, unknown>;
}

/**
 * Build a combined MongoDB filter from flat query params and an explicit
 * parsed filter. The explicit filter wins on key conflicts.
 *
 * @param flatParams  - URL query params after removing reserved names.
 * @param parsedFilter - Already-validated parsed filter object (or null).
 */
export function buildFilter(
  flatParams: Record<string, string | undefined>,
  parsedFilter: Record<string, unknown> | null
): Record<string, unknown> {
  const reserved = new Set(['page', 'pageSize', 'sort', 'filter']);
  const base: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(flatParams)) {
    if (!reserved.has(key) && val !== undefined) {
      base[key] = val;
    }
  }

  if (parsedFilter === null) {
    return base;
  }

  // Explicit filter wins on conflict
  return { ...base, ...parsedFilter };
}
