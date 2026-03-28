import { type FastifyInstance } from 'fastify';
import { type Db } from 'mongodb';
import {
  type AutoRestConfig,
  isCollectionExcluded,
  isCollectionReadOnly,
  resolveCollectionSlug,
} from '../config/index.js';
import { createAuthHook } from '../middleware/auth.js';
import { registerCrudRoutes } from './crud.js';

export interface RouteGeneratorOptions {
  db: Db;
  config: AutoRestConfig;
  collectionNames: string[];
}

/**
 * Register Fastify routes for all surviving collections.
 *
 * Each collection gets its own encapsulated Fastify plugin so that
 * per-collection auth hooks are isolated and don't bleed across.
 *
 * NOTE: `fastify` is already scoped with the caller's prefix (e.g. '/api')
 * via Fastify's register({ prefix }) option. We only add '/<slug>' here —
 * NOT '/<prefix>/<slug>' — to avoid double-prefixing.
 */
export async function registerRoutes(
  fastify: FastifyInstance,
  options: RouteGeneratorOptions
): Promise<void> {
  const { db, config, collectionNames } = options;

  for (const collectionName of collectionNames) {
    // Skip excluded collections (system.* + config.exclude)
    if (isCollectionExcluded(collectionName, config)) {
      continue;
    }

    const slug = resolveCollectionSlug(collectionName, config);
    const readOnly = isCollectionReadOnly(collectionName, config);

    // Determine auth for this collection
    const collectionOverride = config.collections?.[collectionName];
    const collectionAuth = collectionOverride?.auth;

    // auth: false disables auth for this collection entirely
    // otherwise use collection-level auth if set, fall back to global
    const effectiveAuth =
      collectionAuth === false
        ? null // bypass
        : collectionAuth ?? config.auth ?? null;

    await fastify.register(
      async (collectionPlugin: FastifyInstance) => {
        // Apply auth hook if required
        if (effectiveAuth) {
          collectionPlugin.addHook('onRequest', createAuthHook(effectiveAuth));
        }

        registerCrudRoutes(collectionPlugin, db, collectionName, slug, config, readOnly);
      },
      { prefix: `/${slug}` }  // Fastify already carries the root prefix — just add the slug
    );
  }
}
