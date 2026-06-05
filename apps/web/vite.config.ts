import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The linked @stp/core workspace ships raw TypeScript (its package main points at
// src/index.ts). Vite must transpile it as part of the app bundle, so we do NOT
// externalize it. worker.format 'es' keeps the compute worker an ES module so it
// can import @stp/core and @garmin/fitsdk the same way the main thread does.
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // Pin @stp/core to the workspace source so the app always bundles THIS
  // checkout's core (matching the root vitest.config.ts alias and the tsconfig
  // paths mapping). Without this, Node resolution can follow a hoisted
  // node_modules symlink to a sibling checkout's core (e.g. in a git worktree
  // that shares the main repo's node_modules), bundling stale exports.
  resolve: {
    alias: {
      '@stp/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  // The bundled default route is committed at the repo root
  // (examples/vattern-315.gpx), one level above this workspace. Allow the dev
  // server to read it so the `?raw` import in src/lib/defaultRoute.ts resolves.
  server: { fs: { allow: ['../..'] } },
});
