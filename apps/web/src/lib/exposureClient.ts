/**
 * Opt-in exposure fetch for UPLOADED routes.
 *
 * The built-in Vätternrundan route ships with a baked exposure file
 * (data/vatternrundan-exposure.json, applied in the pipeline), so it needs no
 * network. For an arbitrary uploaded GPX we would classify land cover on the
 * fly from OpenStreetMap via the Overpass API and turn it into ExposureRuns.
 *
 * This is deliberately a stub: a real implementation has to chunk the route,
 * issue Overpass queries (heavy, rate-limited, and only sometimes CORS-OK from
 * the browser), and map OSM tags to ExposureClass the same way the offline bake
 * script does. Until that lands the UI keeps the button disabled and uploaded
 * routes fall back to the coarse `exposure_terrain` setting, which is honest and
 * network-free.
 */
import type { ExposureRuns, MicroSegment } from '@stp/core';

/**
 * TODO(task8): classify an uploaded route's exposure from OSM/Overpass in the
 * browser and return ExposureRuns to feed `applyExposure`. Currently unimplemented;
 * callers must keep the trigger disabled. Throws so an accidental call is loud.
 */
export async function fetchExposureForRoute(
  _micro: MicroSegment[],
  _routeId: string,
): Promise<ExposureRuns> {
  throw new Error('Exponeringshämtning för egna rutter är inte implementerad ännu (TODO task8).');
}
