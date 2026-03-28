import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { type Db, type Filter, type Document, ObjectId } from 'mongodb';
import { type AutoRestConfig } from '../config/index.js';
import { getDefaultPageSize } from '../config/index.js';

// ─── ID coercion ─────────────────────────────────────────────────────────────

/**
 * Build a MongoDB filter for _id that handles both ObjectId and string IDs.
 * ObjectId coercion is attempted first; if the string is not a valid ObjectId
 * it falls back to a plain string match.
 *
 * We use `unknown` cast to satisfy MongoDB's strict Filter<Document> typing
 * which constrains _id to Condition<ObjectId>.
 */
function buildIdFilter(id: string): Filter<Document> {
  try {
    // Valid 24-hex-char string → use ObjectId
    return { _id: new ObjectId(id) } as unknown as Filter<Document>;
  } catch {
    // Not a valid ObjectId → treat as plain string _id
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

/**
 * Register the 6 CRUD routes for a single collection on an encapsulated
 * Fastify sub-instance. Read-only mode omits write routes and registers
 * 405 fallbacks in their place.
 */
export function registerCrudRoutes(
  fastify: FastifyInstance,
  db: Db,
  collectionName: string,
  _slug: string,
  config: AutoRestConfig,
  readOnly: boolean
): void {
  const col = db.collection(collectionName);
  const defaultPageSize = getDefaultPageSize(config);

  // ── LIST ────────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: ListQuerystring }>(
    '/',
    async (req: FastifyRequest<{ Querystring: ListQuerystring }>, reply: FastifyReply) => {
      const { page: pageStr, pageSize: pageSizeStr, sort: sortStr, filter: filterStr, ...flatParams } = req.query;

      const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
      const pageSize = Math.min(
        1000,
        Math.max(1, parseInt(pageSizeStr ?? String(defaultPageSize), 10) || defaultPageSize)
      );

      // Build filter: explicit filter param takes precedence over flat params
      let filter: Record<string, unknown> = {};

      // Flat params (everything except reserved names)
      const reserved = new Set(['page', 'pageSize', 'sort', 'filter']);
      for (const [key, val] of Object.entries(flatParams)) {
        if (!reserved.has(key) && val !== undefined) {
          filter[key] = val;
        }
      }

      if (filterStr) {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(filterStr) as Record<string, unknown>;
        } catch (e) {
          return reply.code(400).send({
            error: 'Invalid filter',
            detail: e instanceof Error ? e.message : 'JSON parse error',
          });
        }
        // Merge — filter param wins on conflict
        filter = { ...filter, ...parsed };
      }

      // Sort
      let sortSpec: Record<string, 1 | -1> | undefined;
      if (sortStr) {
        const field = sortStr.startsWith('-') ? sortStr.slice(1) : sortStr;
        const dir: 1 | -1 = sortStr.startsWith('-') ? -1 : 1;
        sortSpec = { [field]: dir };
      }

      const skip = (page - 1) * pageSize;
      const mongoFilter = filter as unknown as Filter<Document>;

      const [docs, total] = await Promise.all([
        col
          .find(mongoFilter)
          .sort(sortSpec ?? {})
          .skip(skip)
          .limit(pageSize)
          .toArray(),
        col.countDocuments(mongoFilter),
      ]);

      return reply.code(200).send({
        data: docs,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
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
    // Register 405 handlers for all write paths
    const readOnlyBody = { error: 'This resource is read-only' };

    fastify.post('/', async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply.code(405).send(readOnlyBody);
    });

    fastify.put<{ Params: { id: string } }>(
      '/:id',
      async (_req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        return reply.code(405).send(readOnlyBody);
      }
    );

    fastify.patch<{ Params: { id: string } }>(
      '/:id',
      async (_req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        return reply.code(405).send(readOnlyBody);
      }
    );

    fastify.delete<{ Params: { id: string } }>(
      '/:id',
      async (_req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        return reply.code(405).send(readOnlyBody);
      }
    );

    return; // Done — no real write routes
  }

  // ── CREATE ──────────────────────────────────────────────────────────────────
  fastify.post<{ Body: Record<string, unknown> }>(
    '/',
    async (req: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
      const body = req.body ?? {};
      const result = await col.insertOne(body as Document);
      const inserted = await col.findOne({ _id: result.insertedId });
      return reply.code(201).send(inserted);
    }
  );

  // ── REPLACE ─────────────────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/:id',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>,
      reply: FastifyReply
    ) => {
      const { id } = req.params;
      const filter = buildIdFilter(id);
      const body = req.body ?? {};

      // Strip _id from the replacement body to avoid immutable field error
      const { _id: _ignored, ...replacement } = body;

      const result = await col.replaceOne(filter, replacement as Document);
      if (result.matchedCount === 0) {
        return reply.code(404).send({ error: 'Not found', id });
      }

      const updated = await col.findOne(filter);
      return reply.code(200).send(updated);
    }
  );

  // ── PATCH ───────────────────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/:id',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>,
      reply: FastifyReply
    ) => {
      const { id } = req.params;
      const filter = buildIdFilter(id);
      const body = req.body ?? {};

      const result = await col.updateOne(filter, { $set: body });
      if (result.matchedCount === 0) {
        return reply.code(404).send({ error: 'Not found', id });
      }

      const updated = await col.findOne(filter);
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

      return reply.code(204).send();
    }
  );
}
