import { type Db } from 'mongodb';
import { type AutoRestConfig } from '../config/index.js';
import { type CollectionInfo } from '../introspection/index.js';
import {
  inferCollectionSchema,
  buildSchemaObject,
} from './inference.js';

// ─── OpenAPI 3.1 type definitions (minimal, sufficient for our output) ─────────

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

export interface OpenApiSecurityScheme {
  type: 'apiKey';
  in: 'header';
  name: string;
  description?: string;
}

export interface OpenApiSchema {
  [key: string]: unknown;
}

export interface OpenApiMediaType {
  schema: OpenApiSchema;
}

export interface OpenApiRequestBody {
  required: boolean;
  content: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiParameter {
  name: string;
  in: 'query' | 'path' | 'header';
  required?: boolean;
  schema: OpenApiSchema;
  description?: string;
}

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  tags: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
}

export interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
}

export interface OpenApiSpec {
  openapi: '3.1.0';
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  paths: Record<string, OpenApiPathItem>;
  components: {
    schemas: Record<string, OpenApiSchema>;
    securitySchemes?: Record<string, OpenApiSecurityScheme>;
  };
  security?: Array<Record<string, string[]>>;
  'x-schema-inference': 'sampled';
}

// ─── Pagination parameters ────────────────────────────────────────────────────

const PAGINATION_PARAMS: OpenApiParameter[] = [
  {
    name: 'page',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: 'Page number (1-indexed)',
  },
  {
    name: 'pageSize',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 1000 },
    description: 'Number of documents per page',
  },
  {
    name: 'sort',
    in: 'query',
    required: false,
    schema: { type: 'string' },
    description: 'Field to sort by. Prefix with - for descending (e.g. -createdAt)',
  },
  {
    name: 'filter',
    in: 'query',
    required: false,
    schema: { type: 'string' },
    description: 'JSON-encoded MongoDB filter object',
  },
];

// ─── Path-level helpers ───────────────────────────────────────────────────────

function paginationEnvelope(itemSchemaRef: string): OpenApiSchema {
  return {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: itemSchemaRef },
      },
      pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
        required: ['page', 'pageSize', 'total', 'totalPages'],
      },
    },
    required: ['data', 'pagination'],
  };
}

function buildCollectionPaths(
  slug: string,
  schemaName: string,
  readOnly: boolean,
  hasAuth: boolean
): OpenApiPathItem[] {
  const securityRef = hasAuth ? [{ ApiKeyAuth: [] }] : undefined;
  const schemaRef = `#/components/schemas/${schemaName}`;
  const tag = schemaName;

  // ── Collection-level path (/prefix/slug) ───────────────────────────────────
  const collectionPath: OpenApiPathItem = {
    get: {
      operationId: `list${schemaName}`,
      summary: `List ${slug}`,
      tags: [tag],
      parameters: PAGINATION_PARAMS,
      responses: {
        '200': {
          description: `Paginated list of ${slug}`,
          content: {
            'application/json': {
              schema: paginationEnvelope(schemaRef),
            },
          },
        },
        ...(hasAuth
          ? {
              '401': { description: 'Authentication required' },
              '403': { description: 'Forbidden' },
            }
          : {}),
      },
      ...(securityRef ? { security: securityRef } : {}),
    },
  };

  if (!readOnly) {
    collectionPath.post = {
      operationId: `create${schemaName}`,
      summary: `Create a ${slug} document`,
      tags: [tag],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: schemaRef } },
        },
      },
      responses: {
        '201': {
          description: 'Created',
          content: {
            'application/json': { schema: { $ref: schemaRef } },
          },
        },
        ...(hasAuth
          ? {
              '401': { description: 'Authentication required' },
              '403': { description: 'Forbidden' },
            }
          : {}),
      },
      ...(securityRef ? { security: securityRef } : {}),
    };
  }

  // ── Document-level path (/prefix/slug/:id) ────────────────────────────────
  const idParam: OpenApiParameter = {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description: 'Document _id (ObjectId or string)',
  };

  const documentPath: OpenApiPathItem = {
    get: {
      operationId: `get${schemaName}`,
      summary: `Get a ${slug} document by id`,
      tags: [tag],
      parameters: [idParam],
      responses: {
        '200': {
          description: 'Document found',
          content: {
            'application/json': { schema: { $ref: schemaRef } },
          },
        },
        '404': { description: 'Not found' },
        ...(hasAuth
          ? {
              '401': { description: 'Authentication required' },
              '403': { description: 'Forbidden' },
            }
          : {}),
      },
      ...(securityRef ? { security: securityRef } : {}),
    },
  };

  if (!readOnly) {
    documentPath.put = {
      operationId: `replace${schemaName}`,
      summary: `Replace a ${slug} document`,
      tags: [tag],
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: schemaRef } },
        },
      },
      responses: {
        '200': {
          description: 'Replaced',
          content: {
            'application/json': { schema: { $ref: schemaRef } },
          },
        },
        '404': { description: 'Not found' },
        ...(hasAuth
          ? {
              '401': { description: 'Authentication required' },
              '403': { description: 'Forbidden' },
            }
          : {}),
      },
      ...(securityRef ? { security: securityRef } : {}),
    };

    documentPath.patch = {
      operationId: `update${schemaName}`,
      summary: `Partially update a ${slug} document`,
      tags: [tag],
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: schemaRef } },
        },
      },
      responses: {
        '200': {
          description: 'Updated',
          content: {
            'application/json': { schema: { $ref: schemaRef } },
          },
        },
        '404': { description: 'Not found' },
        ...(hasAuth
          ? {
              '401': { description: 'Authentication required' },
              '403': { description: 'Forbidden' },
            }
          : {}),
      },
      ...(securityRef ? { security: securityRef } : {}),
    };

    documentPath.delete = {
      operationId: `delete${schemaName}`,
      summary: `Delete a ${slug} document`,
      tags: [tag],
      parameters: [idParam],
      responses: {
        '204': { description: 'Deleted' },
        '404': { description: 'Not found' },
        ...(hasAuth
          ? {
              '401': { description: 'Authentication required' },
              '403': { description: 'Forbidden' },
            }
          : {}),
      },
      ...(securityRef ? { security: securityRef } : {}),
    };
  }

  return [collectionPath, documentPath];
}

// ─── Schema name helper ───────────────────────────────────────────────────────

/**
 * Convert a slug like "my-orders" to a PascalCase schema name "MyOrders".
 */
function slugToSchemaName(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface GenerateOpenApiSpecOptions {
  /** MongoDB db instance (for schema sampling) */
  db: Db;
  /** Validated plugin config */
  config: AutoRestConfig;
  /** Collections surviving introspection + exclusion */
  collections: CollectionInfo[];
  /** Route prefix, e.g. '/api' */
  prefix?: string;
  /** API info block */
  info?: Partial<OpenApiInfo>;
  /** Servers block */
  servers?: OpenApiServer[];
}

/**
 * Generate a valid OpenAPI 3.1 spec object by sampling documents from each
 * collection and inferring JSON Schema shapes.
 *
 * The returned object passes @apidevtools/swagger-parser validation.
 */
export async function generateOpenApiSpec(
  options: GenerateOpenApiSpecOptions
): Promise<OpenApiSpec> {
  const {
    db,
    config,
    collections,
    prefix = '/api',
    info = {},
    servers,
  } = options;

  const paths: Record<string, OpenApiPathItem> = {};
  const schemas: Record<string, OpenApiSchema> = {};
  const securitySchemes: Record<string, OpenApiSecurityScheme> = {};

  // Global auth → apiKey security scheme
  const hasGlobalAuth = Boolean(config.auth);
  if (hasGlobalAuth && config.auth) {
    securitySchemes.ApiKeyAuth = {
      type: 'apiKey',
      in: 'header',
      name: config.auth.header ?? 'x-api-key',
      description: 'API key authentication',
    };
  }

  for (const collection of collections) {
    const { name: collectionName, slug } = collection;

    // Infer schema from sampled documents
    const inferred = await inferCollectionSchema(db, collectionName);
    const schemaObj = buildSchemaObject(inferred);
    const schemaName = slugToSchemaName(slug);

    schemas[schemaName] = schemaObj;

    // Determine per-collection read-only and auth
    const collectionOverride = config.collections?.[collectionName];
    const collectionReadOnly =
      collectionOverride?.readOnly !== undefined
        ? collectionOverride.readOnly
        : config.readOnly === true;

    // auth: false → no auth on this collection
    const collectionAuth = collectionOverride?.auth;
    const effectiveAuth =
      collectionAuth === false
        ? false
        : collectionAuth ?? config.auth;

    const collectionHasAuth = Boolean(effectiveAuth);

    // Register security scheme for collection-level auth (if different header)
    if (collectionHasAuth && effectiveAuth && effectiveAuth !== true && typeof effectiveAuth === 'object' && !hasGlobalAuth) {
      securitySchemes.ApiKeyAuth = {
        type: 'apiKey',
        in: 'header',
        name: (effectiveAuth as { header?: string }).header ?? 'x-api-key',
        description: 'API key authentication',
      };
    }

    const [collectionPathItem, documentPathItem] = buildCollectionPaths(
      slug,
      schemaName,
      collectionReadOnly,
      collectionHasAuth
    );

    const basePath = `${prefix}/${slug}`;
    paths[basePath] = collectionPathItem;
    paths[`${basePath}/{id}`] = documentPathItem;
  }

  const resolvedInfo: OpenApiInfo = {
    title: info.title ?? 'mongo-autorest API',
    version: info.version ?? '1.0.0',
    ...(info.description ? { description: info.description } : {}),
  };

  const spec: OpenApiSpec = {
    openapi: '3.1.0',
    'x-schema-inference': 'sampled',
    info: resolvedInfo,
    ...(servers && servers.length > 0 ? { servers } : {}),
    paths,
    components: {
      schemas,
      ...(Object.keys(securitySchemes).length > 0 ? { securitySchemes } : {}),
    },
  };

  // Apply global security if auth is configured
  if (hasGlobalAuth) {
    spec.security = [{ ApiKeyAuth: [] }];
  }

  return spec;
}
