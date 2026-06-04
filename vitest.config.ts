import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Shared alias: tests resolve @stp/core to the package source (raw TS) so they
// exercise exactly what the cli and web app consume, with no build step.
const coreAlias = {
  '@stp/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
};

// Two projects so the runtimes match the deployment targets:
//   unit -> node    (packages/core + packages/cli: pure math, FIT, file IO)
//   web  -> jsdom   (apps/web: React components + the compute worker pipeline)
export default defineConfig({
  test: {
    globals: false,
    projects: [
      {
        resolve: { alias: coreAlias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/tests/**/*.test.ts', 'api/tests/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: coreAlias },
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/tests/**/*.{test,spec}.{ts,tsx}'],
        },
      },
    ],
  },
});
