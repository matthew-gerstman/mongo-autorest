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

// Placeholder exports — implemented in subsequent PRs
// export { autoRest } from './routes/index.js';
// export { generateOpenApiSpec } from './openapi/index.js';
