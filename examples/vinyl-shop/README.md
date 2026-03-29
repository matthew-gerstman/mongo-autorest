# Gerstman's Records 🎵

A retro vinyl record shop demo powered by [mongo-autorest](../../README.md). Seeded with a real 248-record Discogs collection.

## What This Demonstrates

Every `mongo-autorest` feature is visible in this demo:

| Feature | How It's Used |
|---------|--------------|
| **Zero-config API** | 248 records → full CRUD API from one config object |
| **Collection aliasing** | `records` collection served as `/api/vinyl` |
| **Read-only mode** | Vinyl catalog is read-only; sales/wishlist are writable |
| **API key auth** | Write operations require `x-api-key` header |
| **Per-collection auth bypass** | Vinyl + artists are public (no key needed to browse) |
| **Filtering** | Filter by genre, decade, artist via query params |
| **Pagination** | 24 records per page with page/pageSize/total/totalPages |
| **Sorting** | Sort by artist, year, title, date added |
| **OpenAPI / Swagger UI** | Auto-generated at `/docs` with schemas from real data |
| **Webhooks + SSE** | "Buy" a record → webhook fires → live ticker updates |

## Quick Start

```bash
cd examples/vinyl-shop
npm install
npm start
```

Open http://localhost:3000 — the app seeds MongoDB automatically on startup.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/vinyl` | No | Browse vinyl catalog (paginated) |
| GET | `/api/vinyl/:id` | No | Record detail |
| GET | `/api/artists` | No | Browse artists |
| GET | `/api/artists/:id` | No | Artist detail |
| POST | `/api/sales` | Yes | Record a purchase |
| GET | `/api/sales` | Yes | Purchase history |
| POST | `/api/wishlist` | Yes | Add to wishlist |
| GET | `/api/wishlist` | Yes | View wishlist |
| GET | `/docs` | No | Swagger UI |
| GET | `/api/openapi.json` | No | OpenAPI spec |

**API Key:** `gerstmans-demo-key-2024` (pass in `x-api-key` header)

## The Backend

The entire backend is **one config object**:

```js
await app.register(autoRest, {
  mongoUri,
  prefix: '/api',
  config: {
    auth: { type: 'api-key', header: 'x-api-key', keys: ['gerstmans-demo-key-2024'] },
    defaultPageSize: 24,
    collections: {
      records: { readOnly: true, alias: 'vinyl', auth: false },
      artists: { readOnly: true, auth: false },
      sales: { readOnly: false },
      wishlist: { readOnly: false },
    },
    webhooks: [{ url: 'http://localhost:3000/hooks/sale', events: ['document.created'], secret: '...', collections: ['sales'] }],
    serveOpenApi: true,
    swaggerUi: true,
  },
});
```

No custom routes. No controllers. No models. Just data.
