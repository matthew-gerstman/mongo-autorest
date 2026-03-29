import { type FastifyInstance } from 'fastify';
import { type Db } from 'mongodb';
import { type AutoRestConfig } from '../config/index.js';
import { type CollectionInfo } from '../introspection/index.js';
import { generateOpenApiSpec, type OpenApiSpec } from './spec-generator.js';

export interface RegisterOpenApiRoutesOptions {
  db: Db;
  config: AutoRestConfig;
  collections: CollectionInfo[];
  prefix?: string;
}

/**
 * Register the /openapi.json endpoint and, when appropriate, the Swagger UI
 * at /docs on a Fastify instance.
 *
 * Behaviour:
 * - `/openapi.json` is always registered unless `config.serveOpenApi === false`.
 * - Swagger UI (`/docs`) is registered:
 *     - In non-production environments (NODE_ENV !== 'production') by default.
 *     - In production when `config.swaggerUi === true` explicitly opts in.
 *     - Never when `config.swaggerUi === false` explicitly opts out.
 */
export async function registerOpenApiRoutes(
  fastify: FastifyInstance,
  options: RegisterOpenApiRoutesOptions
): Promise<void> {
  const { db, config, collections, prefix = '/api' } = options;

  // ── /openapi.json ─────────────────────────────────────────────────────────
  if (config.serveOpenApi === false) {
    // Disabled — skip both /openapi.json and Swagger UI
    return;
  }

  // Cache the spec Promise — not the result — so concurrent requests during
  // the first generation don't trigger multiple DB sampling passes.
  let specPromise: Promise<OpenApiSpec> | null = null;

  fastify.get('/openapi.json', async (_req, reply) => {
    if (!specPromise) {
      specPromise = generateOpenApiSpec({
        db,
        config,
        collections,
        prefix,
      }).catch((err: unknown) => {
        // Reset on failure so the next request retries
        specPromise = null;
        throw err;
      });
    }
    const spec = await specPromise;
    return reply.code(200).type('application/json').send(spec);
  });

  // ── Swagger UI (/docs) ────────────────────────────────────────────────────
  const isProduction = process.env['NODE_ENV'] === 'production';
  const swaggerUiExplicitOpt = config.swaggerUi;

  const shouldServeSwaggerUi =
    swaggerUiExplicitOpt === false
      ? false // always off if explicitly disabled
      : swaggerUiExplicitOpt === true
      ? true // always on if explicitly enabled
      : !isProduction; // default: on in dev/test, off in production

  if (!shouldServeSwaggerUi) {
    return;
  }

  // Register @fastify/swagger to attach spec metadata, then @fastify/swagger-ui
  // for the actual UI. We pass our own specUrl so the UI fetches /openapi.json
  // directly instead of generating its own spec.
  try {
    // Dynamic imports so that the package is only required when Swagger UI
    // is actually enabled — avoids side effects in production.
    const fastifySwagger = (await import('@fastify/swagger')).default;
    const fastifySwaggerUi = (await import('@fastify/swagger-ui')).default;

    await fastify.register(fastifySwagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'mongo-autorest API',
          version: '1.0.0',
        },
      },
    });

    await fastify.register(fastifySwaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        url: '/openapi.json',
        deepLinking: true,
      },
    });
  } catch (err) {
    // Log but don't crash — Swagger UI is non-critical
    fastify.log.warn(
      { err },
      '[mongo-autorest] Failed to register Swagger UI — continuing without it'
    );
  }
}
