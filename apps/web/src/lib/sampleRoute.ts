/**
 * The bundled synthetic sample route.
 *
 * The committed GPX lives at the repo root (examples/sample-route.gpx), outside
 * apps/web. Vite's `?raw` import inlines its text into the bundle at build time;
 * the cross-root read is permitted by `server.fs.allow` in vite.config.ts. The
 * route is deterministic synthetic data, not based on any real ride, so it is
 * safe to ship in the open-source build.
 */
import sampleRouteGpx from '../../../../examples/sample-route.gpx?raw';

export { sampleRouteGpx };
