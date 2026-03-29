import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';

// 18 Pokémon types with colors, emoji icons, and effectiveness data
const TYPES = [
  {
    name: 'normal', label: 'Normal', color: '#A8A77A', icon: '⬜',
    strongAgainst: [], weakAgainst: ['rock', 'steel'], immune: ['ghost'],
  },
  {
    name: 'fire', label: 'Fire', color: '#EE8130', icon: '🔥',
    strongAgainst: ['grass', 'ice', 'bug', 'steel'],
    weakAgainst: ['fire', 'water', 'rock', 'dragon'],
    immune: [],
  },
  {
    name: 'water', label: 'Water', color: '#6390F0', icon: '💧',
    strongAgainst: ['fire', 'ground', 'rock'],
    weakAgainst: ['water', 'grass', 'dragon'],
    immune: [],
  },
  {
    name: 'electric', label: 'Electric', color: '#F7D02C', icon: '⚡',
    strongAgainst: ['water', 'flying'],
    weakAgainst: ['electric', 'grass', 'dragon'],
    immune: ['ground'],
  },
  {
    name: 'grass', label: 'Grass', color: '#7AC74C', icon: '🌿',
    strongAgainst: ['water', 'ground', 'rock'],
    weakAgainst: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'],
    immune: [],
  },
  {
    name: 'ice', label: 'Ice', color: '#96D9D6', icon: '❄️',
    strongAgainst: ['grass', 'ground', 'flying', 'dragon'],
    weakAgainst: ['steel', 'fire', 'water', 'ice'],
    immune: [],
  },
  {
    name: 'fighting', label: 'Fighting', color: '#C22E28', icon: '🥊',
    strongAgainst: ['normal', 'ice', 'rock', 'dark', 'steel'],
    weakAgainst: ['poison', 'flying', 'psychic', 'bug', 'fairy'],
    immune: ['ghost'],
  },
  {
    name: 'poison', label: 'Poison', color: '#A33EA1', icon: '☠️',
    strongAgainst: ['grass', 'fairy'],
    weakAgainst: ['poison', 'ground', 'rock', 'ghost'],
    immune: ['steel'],
  },
  {
    name: 'ground', label: 'Ground', color: '#E2BF65', icon: '🌍',
    strongAgainst: ['fire', 'electric', 'poison', 'rock', 'steel'],
    weakAgainst: ['grass', 'bug'],
    immune: ['flying'],
  },
  {
    name: 'flying', label: 'Flying', color: '#A98FF3', icon: '🦅',
    strongAgainst: ['grass', 'fighting', 'bug'],
    weakAgainst: ['electric', 'rock', 'steel'],
    immune: [],
  },
  {
    name: 'psychic', label: 'Psychic', color: '#F95587', icon: '🔮',
    strongAgainst: ['fighting', 'poison'],
    weakAgainst: ['psychic', 'steel'],
    immune: ['dark'],
  },
  {
    name: 'bug', label: 'Bug', color: '#A6B91A', icon: '🐛',
    strongAgainst: ['grass', 'psychic', 'dark'],
    weakAgainst: ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy'],
    immune: [],
  },
  {
    name: 'rock', label: 'Rock', color: '#B6A136', icon: '🪨',
    strongAgainst: ['fire', 'ice', 'flying', 'bug'],
    weakAgainst: ['fighting', 'ground', 'steel'],
    immune: [],
  },
  {
    name: 'ghost', label: 'Ghost', color: '#735797', icon: '👻',
    strongAgainst: ['psychic', 'ghost'],
    weakAgainst: ['dark'],
    immune: ['normal', 'fighting'],
  },
  {
    name: 'dragon', label: 'Dragon', color: '#6F35FC', icon: '🐉',
    strongAgainst: ['dragon'],
    weakAgainst: ['steel'],
    immune: ['fairy'],
  },
  {
    name: 'dark', label: 'Dark', color: '#705746', icon: '🌑',
    strongAgainst: ['psychic', 'ghost'],
    weakAgainst: ['fighting', 'dark', 'fairy'],
    immune: [],
  },
  {
    name: 'steel', label: 'Steel', color: '#B7B7CE', icon: '⚙️',
    strongAgainst: ['ice', 'rock', 'fairy'],
    weakAgainst: ['steel', 'fire', 'water', 'electric'],
    immune: ['poison'],
  },
  {
    name: 'fairy', label: 'Fairy', color: '#D685AD', icon: '✨',
    strongAgainst: ['fighting', 'dragon', 'dark'],
    weakAgainst: ['fire', 'poison', 'steel'],
    immune: ['dragon'],
  },
];

export async function seedDatabase(mongoUri) {
  const pokemon = JSON.parse(
    readFileSync(new URL('./data/pokemon.json', import.meta.url).pathname, 'utf-8')
  );

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db();

  // Drop existing collections
  for (const col of ['pokemon', 'types', 'battles', 'teams']) {
    await db.collection(col).drop().catch(() => {});
  }

  // Insert Pokémon
  await db.collection('pokemon').insertMany(pokemon);
  
  // Add indexes for common queries
  await db.collection('pokemon').createIndex({ pokedexId: 1 }, { unique: true });
  await db.collection('pokemon').createIndex({ name: 1 });
  await db.collection('pokemon').createIndex({ primaryType: 1 });
  await db.collection('pokemon').createIndex({ generation: 1 });
  await db.collection('pokemon').createIndex({ statTotal: -1 });

  // Insert types
  await db.collection('types').insertMany(TYPES);
  await db.collection('types').createIndex({ name: 1 }, { unique: true });

  // Create empty collections for battles and teams
  await db.createCollection('battles');
  await db.createCollection('teams');

  console.log(`✅ Seeded: ${pokemon.length} Pokémon, ${TYPES.length} types`);
  console.log(`   Collections: pokemon, types, battles, teams`);

  await client.close();
  return { pokemonCount: pokemon.length, typeCount: TYPES.length };
}
