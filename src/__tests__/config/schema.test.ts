import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  ConfigValidationError,
  getDefaultPageSize,
  resolveCollectionSlug,
  isCollectionExcluded,
  isCollectionReadOnly,
} from '../../config/index.js';

describe('validateConfig', () => {
  it('accepts an empty config object', () => {
    const result = validateConfig({});
    expect(result).toEqual({});
  });

  it('accepts a fully specified valid config', () => {
    const config = {
      readOnly: true,
      auth: {
        type: 'api-key',
        header: 'x-my-key',
        keys: ['key1', 'key2'],
      },
      defaultPageSize: 50,
      introspectionInterval: 60000,
      collections: {
        users: { alias: 'members', exclude: false },
        internal_logs: { exclude: true },
      },
    };
    const result = validateConfig(config);
    expect(result.readOnly).toBe(true);
    expect(result.defaultPageSize).toBe(50);
    expect(result.auth?.keys).toEqual(['key1', 'key2']);
  });

  it('applies default header for auth', () => {
    const result = validateConfig({
      auth: { type: 'api-key', keys: ['abc'] },
    });
    expect(result.auth?.header).toBe('x-api-key');
  });

  it('throws ConfigValidationError when auth.keys is empty', () => {
    expect(() =>
      validateConfig({ auth: { type: 'api-key', keys: [] } })
    ).toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError with a descriptive message naming the field', () => {
    let error: ConfigValidationError | null = null;
    try {
      validateConfig({ auth: { type: 'api-key', keys: [] } });
    } catch (e) {
      if (e instanceof ConfigValidationError) error = e;
    }
    expect(error).not.toBeNull();
    expect(error!.message).toContain('auth.keys');
    expect(error!.issues.length).toBeGreaterThan(0);
    expect(error!.issues[0]!.path).toContain('auth.keys');
  });

  it('throws ConfigValidationError when defaultPageSize exceeds 1000', () => {
    expect(() => validateConfig({ defaultPageSize: 1001 })).toThrow(
      ConfigValidationError
    );
  });

  it('throws ConfigValidationError when defaultPageSize is 0', () => {
    expect(() => validateConfig({ defaultPageSize: 0 })).toThrow(
      ConfigValidationError
    );
  });

  it('throws ConfigValidationError when introspectionInterval is negative', () => {
    expect(() => validateConfig({ introspectionInterval: -1000 })).toThrow(
      ConfigValidationError
    );
  });

  it('throws ConfigValidationError when alias contains invalid characters', () => {
    expect(() =>
      validateConfig({ collections: { users: { alias: 'My Users!!' } } })
    ).toThrow(ConfigValidationError);
  });

  it('accepts alias with lowercase letters, numbers, and hyphens', () => {
    const result = validateConfig({
      collections: { users: { alias: 'my-users-123' } },
    });
    expect(result.collections?.['users']?.alias).toBe('my-users-123');
  });

  it('throws ConfigValidationError when webhook url is invalid', () => {
    expect(() =>
      validateConfig({
        webhooks: [{ url: 'not-a-url', events: ['document.created'] }],
      })
    ).toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError when webhook events is empty', () => {
    expect(() =>
      validateConfig({
        webhooks: [{ url: 'https://example.com/hook', events: [] }],
      })
    ).toThrow(ConfigValidationError);
  });

  it('accepts auth: false for a collection override', () => {
    const result = validateConfig({
      auth: { type: 'api-key', keys: ['key'] },
      collections: { public: { auth: false } },
    });
    expect(result.collections?.['public']?.auth).toBe(false);
  });
});

describe('getDefaultPageSize', () => {
  it('returns 100 when not configured', () => {
    expect(getDefaultPageSize({})).toBe(100);
  });

  it('returns the configured value', () => {
    expect(getDefaultPageSize({ defaultPageSize: 25 })).toBe(25);
  });
});

describe('resolveCollectionSlug', () => {
  it('lowercases the collection name', () => {
    expect(resolveCollectionSlug('Orders', {})).toBe('orders');
  });

  it('replaces underscores with hyphens', () => {
    expect(resolveCollectionSlug('internal_logs', {})).toBe('internal-logs');
  });

  it('replaces spaces with hyphens', () => {
    expect(resolveCollectionSlug('my collection', {})).toBe('my-collection');
  });

  it('uses alias when configured', () => {
    const config = { collections: { users: { alias: 'members' } } };
    expect(resolveCollectionSlug('users', config)).toBe('members');
  });

  it('ignores alias if not set', () => {
    const config = { collections: { users: {} } };
    expect(resolveCollectionSlug('users', config)).toBe('users');
  });
});

describe('isCollectionExcluded', () => {
  it('excludes system.* collections always', () => {
    expect(isCollectionExcluded('system.users', {})).toBe(true);
    expect(isCollectionExcluded('system.indexes', {})).toBe(true);
  });

  it('does not exclude regular collections by default', () => {
    expect(isCollectionExcluded('orders', {})).toBe(false);
  });

  it('excludes collections explicitly marked exclude: true', () => {
    const config = { collections: { internal_logs: { exclude: true } } };
    expect(isCollectionExcluded('internal_logs', config)).toBe(true);
  });

  it('does not exclude collections with exclude: false', () => {
    const config = { collections: { users: { exclude: false } } };
    expect(isCollectionExcluded('users', config)).toBe(false);
  });
});

describe('isCollectionReadOnly', () => {
  it('returns false by default', () => {
    expect(isCollectionReadOnly('orders', {})).toBe(false);
  });

  it('returns true when global readOnly is true', () => {
    expect(isCollectionReadOnly('orders', { readOnly: true })).toBe(true);
  });

  it('per-collection readOnly overrides global', () => {
    const config = {
      readOnly: true,
      collections: { orders: { readOnly: false } },
    };
    expect(isCollectionReadOnly('orders', config)).toBe(false);
  });

  it('per-collection readOnly: true wins even when global is false', () => {
    const config = {
      readOnly: false,
      collections: { internal: { readOnly: true } },
    };
    expect(isCollectionReadOnly('internal', config)).toBe(true);
  });
});
