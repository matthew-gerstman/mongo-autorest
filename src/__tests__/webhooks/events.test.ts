import { describe, it, expect, vi } from 'vitest';
import { AutoRestEventEmitter } from '../../webhooks/events.js';

describe('AutoRestEventEmitter', () => {
  it('emits document.created with correct payload', () => {
    const emitter = new AutoRestEventEmitter();
    const listener = vi.fn();
    emitter.on('document.created', listener);

    const payload = { collection: 'orders', document: { _id: '1', qty: 5 } };
    emitter.emit('document.created', payload);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(payload);
  });

  it('emits document.updated with correct payload', () => {
    const emitter = new AutoRestEventEmitter();
    const listener = vi.fn();
    emitter.on('document.updated', listener);

    const payload = { collection: 'orders', id: 'abc123', changes: { qty: 10 } };
    emitter.emit('document.updated', payload);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(payload);
  });

  it('emits document.deleted with correct payload', () => {
    const emitter = new AutoRestEventEmitter();
    const listener = vi.fn();
    emitter.on('document.deleted', listener);

    const payload = { collection: 'orders', id: 'abc123' };
    emitter.emit('document.deleted', payload);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(payload);
  });

  it('supports multiple listeners on the same event', () => {
    const emitter = new AutoRestEventEmitter();
    const l1 = vi.fn();
    const l2 = vi.fn();
    emitter.on('document.created', l1);
    emitter.on('document.created', l2);

    emitter.emit('document.created', { collection: 'x', document: {} });

    expect(l1).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledOnce();
  });

  it('off() removes a listener', () => {
    const emitter = new AutoRestEventEmitter();
    const listener = vi.fn();
    emitter.on('document.created', listener);
    emitter.off('document.created', listener);

    emitter.emit('document.created', { collection: 'x', document: {} });
    expect(listener).not.toHaveBeenCalled();
  });

  it('once() fires only once', () => {
    const emitter = new AutoRestEventEmitter();
    const listener = vi.fn();
    emitter.once('document.created', listener);

    emitter.emit('document.created', { collection: 'x', document: {} });
    emitter.emit('document.created', { collection: 'x', document: {} });

    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not fire document.created listener on document.updated', () => {
    const emitter = new AutoRestEventEmitter();
    const createdListener = vi.fn();
    emitter.on('document.created', createdListener);

    emitter.emit('document.updated', { collection: 'x', id: '1', changes: {} });

    expect(createdListener).not.toHaveBeenCalled();
  });

  it('returns false when no listeners, true when listeners exist', () => {
    const emitter = new AutoRestEventEmitter();

    const noListener = emitter.emit('document.created', { collection: 'x', document: {} });
    expect(noListener).toBe(false);

    const listener = vi.fn();
    emitter.on('document.created', listener);
    const withListener = emitter.emit('document.created', { collection: 'x', document: {} });
    expect(withListener).toBe(true);
  });
});
