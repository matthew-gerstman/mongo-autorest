import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { AutoRestEventEmitter } from './events.js';
import type { WebhookConfig } from '../config/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventType = 'document.created' | 'document.updated' | 'document.deleted';

export interface WebhookPayload {
  event: EventType;
  collection: string;
  [key: string]: unknown;
}

// ─── HMAC signing ─────────────────────────────────────────────────────────────

/**
 * Build the x-autorest-signature header value: "sha256=<hex>".
 * Returns an empty string if no secret is configured.
 */
export function buildSignature(body: string, secret: string | undefined): string {
  if (!secret) return '';
  const hex = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hex}`;
}

// ─── Single delivery attempt ──────────────────────────────────────────────────

/**
 * Deliver one webhook payload to `url`.
 * Returns the HTTP status code, or throws on network error.
 */
export async function deliverOnce(
  url: string,
  body: string,
  signature: string
): Promise<number> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (signature) {
    headers['x-autorest-signature'] = signature;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  return res.status;
}

// ─── Delivery with one retry ──────────────────────────────────────────────────

const RETRY_DELAY_MS = 5_000;

/**
 * Deliver a webhook with one retry on non-2xx after 5 s.
 * Logs failures with console.error. Fire-and-forget — never throws.
 */
export async function deliver(
  webhook: WebhookConfig,
  payload: WebhookPayload
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = buildSignature(body, webhook.secret);

  let status: number;

  try {
    status = await deliverOnce(webhook.url, body, signature);
    if (status >= 200 && status < 300) return;
  } catch (err) {
    console.error(
      `[mongo-autorest] Webhook delivery failed (network error), retrying in ${RETRY_DELAY_MS}ms:`,
      { collection: payload.collection, event: payload.event, error: String(err) }
    );
    await sleep(RETRY_DELAY_MS);

    try {
      status = await deliverOnce(webhook.url, body, signature);
      if (status >= 200 && status < 300) return;
      console.error(`[mongo-autorest] Webhook delivery failed after retry`, {
        collection: payload.collection,
        event: payload.event,
        status,
      });
    } catch (retryErr) {
      console.error(`[mongo-autorest] Webhook delivery failed after retry (network error)`, {
        collection: payload.collection,
        event: payload.event,
        error: String(retryErr),
      });
    }
    return;
  }

  // First attempt returned non-2xx — retry after 5 s
  await sleep(RETRY_DELAY_MS);

  try {
    const retryStatus = await deliverOnce(webhook.url, body, signature);
    if (retryStatus >= 200 && retryStatus < 300) return;
    console.error(`[mongo-autorest] Webhook delivery failed after retry`, {
      collection: payload.collection,
      event: payload.event,
      status: retryStatus,
    });
  } catch (retryErr) {
    console.error(`[mongo-autorest] Webhook delivery failed after retry (network error)`, {
      collection: payload.collection,
      event: payload.event,
      error: String(retryErr),
    });
  }
}

// ─── Wire up listeners ────────────────────────────────────────────────────────

/**
 * Attach listeners to the emitter for each configured webhook.
 * Per-collection filtering is applied here — a webhook with `collections`
 * only fires when the event's collection is in that list.
 *
 * We call through EventEmitter's base `.on()` to avoid TypeScript overload
 * resolution issues when `eventType` is a union string (EventType).
 */
export function registerWebhookListeners(
  emitter: AutoRestEventEmitter,
  webhooks: WebhookConfig[]
): void {
  // Cast to base EventEmitter to bypass typed overload union resolution
  const baseEmitter = emitter as unknown as EventEmitter;

  for (const webhook of webhooks) {
    for (const eventType of webhook.events) {
      baseEmitter.on(eventType, (payload: { collection: string } & Record<string, unknown>) => {
        // Per-collection filter
        if (
          webhook.collections &&
          webhook.collections.length > 0 &&
          !webhook.collections.includes(payload.collection)
        ) {
          return;
        }

        // Fire-and-forget
        void deliver(webhook, {
          event: eventType as EventType,
          ...payload,
        });
      });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
