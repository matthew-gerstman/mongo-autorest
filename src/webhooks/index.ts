/**
 * Webhook / EventEmitter layer — emits document.created, document.updated,
 * document.deleted events and delivers outbound HTTP webhooks with HMAC signing.
 */
export {
  AutoRestEventEmitter,
  autoRestEmitter,
} from './events.js';
export type {
  DocumentCreatedPayload,
  DocumentUpdatedPayload,
  DocumentDeletedPayload,
  AutoRestEventMap,
} from './events.js';

export {
  buildSignature,
  deliverOnce,
  deliver,
  registerWebhookListeners,
} from './delivery.js';
export type { EventType, WebhookPayload } from './delivery.js';
