import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The linked @stp/core workspace ships raw TypeScript (its package main points at
// src/index.ts). Vite must transpile it as part of the app bundle, so we do NOT
// externalize it. worker.format 'es' keeps the compute worker an ES module so it
// can import @stp/core and @garmin/fitsdk the same way the main thread does.
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // The bundled synthetic sample route is committed at the repo root
  // (examples/sample-route.gpx), one level above this workspace. Allow the dev
  // server to read it so the `?raw` import in src/lib/sampleRoute.ts resolves.
  server: { fs: { allow: ['../..'] } },
});
