import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { type Db, type Filter, type Document, ObjectId } from 'mongodb';
import { type AutoRestConfig } from '../config/index.js';
import { type AutoRestEventEmitter } from '../webhooks/events.js';
import { parseFilter, buildFilter } from './filtering.js';
import { parsePaginationParams, parseSortParam, executePaginatedQuery } from './pagination.js';

// ─── ID coercion ─────────────────────────────────────────────────────────────

function buildIdFilter(id: string): Filter<Document> {
  try {
    return { _id: new ObjectId(id) } as unknown as Filter<Document>;
  } catch {
    return { _id: id } as unknown as Filter<Document>;
  }
}

// ─── Query param types ────────────────────────────────────────────────────────

interface ListQuerystring {
  page?: string;
  pageSize?: string;
  sort?: string;
  filter?: string;
  [key: string]: string | undefined;
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerCrudRoutes(
  fastify: FastifyInstance,
  db: Db,
  collectionName: string,
  _slug: string,
  config: AutoRestConfig,
  readOnly: boolean,
  emitter?: AutoRestEventEmitter
): void {
  const col = db.collection(collectionName);

  // ── LIST ────────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: ListQuerystring }>(
    '/',
    async (req: FastifyRequest<{ Querystring: ListQuerystring }>, reply: FastifyReply) => {
      const { page: pageStr, pageSize: pageSizeStr, sort: sortStr, filter: filterStr, ...flatParams } = req.query;

      const parsedFilter = parseFilter(filterStr, reply);
      if (parsedFilter === undefined) {
        return;
      }

      const filter = buildFilter(flatParams, parsedFilter);
      const paginationParams = parsePaginationParams(pageStr, pageSizeStr, config);
      const sort = parseSortParam(sortStr);

      const mongoFilter = filter as unknown as Filter<Document>;
      const result = await executePaginatedQuery(col, mongoFilter, sort, paginationParams, config);

      return reply.code(200).send(result);
    }
  );

  // ── GET ONE ─────────────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.params;
      const filter = buildIdFilter(id);
      const doc = await col.findOne(filter);
      if (!doc) {
        return reply.code(404).send({ error: 'Not found', id });
      }
      return reply.code(200).send(doc);
    }
  );

  // ── WRITE ROUTES (omitted if readOnly) ──────────────────────────────────────
  if (readOnly) {
    const readOnlyBody = { error: 'This resource is read-only' };
    fastify.post('/', async (_req: FastifyRequest, reply: FastifyReply) => reply.code(405).send(readOnlyBody));
    fastify.put<{ Params: { id: string } }>('/:id', async (_req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => reply.code(405).send(readOnlyBody));
    fastify.patch<{ Params: { id: string } }>('/:id', async (_req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => reply.code(405).send(readOnlyBody));
    fastify.delete<{ Params: { id: string } }>('/:id', async (_req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => reply.code(405).send(readOnlyBody));
    return;
  }

  // ── CREATE ──────────────────────────────────────────────────────────────────
  fastify.post<{ Body: Record<string, unknown> }>(
    '/',
    async (req: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
      const body = req.body ?? {};
      const result = await col.insertOne(body as Document);
      const inserted = await col.findOne({ _id: result.insertedId });
      if (emitter && inserted) {
        emitter.emit('document.created', { collection: collectionName, document: inserted as Record<string, unknown> });
      }
      return reply.code(201).send(inserted);
    }
  );

  // ── REPLACE ─────────────────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/:id',
    async (req: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>, reply: FastifyReply) => {
      const { id } = req.params;
      const filter = buildIdFilter(id);
      const body = req.body ?? {};
      const { _id: _ignored, ...replacement } = body;
      const result = await col.replaceOne(filter, replacement as Document);
      if (result.matchedCount === 0) {
        return reply.code(404).send({ error: 'Not found', id });
      }
      const updated = await col.findOne(filter);
      if (emitter) {
        emitter.emit('document.updated', { collection: collectionName, id, changes: replacement });
      }
      return reply.code(200).send(updated);
    }
  );

  // ── PATCH ───────────────────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/:id',
    async (req: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>, reply: FastifyReply) => {
      const { id } = req.params;
      const filter = buildIdFilter(id);
      const body = req.body ?? {};
      const result = await col.updateOne(filter, { $set: body });
      if (result.matchedCount === 0) {
        return reply.code(404).send({ error: 'Not found', id });
      }
      const updated = await col.findOne(filter);
      if (emitter) {
        emitter.emit('document.updated', { collection: collectionName, id, changes: body });
      }
      return reply.code(200).send(updated);
    }
  );

  // ── DELETE ──────────────────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.params;
      const filter = buildIdFilter(id);
      const result = await col.deleteOne(filter);
      if (result.deletedCount === 0) {
        return reply.code(404).send({ error: 'Not found', id });
      }
      if (emitter) {
        emitter.emit('document.deleted', { collection: collectionName, id });
      }
      return reply.code(204).send();
    }
  );
}
