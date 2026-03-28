import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createAuthHook } from '../../middleware/auth.js';

async function buildApp(keys: string[], header = 'x-api-key') {
  const app = Fastify({ logger: false });
  const hook = createAuthHook({ type: 'api-key', header, keys });
  app.addHook('onRequest', hook);
  app.get('/test', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('createAuthHook', () => {
  it('returns 401 when header is absent', async () => {
    const app = await buildApp(['valid-key']);
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('Authentication required');
  });

  it('returns 403 when key does not match', async () => {
    const app = await buildApp(['valid-key']);
    const res = await app.inject({ method: 'GET', url: '/test', headers: { 'x-api-key': 'wrong' } });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('Forbidden');
  });

  it('returns 200 when key matches', async () => {
    const app = await buildApp(['valid-key']);
    const res = await app.inject({ method: 'GET', url: '/test', headers: { 'x-api-key': 'valid-key' } });
    expect(res.statusCode).toBe(200);
  });

  it('accepts any key from the keys array', async () => {
    const app = await buildApp(['key-a', 'key-b', 'key-c']);
    const res = await app.inject({ method: 'GET', url: '/test', headers: { 'x-api-key': 'key-b' } });
    expect(res.statusCode).toBe(200);
  });

  it('respects a custom header name', async () => {
    const app = await buildApp(['secret'], 'authorization');
    const res = await app.inject({ method: 'GET', url: '/test', headers: { authorization: 'secret' } });
    expect(res.statusCode).toBe(200);
  });

  it('rejects empty string key as missing', async () => {
    const app = await buildApp(['valid-key']);
    const res = await app.inject({ method: 'GET', url: '/test', headers: { 'x-api-key': '' } });
    // Empty string header is treated as missing/falsy
    expect(res.statusCode).toBe(401);
  });
});
