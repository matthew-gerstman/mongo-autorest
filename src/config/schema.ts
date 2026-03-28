import { z } from 'zod';

const AuthConfigSchema = z.object({
  type: z.literal('api-key'),
  header: z.string().default('x-api-key'),
  keys: z
    .array(z.string().min(1))
    .min(1, { message: 'auth.keys must contain at least one key' }),
});

const FieldsConfigSchema = z.object({
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const CollectionOverrideSchema = z.object({
  exclude: z.boolean().optional(),
  alias: z
    .string()
    .regex(/^[a-z0-9-]+$/, {
      message: 'alias must be URL-safe (lowercase letters, numbers, hyphens)',
    })
    .optional(),
  readOnly: z.boolean().optional(),
  auth: z.union([z.literal(false), AuthConfigSchema]).optional(),
  fields: FieldsConfigSchema.optional(),
});

const WebhookConfigSchema = z.object({
  url: z.string().url({ message: 'webhook.url must be a valid URL' }),
  events: z
    .array(
      z.enum(['document.created', 'document.updated', 'document.deleted'])
    )
    .min(1, { message: 'webhook.events must contain at least one event' }),
  secret: z.string().optional(),
  collections: z.array(z.string()).optional(),
});

export const AutoRestConfigSchema = z.object({
  readOnly: z.boolean().optional(),
  auth: AuthConfigSchema.optional(),
  collections: z.record(z.string(), CollectionOverrideSchema).optional(),
  introspectionInterval: z
    .number()
    .int()
    .positive({ message: 'introspectionInterval must be a positive integer (ms)' })
    .optional(),
  defaultPageSize: z
    .number()
    .int()
    .min(1)
    .max(1000, { message: 'defaultPageSize must be between 1 and 1000' })
    .optional(),
  useFastCount: z.boolean().optional(),
  serveOpenApi: z.boolean().optional(),
  swaggerUi: z.boolean().optional(),
  webhooks: z.array(WebhookConfigSchema).optional(),
});

// TypeScript types derived from Zod schemas
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type CollectionOverride = z.infer<typeof CollectionOverrideSchema>;
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;
export type AutoRestConfig = z.infer<typeof AutoRestConfigSchema>;
