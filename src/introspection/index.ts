import { type Db } from 'mongodb';
import { type AutoRestConfig } from '../config/index.js';
import { isCollectionExcluded, resolveCollectionSlug } from '../config/index.js';

export interface CollectionInfo {
  /** The original MongoDB collection name */
  name: string;
  /** The URL-safe slug used as the route segment */
  slug: string;
}

export interface IntrospectionResult {
  collections: CollectionInfo[];
  introspectedAt: Date;
}

/**
 * Run a single introspection pass: list all collections, filter excluded ones,
 * and normalize each name to a URL-safe slug.
 */
export async function introspectDatabase(
  db: Db,
  config: AutoRestConfig
): Promise<IntrospectionResult> {
  const raw = await db.listCollections().toArray();

  const collections: CollectionInfo[] = [];
  for (const col of raw) {
    if (isCollectionExcluded(col.name, config)) {
      continue;
    }
    collections.push({
      name: col.name,
      slug: resolveCollectionSlug(col.name, config),
    });
  }

  return {
    collections,
    introspectedAt: new Date(),
  };
}

/**
 * Computes the symmetric diff between two collection lists.
 * Returns added and removed collection names (by slug).
 */
export function diffCollections(
  previous: CollectionInfo[],
  current: CollectionInfo[]
): { added: CollectionInfo[]; removed: CollectionInfo[] } {
  const prevSlugs = new Set(previous.map((c) => c.slug));
  const currSlugs = new Set(current.map((c) => c.slug));

  return {
    added: current.filter((c) => !prevSlugs.has(c.slug)),
    removed: previous.filter((c) => !currSlugs.has(c.slug)),
  };
}

export type IntrospectionChangeHandler = (
  added: CollectionInfo[],
  removed: CollectionInfo[]
) => void | Promise<void>;

/**
 * Manages periodic re-introspection. Fires the onChange callback when
 * the collection list changes. Returns a stop function to cancel the interval.
 */
export function startIntrospectionInterval(
  db: Db,
  config: AutoRestConfig,
  initial: IntrospectionResult,
  onChange: IntrospectionChangeHandler
): () => void {
  const intervalMs = config.introspectionInterval;
  if (!intervalMs) {
    // No interval configured — no-op, return noop stop
    return () => undefined;
  }

  let current = initial;
  let stopped = false;

  const run = async (): Promise<void> => {
    if (stopped) return;
    try {
      const next = await introspectDatabase(db, config);
      const diff = diffCollections(current.collections, next.collections);
      if (diff.added.length > 0 || diff.removed.length > 0) {
        current = next;
        await onChange(diff.added, diff.removed);
      }
    } catch (err) {
      console.error('[mongo-autorest] Re-introspection error:', err);
    }
  };

  const handle = setInterval(() => {
    void run();
  }, intervalMs);

  // Allow Node.js to exit even if the interval is still running
  if (typeof handle.unref === 'function') {
    handle.unref();
  }

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
