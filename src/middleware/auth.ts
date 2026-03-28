import { type FastifyRequest, type FastifyReply } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { type AuthConfig } from '../config/index.js';

/**
 * Creates a Fastify onRequest hook that enforces API key authentication.
 *
 * - Missing header → 401 { error: "Authentication required" }
 * - Invalid key   → 403 { error: "Forbidden" }
 * - Valid key     → continues
 *
 * Uses crypto.timingSafeEqual for constant-time comparison to prevent
 * timing attacks.
 */
export function createAuthHook(
  authConfig: AuthConfig
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const header = authConfig.header ?? 'x-api-key';

  // Pre-hash all valid keys so comparison is constant-length
  const validKeyBuffers = authConfig.keys.map((key) =>
    Buffer.from(createHash('sha256').update(key).digest('hex'))
  );

  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const providedKey = req.headers[header];

    if (!providedKey || typeof providedKey !== 'string') {
      await reply.code(401).send({ error: 'Authentication required' });
      return;
    }

    const providedBuffer = Buffer.from(
      createHash('sha256').update(providedKey).digest('hex')
    );

    const isValid = validKeyBuffers.some((validBuffer) => {
      if (validBuffer.length !== providedBuffer.length) {
        return false;
      }
      return timingSafeEqual(validBuffer, providedBuffer);
    });

    if (!isValid) {
      await reply.code(403).send({ error: 'Forbidden' });
      return;
    }
  };
}
