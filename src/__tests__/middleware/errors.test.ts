import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyError } from 'fastify';
import { MongoNetworkError, MongoServerError } from 'mongodb';
import { errorHandler } from '../../middleware/errors.js';

function makeApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  return app;
}

function makeFastifyError(message: string, statusCode: number): FastifyError {
  const err = new Error(message) as FastifyError;
  err.statusCode = statusCode;
  err.code = `ERR_${statusCode}`;
  return err;
}

describe('errorHandler', () => {
  it('returns 503 for MongoNetworkError', async () => {
    const app = makeApp();
    app.get('/test', async () => {
      throw new MongoNetworkError('Connection refused');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: string }>().error).toBe('Database unavailable');
  });

  it('returns 503 for MongoServerError', async () => {
    const app = makeApp();
    app.get('/test', async () => {
      const err = new MongoServerError({ message: 'Write conflict' });
      throw err;
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: string }>().error).toBe('Database unavailable');
  });

  it('returns 400 for errors with statusCode 400', async () => {
    const app = makeApp();
    app.get('/test', async () => {
      throw makeFastifyError('Bad input', 400);
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('Bad input');
  });

  it('returns 404 for errors with statusCode 404', async () => {
    const app = makeApp();
    app.get('/test', async () => {
      throw makeFastifyError('Not found', 404);
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('Not found');
  });

  it('returns 403 for errors with statusCode 403', async () => {
    const app = makeApp();
    app.get('/test', async () => {
      throw makeFastifyError('Forbidden', 403);
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('Forbidden');
  });

  it('returns 500 for unhandled internal errors', async () => {
    const app = makeApp();
    app.get('/test', async () => {
      throw new Error('Something exploded');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: string }>().error).toBe('Internal server error');
  });

  it('does not expose internal error details in 500 response', async () => {
    const app = makeApp();
    app.get('/test', async () => {
      throw new Error('secret db password: hunter2');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.body).not.toContain('hunter2');
    expect(res.statusCode).toBe(500);
  });
});
