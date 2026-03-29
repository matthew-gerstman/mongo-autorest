import { EventEmitter } from 'node:events';

// ─── Event payload types ──────────────────────────────────────────────────────

export interface DocumentCreatedPayload {
  collection: string;
  document: Record<string, unknown>;
}

export interface DocumentUpdatedPayload {
  collection: string;
  id: string;
  changes: Record<string, unknown>;
}

export interface DocumentDeletedPayload {
  collection: string;
  id: string;
}

export type AutoRestEventMap = {
  'document.created': [payload: DocumentCreatedPayload];
  'document.updated': [payload: DocumentUpdatedPayload];
  'document.deleted': [payload: DocumentDeletedPayload];
};

// ─── Typed EventEmitter ───────────────────────────────────────────────────────

/**
 * AutoRestEventEmitter — typed EventEmitter for mongo-autorest document events.
 *
 * Emits:
 *   'document.created'  after a successful POST (insertOne)
 *   'document.updated'  after a successful PUT or PATCH (replaceOne/updateOne)
 *   'document.deleted'  after a successful DELETE (deleteOne)
 *
 * Events ONLY fire after successful DB operations.
 */
export class AutoRestEventEmitter extends EventEmitter {
  // emit overloads
  emit(event: 'document.created', payload: DocumentCreatedPayload): boolean;
  emit(event: 'document.updated', payload: DocumentUpdatedPayload): boolean;
  emit(event: 'document.deleted', payload: DocumentDeletedPayload): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  // on overloads
  on(event: 'document.created', listener: (payload: DocumentCreatedPayload) => void): this;
  on(event: 'document.updated', listener: (payload: DocumentUpdatedPayload) => void): this;
  on(event: 'document.deleted', listener: (payload: DocumentDeletedPayload) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  // off overloads
  off(event: 'document.created', listener: (payload: DocumentCreatedPayload) => void): this;
  off(event: 'document.updated', listener: (payload: DocumentUpdatedPayload) => void): this;
  off(event: 'document.deleted', listener: (payload: DocumentDeletedPayload) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  // once overloads
  once(event: 'document.created', listener: (payload: DocumentCreatedPayload) => void): this;
  once(event: 'document.updated', listener: (payload: DocumentUpdatedPayload) => void): this;
  once(event: 'document.deleted', listener: (payload: DocumentDeletedPayload) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }
}

/**
 * Singleton emitter shared across the plugin instance.
 * Callers can import this and attach listeners before registering the plugin,
 * or receive it via the Fastify decorator (fastify.autoRestEmitter).
 */
export const autoRestEmitter = new AutoRestEventEmitter();
