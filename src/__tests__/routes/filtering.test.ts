import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import { ALLOWED_OPERATORS, parseFilter, buildFilter } from '../../routes/filtering.js';

// ─── Mock reply ───────────────────────────────────────────────────────────────

function makeMockReply(): FastifyReply {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
  return reply;
}

// ─── ALLOWED_OPERATORS ────────────────────────────────────────────────────────

describe('ALLOWED_OPERATORS', () => {
  const expected = [
    '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
    '$in', '$nin', '$and', '$or', '$not',
    '$exists', '$regex', '$text',
  ];

  it.each(expected)('includes %s', (op) => {
    expect(ALLOWED_OPERATORS.has(op)).toBe(true);
  });

  it('does not include $where', () => {
    expect(ALLOWED_OPERATORS.has('$where')).toBe(false);
  });

  it('does not include $expr', () => {
    expect(ALLOWED_OPERATORS.has('$expr')).toBe(false);
  });
});

// ─── parseFilter ─────────────────────────────────────────────────────────────

describe('parseFilter', () => {
  let reply: FastifyReply;

  beforeEach(() => {
    reply = makeMockReply();
  });

  it('returns null when filterStr is undefined', () => {
    const result = parseFilter(undefined, reply);
    expect(result).toBeNull();
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('returns null when filterStr is empty string', () => {
    const result = parseFilter('', reply);
    expect(result).toBeNull();
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('returns parsed object for valid filter JSON', () => {
    const filter = JSON.stringify({ status: 'active' });
    const result = parseFilter(filter, reply);
    expect(result).toEqual({ status: 'active' });
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('parses nested filter with allowed operator', () => {
    const filter = JSON.stringify({ score: { $gt: 10 } });
    const result = parseFilter(filter, reply);
    expect(result).toEqual({ score: { $gt: 10 } });
  });

  it('parses $and with nested conditions', () => {
    const filter = JSON.stringify({ $and: [{ status: 'active' }, { score: { $gte: 5 } }] });
    const result = parseFilter(filter, reply);
    expect(result).toEqual({ $and: [{ status: 'active' }, { score: { $gte: 5 } }] });
  });

  it('sends 400 for invalid JSON', () => {
    const result = parseFilter('not-json', reply);
    expect(result).toBeUndefined();
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid filter' })
    );
  });

  it('400 detail includes parse error message', () => {
    parseFilter('{bad json}', reply);
    const sentPayload = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as { detail: string };
    expect(typeof sentPayload.detail).toBe('string');
    expect(sentPayload.detail.length).toBeGreaterThan(0);
  });

  it('sends 400 when filter is an array (not an object)', () => {
    const result = parseFilter(JSON.stringify([1, 2, 3]), reply);
    expect(result).toBeUndefined();
    expect(reply.code).toHaveBeenCalledWith(400);
  });

  it('sends 400 when filter is a string (not an object)', () => {
    const result = parseFilter(JSON.stringify('hello'), reply);
    expect(result).toBeUndefined();
    expect(reply.code).toHaveBeenCalledWith(400);
  });

  it('sends 400 when filter is null JSON', () => {
    const result = parseFilter('null', reply);
    expect(result).toBeUndefined();
    expect(reply.code).toHaveBeenCalledWith(400);
  });

  // ── Disallowed operators ──────────────────────────────────────────────────

  const disallowedOperators = [
    '$where', '$expr', '$function', '$accumulator', '$jsonSchema',
    '$mod', '$type', '$size', '$elemMatch', '$slice',
  ];

  it.each(disallowedOperators)('rejects disallowed operator %s', (op) => {
    const filter = JSON.stringify({ [op]: 'something' });
    const result = parseFilter(filter, reply);
    expect(result).toBeUndefined();
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'Operator not allowed',
      operator: op,
    });
  });

  it('rejects disallowed operator nested inside $and', () => {
    const filter = JSON.stringify({ $and: [{ $where: 'this.x > 0' }] });
    const result = parseFilter(filter, reply);
    expect(result).toBeUndefined();
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Operator not allowed', operator: '$where' })
    );
  });

  it('rejects disallowed operator nested in field value', () => {
    const filter = JSON.stringify({ status: { $where: 'bad' } });
    const result = parseFilter(filter, reply);
    expect(result).toBeUndefined();
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Operator not allowed', operator: '$where' })
    );
  });

  // ── Each allowlisted operator accepted ───────────────────────────────────

  const allowedCases: Array<[string, unknown]> = [
    ['$eq', { field: { $eq: 'value' } }],
    ['$ne', { field: { $ne: 'value' } }],
    ['$gt', { score: { $gt: 10 } }],
    ['$gte', { score: { $gte: 10 } }],
    ['$lt', { score: { $lt: 10 } }],
    ['$lte', { score: { $lte: 10 } }],
    ['$in', { status: { $in: ['a', 'b'] } }],
    ['$nin', { status: { $nin: ['a', 'b'] } }],
    ['$and', { $and: [{ x: 1 }] }],
    ['$or', { $or: [{ x: 1 }, { y: 2 }] }],
    ['$not', { field: { $not: { $eq: 'bad' } } }],
    ['$exists', { field: { $exists: true } }],
    ['$regex', { name: { $regex: '^foo' } }],
    ['$text', { $text: { $search: 'hello' } }],
  ];

  it.each(allowedCases)('accepts allowed operator %s', (_op, filterObj) => {
    const result = parseFilter(JSON.stringify(filterObj), reply);
    expect(result).toEqual(filterObj);
    expect(reply.code).not.toHaveBeenCalled();
  });
});

// ─── buildFilter ──────────────────────────────────────────────────────────────

describe('buildFilter', () => {
  it('returns empty object when no flat params and no parsedFilter', () => {
    const result = buildFilter({}, null);
    expect(result).toEqual({});
  });

  it('includes flat params as filter fields', () => {
    const result = buildFilter({ status: 'active', role: 'admin' }, null);
    expect(result).toEqual({ status: 'active', role: 'admin' });
  });

  it('excludes reserved param names from flat params', () => {
    const result = buildFilter(
      { page: '2', pageSize: '10', sort: 'name', filter: '{}', status: 'ok' },
      null
    );
    expect(result).toEqual({ status: 'ok' });
    expect(result).not.toHaveProperty('page');
    expect(result).not.toHaveProperty('pageSize');
    expect(result).not.toHaveProperty('sort');
    expect(result).not.toHaveProperty('filter');
  });

  it('merges parsedFilter with flat params', () => {
    const result = buildFilter({ status: 'active' }, { score: { $gt: 5 } });
    expect(result).toEqual({ status: 'active', score: { $gt: 5 } });
  });

  it('parsedFilter wins on conflict', () => {
    const result = buildFilter({ status: 'flat' }, { status: 'explicit' });
    expect(result.status).toBe('explicit');
  });

  it('excludes undefined flat params', () => {
    const result = buildFilter({ status: undefined, role: 'admin' }, null);
    expect(result).not.toHaveProperty('status');
    expect(result).toHaveProperty('role', 'admin');
  });

  it('uses parsedFilter alone when no flat params remain', () => {
    const result = buildFilter({ page: '1' }, { name: 'alice' });
    expect(result).toEqual({ name: 'alice' });
  });
});
