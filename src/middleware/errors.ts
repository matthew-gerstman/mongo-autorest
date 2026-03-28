import { type FastifyError, type FastifyRequest, type FastifyReply } from 'fastify';
import { MongoNetworkError, MongoServerError } from 'mongodb';

/**
 * Fastify error handler — ensures all errors return JSON, never HTML.
 *
 * Maps known error types to appropriate HTTP status codes and bodies.
 * Internal errors are logged but never surfaced raw to the caller.
 */
export function errorHandler(
  error: FastifyError,
  req: FastifyRequest,
  reply: FastifyReply
): void {
  // MongoDB network/connection failure → 503
  if (error instanceof MongoNetworkError) {
    req.log.error({ err: error }, 'MongoDB connection failure');
    void reply.code(503).send({ error: 'Database unavailable' });
    return;
  }

  // MongoDB server error (e.g. write concern failure) → 503
  if (error instanceof MongoServerError) {
    req.log.error({ err: error }, 'MongoDB server error');
    void reply.code(503).send({ error: 'Database unavailable' });
    return;
  }

  // Fastify validation error (malformed request body / query params) → 400
  if (error.statusCode === 400) {
    void reply.code(400).send({ error: error.message ?? 'Bad request' });
    return;
  }

  // Pass-through for errors that already have a status code set by our handlers
  if (error.statusCode && error.statusCode < 500) {
    void reply.code(error.statusCode).send({ error: error.message });
    return;
  }

  // Anything else → 500, log the real error, return generic message
  req.log.error({ err: error }, 'Unhandled internal error');
  void reply.code(500).send({ error: 'Internal server error' });
}
