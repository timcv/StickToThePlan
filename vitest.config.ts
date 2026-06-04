import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Runs the relocated package tests under packages/*/tests. The web (jsdom)
// project is added in Phase 2 when apps/web has tests.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['packages/*/tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@stp/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
});
