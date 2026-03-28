# mongo-autorest

Auto-generate RESTful APIs from MongoDB collections via Fastify.

> ⚠️ **Work in progress.** This package is under active development.

## Overview

`mongo-autorest` connects to a MongoDB database, introspects its collections, and exposes a fully RESTful HTTP API — automatically. Every collection becomes a resource. No schema files required.

## Installation

```bash
npm install mongo-autorest
```

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

## Config Reference

See [src/config/schema.ts](./src/config/schema.ts) for the full `AutoRestConfig` interface with JSDoc annotations.

| Field | Type | Default | Description |
|---|---|---|---|
| `readOnly` | `boolean` | `false` | Expose only GET endpoints globally |
| `auth` | `AuthConfig` | — | Global API key authentication |
| `auth.type` | `'api-key'` | — | Auth scheme (only api-key supported) |
| `auth.header` | `string` | `'x-api-key'` | Header to read the key from |
| `auth.keys` | `string[]` | — | Valid API keys (min 1 required) |
| `collections` | `Record<string, CollectionOverride>` | — | Per-collection overrides |
| `introspectionInterval` | `number` | disabled | Re-introspect every N ms |
| `defaultPageSize` | `number` | `100` | Max documents per list response |

## Requirements

- Node.js 18+
- MongoDB 5.0+

## License

MIT
