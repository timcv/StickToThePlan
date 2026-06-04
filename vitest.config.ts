import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Transition config: runs both the legacy root tests (tests/) and the
// relocated package tests (packages/*/tests). The legacy globs are removed
// in Task 2 once everything lives under packages/. The web (jsdom) project
// is added in Phase 2 when apps/web has tests.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@stp/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
});
