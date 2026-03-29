import { ZodError } from 'zod';
import { AutoRestConfigSchema, ExplorerOptionsSchema, type AutoRestConfig } from './schema.js';

export { AutoRestConfigSchema, ExplorerOptionsSchema };
export type { AutoRestConfig, AuthConfig, CollectionOverride, WebhookConfig, ExplorerOptions } from './schema.js';

/**
 * Thrown when the AutoRestConfig fails Zod validation at startup.
 * The message names the offending field(s) to guide the caller.
 */
export class ConfigValidationError extends Error {
  public readonly issues: Array<{ path: string; message: string }>;

  constructor(zodError: ZodError) {
    const issues = zodError.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }));

    const summary = issues
      .map((i) => `  - ${i.path}: ${i.message}`)
      .join('\n');

    super(`Invalid AutoRestConfig:\n${summary}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

/**
 * Validates the provided config object using Zod.
 * Throws ConfigValidationError with a descriptive message if validation fails.
 * Returns the parsed (and default-filled) config on success.
 */
export function validateConfig(
  raw: unknown
): AutoRestConfig {
  const result = AutoRestConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigValidationError(result.error);
  }
  return result.data;
}

/**
 * Returns the resolved defaultPageSize, falling back to 100 if not configured.
 */
export function getDefaultPageSize(config: AutoRestConfig): number {
  return config.defaultPageSize ?? 100;
}

/**
 * Resolve the URL slug for a collection, applying alias if configured.
 */
export function resolveCollectionSlug(
  collectionName: string,
  config: AutoRestConfig
): string {
  const override = config.collections?.[collectionName];
  if (override?.alias) {
    return override.alias;
  }
  // Normalize: lowercase, replace underscores/spaces with hyphens
  return collectionName.toLowerCase().replace(/[_\s]+/g, '-');
}

/**
 * Determine whether a collection is excluded from route mounting.
 * system.* collections are always excluded.
 */
export function isCollectionExcluded(
  collectionName: string,
  config: AutoRestConfig
): boolean {
  if (collectionName.startsWith('system.')) {
    return true;
  }
  return config.collections?.[collectionName]?.exclude === true;
}

/**
 * Determine whether write operations are disabled for a collection.
 * Per-collection readOnly overrides the global setting.
 */
export function isCollectionReadOnly(
  collectionName: string,
  config: AutoRestConfig
): boolean {
  const override = config.collections?.[collectionName];
  if (override?.readOnly !== undefined) {
    return override.readOnly;
  }
  return config.readOnly === true;
}
