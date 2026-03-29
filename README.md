# mongo-autorest

Auto-generate RESTful APIs from MongoDB collections via Fastify. Every collection becomes a resource. No schema files required.

[![npm](https://img.shields.io/npm/v/mongo-autorest)](https://www.npmjs.com/package/mongo-autorest)
[![Node.js](https://img.shields.io/node/v/mongo-autorest)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Full Config Reference](#full-config-reference)
- [CRUD Endpoints Reference](#crud-endpoints-reference)
- [Filtering & Pagination](#filtering--pagination)
- [OpenAPI / Swagger](#openapi--swagger)
- [Webhook Setup](#webhook-setup)
- [TypeScript Types](#typescript-types)
- [Error Reference](#error-reference)
- [Requirements](#requirements)

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

## Installation

```bash
npm install mongo-autorest
```

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

## Quick Start

```ts
import Fastify from 'fastify';
import { autoRest } from 'mongo-autorest';

const app = Fastify();

await app.register(autoRest, {
  mongoUri: process.env.MONGO_URI,
  prefix: '/api',
  config: {
    readOnly: false,
    collections: {
      users: { exclude: false, alias: 'members' },
      internal_logs: { exclude: true },
    },
  },
});

await app.listen({ port: 3000 });
```

That's it. Routes are mounted and ready to serve. For a database with `orders` and `products` collections the above registers:

```
GET    /api/orders
POST   /api/orders
GET    /api/orders/:id
PUT    /api/orders/:id
PATCH  /api/orders/:id
DELETE /api/orders/:id

GET    /api/products
POST   /api/products
...
```

Collections prefixed with `system.` are excluded automatically.

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

## Full Config Reference

All options are optional. The library works with zero config — all collections exposed, full CRUD, no auth.

```ts
interface AutoRestConfig {
  readOnly?: boolean;
  auth?: AuthConfig;
  collections?: Record<string, CollectionOverride>;
  introspectionInterval?: number;
  defaultPageSize?: number;
  useFastCount?: boolean;
  serveOpenApi?: boolean;
  swaggerUi?: boolean;
  webhooks?: WebhookConfig[];
}
```

### Top-Level Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `readOnly` | `boolean` | `false` | When `true`, only `GET` endpoints are mounted globally. Per-collection `readOnly` overrides this. |
| `auth` | `AuthConfig` | — | Global API key authentication applied to all routes. |
| `collections` | `Record<string, CollectionOverride>` | — | Per-collection overrides. Keys are **MongoDB collection names** (not aliases). |
| `introspectionInterval` | `number` | disabled | Re-introspect the database every N milliseconds to pick up new collections without restart. |
| `defaultPageSize` | `number` (1–1000) | `100` | Default number of documents returned per list request. |
| `useFastCount` | `boolean` | `false` | Use `estimatedDocumentCount()` instead of `countDocuments()` for very large collections. Adds `totalEstimated: true` to the pagination envelope. |
| `serveOpenApi` | `boolean` | `true` | Set to `false` to disable the `/openapi.json` endpoint and Swagger UI entirely. |
| `swaggerUi` | `boolean` | auto | `true` forces Swagger UI on in all environments. `false` forces it off. Default: on in development, off in production. |
| `webhooks` | `WebhookConfig[]` | — | Outbound HTTP webhook endpoints for document mutation events. |

### `AuthConfig`

```ts
interface AuthConfig {
  type: 'api-key';
  header?: string;   // default: 'x-api-key'
  keys: string[];    // at least one required
}
```

```ts
await app.register(autoRest, {
  mongoUri: process.env.MONGO_URI,
  config: {
    auth: {
      type: 'api-key',
      header: 'x-api-key',
      keys: [process.env.API_KEY],
    },
  },
});
```

Keys are compared using `crypto.timingSafeEqual` to prevent timing attacks.

### `CollectionOverride`

Per-collection settings. The key in the `collections` map is the **MongoDB collection name**, not the alias.

```ts
interface CollectionOverride {
  exclude?: boolean;             // Remove this collection from all routes
  alias?: string;                // Use this as the URL segment (e.g. 'members' → /api/members)
  readOnly?: boolean;            // Override global readOnly for this collection
  auth?: AuthConfig | false;     // false = disable auth for this collection only
  fields?: {
    include?: string[];          // Whitelist — only these fields are returned
    exclude?: string[];          // Blacklist — these fields are stripped from responses
  };
}
```

```ts
config: {
  auth: { type: 'api-key', keys: ['global-key'] },
  collections: {
    // Rename the collection's URL segment
    users: { alias: 'members' },

    // Hide this collection entirely
    internal_logs: { exclude: true },

    // Make orders read-only even though global is read-write
    orders: { readOnly: true },

    // Public endpoint — no auth required despite global auth
    products: { auth: false },

    // Return only selected fields
    invoices: { fields: { include: ['_id', 'amount', 'status'] } },
  },
}
```

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

## CRUD Endpoints Reference

For a collection `orders` mounted at prefix `/api`:

### List — `GET /api/orders`

Returns a paginated array of documents.

**Response:**
```json
{
  "data": [
    { "_id": "64b1f...", "product": "widget", "qty": 5 },
    { "_id": "64b1f...", "product": "gadget", "qty": 2 }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 847,
    "totalPages": 43
  }
}
```

Query parameters: `page`, `pageSize`, `sort`, `filter` — see [Filtering & Pagination](#filtering--pagination).

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

### Get One — `GET /api/orders/:id`

Returns a single document. `:id` is the document's `_id` — accepts both ObjectId strings and plain strings.

**Success (200):**
```json
{ "_id": "64b1f...", "product": "widget", "qty": 5 }
```

**Not found (404):**
```json
{ "error": "Not found", "id": "64b1f..." }
```

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

### Create — `POST /api/orders`

Inserts a new document. Returns the inserted document with `_id` populated.

**Request body:**
```json
{ "product": "widget", "qty": 5 }
```

**Success (201):**
```json
{ "_id": "64b1f...", "product": "widget", "qty": 5 }
```

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

### Replace — `PUT /api/orders/:id`

Replaces the entire document. Returns the updated document. Does **not** upsert — returns `404` if the document does not exist.

**Request body:**
```json
{ "product": "widget", "qty": 10, "status": "shipped" }
```

**Success (200):**
```json
{ "_id": "64b1f...", "product": "widget", "qty": 10, "status": "shipped" }
```

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

### Update — `PATCH /api/orders/:id`

Applies a partial update using `$set`. Returns the updated document.

**Request body:**
```json
{ "status": "shipped" }
```

**Success (200):**
```json
{ "_id": "64b1f...", "product": "widget", "qty": 5, "status": "shipped" }
```

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

### Delete — `DELETE /api/orders/:id`

Deletes a document. Returns `204` with no body on success.

**Success:** `204 No Content`

**Not found (404):**
```json
{ "error": "Not found", "id": "64b1f..." }
```

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

### Read-Only Mode

When `readOnly: true` is active (globally or per-collection), write routes (`POST`, `PUT`, `PATCH`, `DELETE`) return:

```
HTTP 405 Method Not Allowed
{ "error": "This resource is read-only" }
```

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

## Filtering & Pagination

### Pagination Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer ≥ 1 | `1` | Page number |
| `pageSize` | integer 1–1000 | `defaultPageSize` (100) | Documents per page |
| `sort` | string | — | Field name to sort by. Prefix `-` for descending. |
| `filter` | JSON string | — | URL-encoded MongoDB filter object |

**Examples:**

```bash
# Page 2, 10 per page, sorted by createdAt descending
GET /api/orders?page=2&pageSize=10&sort=-createdAt

# Filter by status
GET /api/orders?filter=%7B%22status%22%3A%22shipped%22%7D

# Filter with operators
GET /api/orders?filter=%7B%22qty%22%3A%7B%22%24gte%22%3A5%7D%7D
```

### Flat Parameter Shortcuts

For simple field equality, pass query params directly — no JSON encoding needed:

```bash
# Equivalent to filter={"status":"shipped","region":"us-east"}
GET /api/orders?status=shipped&region=us-east
```

Flat params are merged with an explicit `filter` param when both are present. The `filter` object takes precedence on key conflicts.

### Operator Allowlist

Only the following MongoDB operators are permitted in filter objects. Any other operator returns `400 Bad Request`:

| Category | Operators |
|---|---|
| Comparison | `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin` |
| Logical | `$and`, `$or`, `$not` |
| Element | `$exists` |
| Evaluation | `$regex`, `$text` |

**Disallowed operator example:**
```bash
GET /api/orders?filter={"$where":"..."}
# → 400 { "error": "Operator not allowed", "operator": "$where" }
```

### Fast Count (Large Collections)

For collections over 1 million documents, enable fast count to skip the expensive `countDocuments()` call:

```ts
config: {
  useFastCount: true,
}
```

The response will include `totalEstimated: true` instead of an exact `total`:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 100,
    "total": 1450000,
    "totalPages": 14500,
    "totalEstimated": true
  }
}
```

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

## OpenAPI / Swagger

### `/openapi.json`

The library automatically mounts a `/openapi.json` route that returns a valid OpenAPI 3.1 spec. Schema shapes are inferred by sampling up to 20 documents per collection.

The spec includes a top-level `"x-schema-inference": "sampled"` extension signaling that schemas are derived, not authoritative.

Disable it with:
```ts
config: { serveOpenApi: false }
```

### Swagger UI

Swagger UI is mounted at `/docs` automatically in non-production environments (`NODE_ENV !== 'production'`).

Control this explicitly:
```ts
// Always show Swagger UI, even in production
config: { swaggerUi: true }

// Never show Swagger UI
config: { swaggerUi: false }
```

### Programmatic Spec Generation

Generate the spec programmatically (e.g., to serve via your own route or write to disk):

```ts
import { generateOpenApiSpec } from 'mongo-autorest';

const spec = await generateOpenApiSpec({
  db,           // MongoDB Db instance
  config,       // same AutoRestConfig you passed to autoRest
  collections,  // CollectionInfo[] from introspectDatabase()
  prefix: '/api',
  info: {
    title: 'My API',
    version: '1.0.0',
    description: 'Auto-generated from MongoDB',
  },
  servers: [{ url: 'https://api.example.com' }],
});

// spec is a plain object — serialize however you like
console.log(JSON.stringify(spec, null, 2));
```

To get `collections` for the standalone generator:

```ts
import { introspectDatabase } from 'mongo-autorest';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
const db = client.db();

const { collections } = await introspectDatabase(db, config);
```

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

## Webhook Setup

### EventEmitter API

Subscribe to document mutation events in-process:

```ts
import Fastify from 'fastify';
import { autoRest } from 'mongo-autorest';

const app = Fastify();

await app.register(autoRest, {
  mongoUri: process.env.MONGO_URI,
  prefix: '/api',
});

// Access the typed emitter via the Fastify decorator
app.autoRestEmitter.on('document.created', ({ collection, document }) => {
  console.log(`New document in ${collection}:`, document);
});

app.autoRestEmitter.on('document.updated', ({ collection, id, changes }) => {
  console.log(`Updated ${id} in ${collection}:`, changes);
});

app.autoRestEmitter.on('document.deleted', ({ collection, id }) => {
  console.log(`Deleted ${id} from ${collection}`);
});

await app.listen({ port: 3000 });
```

Events only fire after successful DB operations. Failed operations do not emit.

### Outbound Webhooks

Register HTTP endpoints to receive events automatically:

```ts
await app.register(autoRest, {
  mongoUri: process.env.MONGO_URI,
  config: {
    webhooks: [
      {
        url: 'https://my-service.com/hooks/mongo',
        events: ['document.created', 'document.deleted'],
        secret: process.env.WEBHOOK_SECRET,
        collections: ['orders'],   // omit to receive events for all collections
      },
    ],
  },
});
```

### Webhook Payload Format

```json
{
  "event": "document.created",
  "collection": "orders",
  "timestamp": "2026-03-28T12:00:00Z",
  "data": { "_id": "64b1f...", "product": "widget", "qty": 5 }
}
```

### HMAC Signature Verification

When `secret` is configured, each request includes an `x-autorest-signature` header:

```
x-autorest-signature: sha256=<hex-digest>
```

Verify it in your receiver:

```ts
import { createHmac } from 'node:crypto';

function verifyWebhook(rawBody: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return signature === expected;
}
```

Delivery is fire-and-forget with one automatic retry after 5 seconds on non-2xx responses. Failures are logged to `console.error` with the collection, event type, and HTTP status.

### `WebhookConfig`

```ts
interface WebhookConfig {
  url: string;                                                // Must be a valid URL
  events: ('document.created' | 'document.updated' | 'document.deleted')[];
  secret?: string;                                           // For HMAC signing
  collections?: string[];                                    // Filter to these collections only
}
```

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

## TypeScript Types

All public types are exported from the package root:

```ts
import type {
  // Config types
  AutoRestConfig,
  AuthConfig,
  CollectionOverride,
  WebhookConfig,

  // Plugin types
  AutoRestOptions,

  // Introspection types
  CollectionInfo,
  IntrospectionResult,
  IntrospectionChangeHandler,

  // Event payload types
  DocumentCreatedPayload,
  DocumentUpdatedPayload,
  DocumentDeletedPayload,
  AutoRestEventMap,
  EventType,
  WebhookPayload,

  // OpenAPI types
  OpenApiSpec,
  OpenApiInfo,
  OpenApiServer,
  GenerateOpenApiSpecOptions,
  InferredSchema,
  InferredField,
  JsonSchemaType,
} from 'mongo-autorest';
```

The `autoRest` plugin extends Fastify's type system so `fastify.autoRestEmitter` is fully typed:

```ts
// Typed — no casting needed
app.autoRestEmitter.on('document.created', ({ collection, document }) => {
  //                                          ^ string       ^ Record<string, unknown>
});
```

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

## Error Reference

All errors return JSON. HTML error pages are never produced.

| Scenario | Status | Response Body |
|---|---|---|
| Document not found | `404` | `{ "error": "Not found", "id": "<id>" }` |
| Invalid `_id` format | `400` | `{ "error": "Invalid id format" }` |
| Invalid filter JSON | `400` | `{ "error": "Invalid filter", "detail": "<parse error>" }` |
| Disallowed filter operator | `400` | `{ "error": "Operator not allowed", "operator": "$where" }` |
| Missing auth header | `401` | `{ "error": "Authentication required" }` |
| Invalid API key | `403` | `{ "error": "Forbidden" }` |
| Write to read-only resource | `405` | `{ "error": "This resource is read-only" }` |
| MongoDB connection failure | `503` | `{ "error": "Database unavailable" }` |
| Unhandled internal error | `500` | `{ "error": "Internal server error" }` |

MongoDB errors are never surfaced raw to the caller. All DB errors are caught, logged internally, and mapped to `503` (connection issues) or `500` (unexpected).

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

## Requirements

- **Node.js** ≥ 18
- **MongoDB** 5.0+
- **Fastify** 4.x

---

## Live Demos

| Demo | Description | Links |
|------|-------------|-------|
| 🎵 **Gerstman's Records** | Vinyl record shop with 248 records from a real Discogs collection | [App](https://22x6cm3y0l-3000.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3000.hosted.obvious.ai/docs) · [Source](examples/vinyl-shop/) |
| 🔴 **Pokédex** | 1,025 Pokémon with battle simulator and team builder | [App](https://22x6cm3y0l-3001.hosted.obvious.ai) · [Swagger](https://22x6cm3y0l-3001.hosted.obvious.ai/docs) · [Source](examples/pokedex/) |

> Both demos are powered by a single `autoRest` config — no custom routes, no controllers, no models. Just data.

---

## License

MIT
