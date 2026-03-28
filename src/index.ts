/**
 * mongo-autorest
 *
 * Auto-generate RESTful APIs from MongoDB collections via Fastify.
 */

// Config layer — public API
export {
  validateConfig,
  ConfigValidationError,
  getDefaultPageSize,
  resolveCollectionSlug,
  isCollectionExcluded,
  isCollectionReadOnly,
} from './config/index.js';
export type { AutoRestConfig, AuthConfig, CollectionOverride, WebhookConfig } from './config/index.js';

// Introspection engine — public API
export {
  introspectDatabase,
  diffCollections,
  startIntrospectionInterval,
} from './introspection/index.js';
export type {
  CollectionInfo,
  IntrospectionResult,
  IntrospectionChangeHandler,
} from './introspection/index.js';

// Plugin — public API
export { autoRest } from './plugin.js';
export type { AutoRestOptions } from './plugin.js';

// Placeholder for OpenAPI — implemented in subsequent PR
// export { generateOpenApiSpec } from './openapi/index.js';
