import { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { MongoClient, type Db } from 'mongodb';
import { validateConfig, type AutoRestConfig } from './config/index.js';
import { introspectDatabase } from './introspection/index.js';
import { registerRoutes } from './routes/index.js';
import { errorHandler } from './middleware/errors.js';

export interface AutoRestOptions {
  /** MongoDB connection string */
  mongoUri: string;
  /** Route prefix, e.g. '/api'. Default: '/api' */
  prefix?: string;
  /** Plugin configuration */
  config?: AutoRestConfig;
}

/**
 * autoRest — Fastify plugin (non-encapsulated via fastify-plugin).
 *
 * Connects to MongoDB, introspects all collections, validates config,
 * and mounts CRUD routes under the given prefix.
 *
 * Usage:
 *   await app.register(autoRest, {
 *     mongoUri: process.env.MONGO_URI,
 *     prefix: '/api',
 *     config: { readOnly: false, collections: { users: { alias: 'members' } } },
 *   });
 */
const autoRestPlugin: FastifyPluginAsync<AutoRestOptions> = async (
  fastify: FastifyInstance,
  options: AutoRestOptions
): Promise<void> => {
  const { mongoUri, prefix = '/api', config: rawConfig = {} } = options;

  // Validate config — throws ConfigValidationError with descriptive message
  const config = validateConfig(rawConfig);

  // Set global JSON error handler so all errors return JSON
  fastify.setErrorHandler(errorHandler);

  // Connect to MongoDB
  let client: MongoClient;
  let db: Db;

  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    // Use the default database from the URI
    db = client.db();
  } catch (err) {
    throw new Error(
      `[mongo-autorest] Failed to connect to MongoDB: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Tear down the MongoDB connection when Fastify closes
  fastify.addHook('onClose', async () => {
    await client.close();
  });

  // Introspect — get the list of live collections
  const { collections } = await introspectDatabase(db, config);
  const collectionNames = collections.map((c) => c.name);

  // Mount per-collection routes under the prefix using a scoped child plugin.
  // Using fastify.register here with { prefix } creates a properly isolated scope.
  // Since this plugin itself is wrapped with fastify-plugin (non-encapsulating),
  // the setErrorHandler above applies globally; the route prefix is additive.
  await fastify.register(
    async (scopedPlugin: FastifyInstance) => {
      await registerRoutes(scopedPlugin, {
        db,
        config,
        collectionNames,
      });
    },
    { prefix }
  );
};

// Export without encapsulation so decorators/hooks propagate to the parent scope
export const autoRest = fp(autoRestPlugin, {
  fastify: '4.x',
  name: 'mongo-autorest',
});
