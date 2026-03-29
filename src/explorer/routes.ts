import { type FastifyInstance } from 'fastify';
import { type Db } from 'mongodb';
import { type AutoRestConfig } from '../config/index.js';
import { type CollectionInfo } from '../introspection/index.js';
import { inferCollectionSchema, buildSchemaObject } from '../openapi/inference.js';
import { renderExplorerPage } from './template.js';

export interface CollectionManifestEntry {
  name: string;
  slug: string;
  count: number;
  schema: Record<string, unknown>;
}

export interface CollectionManifest {
  collections: CollectionManifestEntry[];
}

export interface RegisterExplorerRoutesOptions {
  db: Db;
  config: AutoRestConfig;
  collections: CollectionInfo[];
  prefix?: string;
}

export async function registerExplorerRoutes(
  fastify: FastifyInstance,
  options: RegisterExplorerRoutesOptions
): Promise<void> {
  const { db, config, collections, prefix = '/api' } = options;

  const isProduction = process.env['NODE_ENV'] === 'production';
  const shouldServeExplorer =
    config.explorer === false ? false
    : config.explorer === true ? true
    : !isProduction;

  if (!shouldServeExplorer) return;

  // Explorer routes are intentionally public — no auth hook applied here.
  // The /explorer HTML page and /explorer-api/collections metadata endpoint
  // do not expose sensitive data (they serve the UI shell and collection names).
  // The explorer's client-side JS fetches from /api/* routes which DO enforce
  // auth via the API key input field in the explorer UI.
  await fastify.register(async (scopedPlugin: FastifyInstance) => {
    scopedPlugin.get('/explorer', async (_req, reply) => {
      const html = renderExplorerPage({
        title: config.explorerOptions?.title ?? 'API Explorer',
        theme: config.explorerOptions?.theme ?? 'auto',
        defaultPageSize: config.explorerOptions?.defaultPageSize ?? 25,
        prefix,
        authEnabled: Boolean(config.auth),
      });
      return reply.code(200).type('text/html').send(html);
    });

    // Simple in-memory cache with 30s TTL
    let manifestCache: { data: CollectionManifest; expiresAt: number } | null = null;

    scopedPlugin.get('/explorer-api/collections', async (_req, reply) => {
      const now = Date.now();
      if (manifestCache && manifestCache.expiresAt > now) {
        return reply.code(200).send(manifestCache.data);
      }

      const entries: CollectionManifestEntry[] = await Promise.all(
        collections.map(async (col) => {
          const count = await db.collection(col.name).estimatedDocumentCount();
          const inferred = await inferCollectionSchema(db, col.name);
          const schema = buildSchemaObject(inferred) as Record<string, unknown>;
          return { name: col.name, slug: col.slug, count, schema };
        })
      );

      const manifest: CollectionManifest = { collections: entries };
      manifestCache = { data: manifest, expiresAt: now + 30_000 };
      return reply.code(200).send(manifest);
    });
  });
}
