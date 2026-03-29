/**
 * Seed utility for integration tests.
 *
 * Provides realistic domain data across three collections:
 *   - orders   (60 docs) — pagination, sorting, filtering
 *   - users    (20 docs) — alias / field-level tests
 *   - products (15 docs) — mixed shape / schema inference
 *
 * Documents are intentionally varied so that:
 *   - Pagination is meaningful (60 orders → 6 pages at pageSize=10)
 *   - Filter queries have matching and non-matching docs
 *   - Sort produces a deterministic, verifiable order
 *   - Schema inference sees mixed shapes (some fields absent)
 */

import { type Db, ObjectId } from 'mongodb';

// ─── Domain data ──────────────────────────────────────────────────────────────

export const STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof STATUSES)[number];

export interface SeedOrder {
  _id?: ObjectId;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  total: number;
  items: { sku: string; qty: number; price: number }[];
  region: string;
  createdAt: Date;
  shippedAt?: Date;
}

export interface SeedUser {
  _id?: ObjectId;
  name: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  active: boolean;
  createdAt: Date;
  // Some users deliberately lack a `phone` field — tests mixed-shape inference
  phone?: string;
}

export interface SeedProduct {
  _id?: ObjectId;
  sku: string;
  name: string;
  price: number;
  category: string;
  inStock: boolean;
  // Some products deliberately lack `weight` — tests optional field inference
  weight?: number;
  tags?: string[];
}

// ─── Seed data constants ──────────────────────────────────────────────────────

const BASE_DATE = new Date('2026-01-01T00:00:00Z');
const day = (n: number) => new Date(BASE_DATE.getTime() + n * 86_400_000);

/** 60 orders — enough for multi-page testing (6 pages at pageSize=10) */
export function buildOrders(): SeedOrder[] {
  const regions = ['us-east', 'us-west', 'eu-west', 'ap-south'];
  const orders: SeedOrder[] = [];

  for (let i = 0; i < 60; i++) {
    const status = STATUSES[i % STATUSES.length] as OrderStatus;
    orders.push({
      orderNumber: `ORD-${String(i + 1).padStart(4, '0')}`,
      customerId: `cust-${(i % 10) + 1}`,
      status,
      total: parseFloat(((i + 1) * 9.99).toFixed(2)),
      items: [
        { sku: `SKU-${i % 5}`, qty: (i % 4) + 1, price: parseFloat(((i + 1) * 2.5).toFixed(2)) },
      ],
      region: regions[i % regions.length]!,
      createdAt: day(i),
      ...(status === 'shipped' || status === 'delivered' ? { shippedAt: day(i + 2) } : {}),
    });
  }

  return orders;
}

/** 20 users — varied roles, some with phone, some without */
export function buildUsers(): SeedUser[] {
  const roles: SeedUser['role'][] = ['admin', 'editor', 'viewer'];
  return Array.from({ length: 20 }, (_, i) => ({
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    role: roles[i % roles.length]!,
    active: i % 4 !== 0, // every 4th user is inactive
    createdAt: day(i * 2),
    ...(i % 3 === 0 ? { phone: `+1-555-${String(i).padStart(4, '0')}` } : {}),
  }));
}

/** 15 products — some missing weight (schema inference mixed shapes) */
export function buildProducts(): SeedProduct[] {
  const categories = ['electronics', 'clothing', 'food', 'books'];
  return Array.from({ length: 15 }, (_, i) => ({
    sku: `PROD-${String(i + 1).padStart(3, '0')}`,
    name: `Product ${i + 1}`,
    price: parseFloat(((i + 1) * 14.99).toFixed(2)),
    category: categories[i % categories.length]!,
    inStock: i % 5 !== 0,
    ...(i % 2 === 0 ? { weight: parseFloat(((i + 1) * 0.25).toFixed(2)) } : {}),
    ...(i < 10 ? { tags: [`tag-${i % 3}`, `tag-${i % 5}`] } : {}),
  }));
}

// Exported constants for use in test assertions
export const SEED_ORDERS = buildOrders();
export const SEED_USERS = buildUsers();
export const SEED_PRODUCTS = buildProducts();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Insert all seed data into the given database.
 * Returns the inserted ObjectIds for each collection so tests can reference them.
 */
export async function seedDatabase(db: Db): Promise<{
  orderIds: ObjectId[];
  userIds: ObjectId[];
  productIds: ObjectId[];
}> {
  const orderResult = await db.collection('orders').insertMany(buildOrders());
  const userResult = await db.collection('members').insertMany(buildUsers());
  const productResult = await db.collection('products').insertMany(buildProducts());

  return {
    orderIds: Object.values(orderResult.insertedIds),
    userIds: Object.values(userResult.insertedIds),
    productIds: Object.values(productResult.insertedIds),
  };
}

/**
 * Remove all documents from seed collections.
 * Call in afterEach / afterAll to keep tests isolated.
 */
export async function cleanDatabase(db: Db): Promise<void> {
  await Promise.all([
    db.collection('orders').deleteMany({}),
    db.collection('members').deleteMany({}),
    db.collection('products').deleteMany({}),
    db.collection('internal_logs').deleteMany({}),
    db.collection('gadgets').deleteMany({}),
  ]);
}
