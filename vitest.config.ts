import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 90,
      },
      exclude: [
        'dist/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        'vitest.config.ts',
        'tsup.config.ts',
        // Placeholder modules not yet implemented in this PR
        'src/openapi/**',
        // Re-export barrel files — nothing to unit test here
        'src/index.ts',
        'src/middleware/index.ts',
        'src/webhooks/index.ts',
        'src/routes/index.ts',  // registerRoutes is covered via plugin integration tests
      ],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
