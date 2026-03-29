export { generateOpenApiSpec } from './spec-generator.js';
export type {
  OpenApiSpec,
  OpenApiInfo,
  OpenApiServer,
  GenerateOpenApiSpecOptions,
} from './spec-generator.js';

export {
  inferCollectionSchema,
  inferType,
  mergeDocument,
  buildSchemaObject,
  buildPropertySchema,
  SAMPLE_LIMIT,
} from './inference.js';
export type { InferredSchema, InferredField, JsonSchemaType } from './inference.js';

export { registerOpenApiRoutes } from './swagger.js';
export type { RegisterOpenApiRoutesOptions } from './swagger.js';
