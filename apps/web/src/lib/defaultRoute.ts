/**
 * The bundled default route, prefilled into the form on load.
 *
 * The committed GPX lives at the repo root (examples/vattern-315.gpx), outside
 * apps/web. Vite's `?raw` import inlines its text into the bundle at build time;
 * the cross-root read is permitted by `server.fs.allow` in vite.config.ts.
 */
import defaultRouteGpx from '../../../../examples/vattern-315.gpx?raw';

export const DEFAULT_ROUTE_NAME = 'Vätternrundan 315 km.gpx';
export { defaultRouteGpx };
