# Pokédex Demo — Powered by mongo-autorest

> A complete Pokédex application with 1,025 Pokémon, a battle simulator, and a team builder — all backed by a single `autoRest` configuration.

![Pokédex Demo](https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png)

## What This Demonstrates

This demo showcases every major feature of `mongo-autorest`:

| Feature | How It's Used |
|---------|--------------|
| **Read-only collections** | `pokemon` and `types` are public, read-only |
| **Collection aliasing** | `pokemon` collection is served at `/api/pokedex` |
| **Full CRUD** | `battles` and `teams` support POST/PUT/DELETE |
| **API key auth** | Writes to `battles` and `teams` require `x-api-key` |
| **Public endpoints** | Pokédex browsing needs no auth |
| **Pagination** | 1,025 Pokémon paginated at 24/page by default |
| **Filtering** | Filter by type, generation, legendary status |
| **Sorting** | Sort by stat total, name, speed, attack, etc. |
| **Webhooks** | Battle creation fires a webhook → SSE live ticker |
| **OpenAPI / Swagger** | Full API docs auto-generated at `/docs` |

## Quick Start

```bash
cd examples/pokedex
npm install
npm start
# → http://localhost:3001
# → http://localhost:3001/docs
```

## The Entire Backend

The whole API is one `autoRest` registration:

```js
await app.register(autoRest, {
  mongoUri,
  prefix: '/api',
  config: {
    auth: {
      type: 'api-key',
      header: 'x-api-key',
      keys: ['pokedex-demo-key'],
    },
    defaultPageSize: 24,
    collections: {
      // 1,025 Pokémon — read-only, aliased to /api/pokedex
      pokemon: { readOnly: true, alias: 'pokedex', auth: false },

      // 18 types with effectiveness data — read-only, public
      types: { readOnly: true, auth: false },

      // Battle log — full CRUD, requires API key to write
      battles: { readOnly: false },

      // Team builder — full CRUD, requires API key to write
      teams: { readOnly: false },
    },
    webhooks: [{
      url: 'http://localhost:3001/hooks/battle',
      events: ['document.created'],
      secret: 'pokedex-webhook-secret',
      collections: ['battles'],
    }],
    serveOpenApi: true,
    swaggerUi: true,
  },
});
```

That's it. No routes, no controllers, no resolvers.

## API Examples

### Browse the Pokédex (no auth)

```bash
# All Pokémon, page 1
curl http://localhost:3001/api/pokedex

# Filter by type
curl "http://localhost:3001/api/pokedex?primaryType=fire"

# Filter by generation
curl "http://localhost:3001/api/pokedex?generation=1"

# Sort by stat total (descending)
curl "http://localhost:3001/api/pokedex?sort=statTotal&sortDir=-1"

# Search by name
curl "http://localhost:3001/api/pokedex?search=pikachu"

# Legendary Pokémon
curl "http://localhost:3001/api/pokedex?isLegendary=true"

# Specific Pokémon
curl "http://localhost:3001/api/pokedex?pokedexId=25"
```

### Type Effectiveness (no auth)

```bash
curl http://localhost:3001/api/types

# Specific type
curl "http://localhost:3001/api/types?name=fire"
```

### Battle Simulator (requires API key)

```bash
# Log a battle result
curl -X POST http://localhost:3001/api/battles \
  -H "x-api-key: pokedex-demo-key" \
  -H "Content-Type: application/json" \
  -d '{
    "winner": "Charizard",
    "winnerId": 6,
    "loser": "Squirtle",
    "loserId": 7,
    "margin": 42,
    "timestamp": "2024-01-01T00:00:00Z"
  }'

# View battle history
curl http://localhost:3001/api/battles \
  -H "x-api-key: pokedex-demo-key"
```

### Team Builder (requires API key)

```bash
# Save a team
curl -X POST http://localhost:3001/api/teams \
  -H "x-api-key: pokedex-demo-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Gen 1 Dream Team",
    "pokemon": [
      { "id": 6, "name": "Charizard", "types": ["fire","flying"] },
      { "id": 9, "name": "Blastoise", "types": ["water"] },
      { "id": 3, "name": "Venusaur", "types": ["grass","poison"] },
      { "id": 143, "name": "Snorlax", "types": ["normal"] },
      { "id": 94, "name": "Gengar", "types": ["ghost","poison"] },
      { "id": 149, "name": "Dragonite", "types": ["dragon","flying"] }
    ],
    "totalBST": 3270
  }'

# List teams
curl http://localhost:3001/api/teams \
  -H "x-api-key: pokedex-demo-key"
```

### Live Battle Feed (SSE)

```bash
# Stream battle events in real-time
curl -N http://localhost:3001/api/live
```

## Frontend Features

- **Browse grid** — 1,025 Pokémon with sprites, types, Pokédex numbers
- **Type filter** — 18 colored type buttons (fire, water, grass, etc.)
- **Generation filter** — Gen I through Gen IX
- **Legendary / Mythical** — Special filters for rare Pokémon
- **Search** — Live search by name
- **Sort** — By Pokédex #, name, stat total, HP, Attack, Speed
- **Detail modal** — Official artwork, full stat bars, abilities, moves
- **Battle simulator** — Select 2 Pokémon → stat-based fight with randomness → POST result
- **Live battle ticker** — SSE-powered, updates in real-time when battles happen
- **Team builder** — Pick up to 6 Pokémon → POST to `/api/teams`
- **Battle log** — Full history from MongoDB via `GET /api/battles`
- **API Docs** — Swagger UI at `/docs`

## Data

- **1,025 Pokémon** (Gens I–IX) via PokéAPI
- Fields: stats, types, abilities, sprites, official artwork, moves, height, weight, generation
- **18 types** with color codes, icons, and effectiveness charts
- Data seeded into MongoDB on startup via `mongodb-memory-server`

## Project Structure

```
examples/pokedex/
├── server.mjs          # Fastify server + autoRest config (the whole backend)
├── seed.mjs            # Seeds MongoDB: 1,025 Pokémon + 18 types
├── package.json
├── data/
│   └── pokemon.json    # 1,025 Pokémon (from PokéAPI)
├── public/
│   └── index.html      # Complete frontend (single file)
└── README.md
```

## Port

This demo runs on **port 3001** (the vinyl shop demo uses 3000).
