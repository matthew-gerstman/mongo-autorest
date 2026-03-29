import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  buildSignature,
  deliverOnce,
  deliver,
  registerWebhookListeners,
} from '../../webhooks/delivery.js';
import { AutoRestEventEmitter } from '../../webhooks/events.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSignature(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function makeFetchResponse(status: number): Response {
  return { status } as Response;
}

// ─── buildSignature ───────────────────────────────────────────────────────────

describe('buildSignature', () => {
  it('returns sha256=<hex> with a secret', () => {
    const body = JSON.stringify({ event: 'document.created', collection: 'orders' });
    const secret = 'supersecret';
    const expected = makeSignature(body, secret);
    expect(buildSignature(body, secret)).toBe(expected);
  });

  it('returns empty string when secret is undefined', () => {
    expect(buildSignature('{"x":1}', undefined)).toBe('');
  });

  it('returns empty string when secret is empty string', () => {
    // empty string is falsy
    expect(buildSignature('{"x":1}', '')).toBe('');
  });

  it('produces different signatures for different bodies', () => {
    const secret = 'secret';
    const sig1 = buildSignature('body1', secret);
    const sig2 = buildSignature('body2', secret);
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different secrets', () => {
    const body = 'same body';
    const sig1 = buildSignature(body, 'secret1');
    const sig2 = buildSignature(body, 'secret2');
    expect(sig1).not.toBe(sig2);
  });
});

// ─── deliverOnce ─────────────────────────────────────────────────────────────

describe('deliverOnce', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs with content-type application/json', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    await deliverOnce('https://example.com/hook', '{"x":1}', '');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe('{"x":1}');
  });

  it('includes x-autorest-signature header when signature is non-empty', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    await deliverOnce('https://example.com/hook', '{"x":1}', 'sha256=abc123');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-autorest-signature']).toBe('sha256=abc123');
  });

  it('omits x-autorest-signature header when signature is empty', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    await deliverOnce('https://example.com/hook', '{"x":1}', '');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-autorest-signature']).toBeUndefined();
  });

  it('returns the HTTP status code', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(500));

    const status = await deliverOnce('https://example.com/hook', '{}', '');
    expect(status).toBe(500);
  });
});

// ─── deliver ─────────────────────────────────────────────────────────────────

describe('deliver', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('delivers successfully on first attempt (2xx) — no retry', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    await deliver(
      { url: 'https://example.com/hook', events: ['document.created'] },
      { event: 'document.created', collection: 'orders', document: {} }
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('retries after 5 s on non-2xx and succeeds on retry', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeFetchResponse(500))
      .mockResolvedValueOnce(makeFetchResponse(200));

    const deliverPromise = deliver(
      { url: 'https://example.com/hook', events: ['document.updated'] },
      { event: 'document.updated', collection: 'orders', id: '1', changes: {} }
    );

    // Advance timers past the 5 s retry delay
    await vi.advanceTimersByTimeAsync(5_000);
    await deliverPromise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('logs console.error after both attempts fail with non-2xx', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeFetchResponse(503))
      .mockResolvedValueOnce(makeFetchResponse(503));

    const deliverPromise = deliver(
      { url: 'https://example.com/hook', events: ['document.deleted'] },
      { event: 'document.deleted', collection: 'orders', id: '1' }
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await deliverPromise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledOnce();
    const call = vi.mocked(console.error).mock.calls[0];
    expect(call[0]).toContain('failed after retry');
    expect(call[1]).toMatchObject({ collection: 'orders', event: 'document.deleted' });
  });

  it('retries on network error (first attempt throws)', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(makeFetchResponse(200));

    const deliverPromise = deliver(
      { url: 'https://example.com/hook', events: ['document.created'] },
      { event: 'document.created', collection: 'users', document: {} }
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await deliverPromise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    // console.error for the network error warning (logged before retry)
    expect(console.error).toHaveBeenCalledOnce();
  });

  it('logs console.error when both attempts throw network errors', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const deliverPromise = deliver(
      { url: 'https://example.com/hook', events: ['document.created'] },
      { event: 'document.created', collection: 'users', document: {} }
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await deliverPromise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledTimes(2);
    const firstCall = vi.mocked(console.error).mock.calls[0];
    expect(firstCall[0]).toContain('network error');
  });

  it('includes correct HMAC signature in delivery', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    const secret = 'my-signing-secret';
    const payload = { event: 'document.created' as const, collection: 'products', document: {} };

    await deliver(
      { url: 'https://example.com/hook', events: ['document.created'], secret },
      payload
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = init.body as string;
    const expectedSig = makeSignature(body, secret);
    expect((init.headers as Record<string, string>)['x-autorest-signature']).toBe(expectedSig);
  });

  it('sends no signature header when secret is omitted', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    await deliver(
      { url: 'https://example.com/hook', events: ['document.created'] },
      { event: 'document.created', collection: 'x', document: {} }
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-autorest-signature']).toBeUndefined();
  });
});

// ─── registerWebhookListeners ─────────────────────────────────────────────────

describe('registerWebhookListeners', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('delivers webhook when subscribed event fires', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    const emitter = new AutoRestEventEmitter();
    registerWebhookListeners(emitter, [
      { url: 'https://example.com/hook', events: ['document.created'] },
    ]);

    emitter.emit('document.created', { collection: 'orders', document: { _id: '1' } });

    // Let the async delivery run
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(parsed.event).toBe('document.created');
    expect(parsed.collection).toBe('orders');
  });

  it('does NOT deliver when event is not in webhook.events', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    const emitter = new AutoRestEventEmitter();
    registerWebhookListeners(emitter, [
      { url: 'https://example.com/hook', events: ['document.deleted'] },
    ]);

    emitter.emit('document.created', { collection: 'orders', document: {} });
    await vi.runAllTimersAsync();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('per-collection filter: fires for matching collection', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    const emitter = new AutoRestEventEmitter();
    registerWebhookListeners(emitter, [
      {
        url: 'https://example.com/hook',
        events: ['document.updated'],
        collections: ['orders'],
      },
    ]);

    emitter.emit('document.updated', { collection: 'orders', id: '1', changes: {} });
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('per-collection filter: skips non-matching collection', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    const emitter = new AutoRestEventEmitter();
    registerWebhookListeners(emitter, [
      {
        url: 'https://example.com/hook',
        events: ['document.updated'],
        collections: ['orders'],
      },
    ]);

    emitter.emit('document.updated', { collection: 'users', id: '1', changes: {} });
    await vi.runAllTimersAsync();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fires for all collections when collections array is empty', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    const emitter = new AutoRestEventEmitter();
    registerWebhookListeners(emitter, [
      {
        url: 'https://example.com/hook',
        events: ['document.created'],
        collections: [],  // empty = no filter
      },
    ]);

    emitter.emit('document.created', { collection: 'anything', document: {} });
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('fires for all collections when collections is undefined', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    const emitter = new AutoRestEventEmitter();
    registerWebhookListeners(emitter, [
      { url: 'https://example.com/hook', events: ['document.deleted'] },
    ]);

    emitter.emit('document.deleted', { collection: 'products', id: 'x' });
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('registers multiple webhooks independently', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(makeFetchResponse(200));

    const emitter = new AutoRestEventEmitter();
    registerWebhookListeners(emitter, [
      { url: 'https://hook1.example.com', events: ['document.created'] },
      { url: 'https://hook2.example.com', events: ['document.created'] },
    ]);

    emitter.emit('document.created', { collection: 'orders', document: {} });
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const urls = mockFetch.mock.calls.map(([url]) => url as string);
    expect(urls).toContain('https://hook1.example.com');
    expect(urls).toContain('https://hook2.example.com');
  });
});

// ─── Additional deliver coverage ──────────────────────────────────────────────

describe('deliver — additional retry paths', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs error when first attempt throws (network) and retry returns non-2xx', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ status: 503 } as Response);

    const deliverPromise = deliver(
      { url: 'https://example.com/hook', events: ['document.created'] },
      { event: 'document.created', collection: 'orders', document: {} }
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await deliverPromise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    // 1st error: network warning before retry; 2nd error: failed after retry (non-2xx)
    expect(console.error).toHaveBeenCalledTimes(2);
    const secondCall = vi.mocked(console.error).mock.calls[1];
    expect(secondCall[0]).toContain('failed after retry');
    expect(secondCall[1]).toMatchObject({ collection: 'orders', event: 'document.created', status: 503 });
  });

  it('logs error when first attempt returns non-2xx and retry throws (network)', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce({ status: 500 } as Response)
      .mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const deliverPromise = deliver(
      { url: 'https://example.com/hook', events: ['document.deleted'] },
      { event: 'document.deleted', collection: 'orders', id: '1' }
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await deliverPromise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledOnce();
    const call = vi.mocked(console.error).mock.calls[0];
    expect(call[0]).toContain('network error');
    expect(call[1]).toMatchObject({ collection: 'orders', event: 'document.deleted' });
  });
});
