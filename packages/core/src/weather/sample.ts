/**
 * Route -> weather sample points.
 *
 * The ensemble bins coordinates to 0.1deg (~11 km). The maximum-fidelity,
 * zero-waste sampling is therefore exactly one point per distinct 0.1deg cell
 * the route crosses: finer collapses into the same bin, coarser leaves gaps.
 * We walk the microsegments in route order and emit each segment-start coord the
 * first time its 0.1deg bin is seen.
 */
import type { MicroSegment } from '../types.js';
import type { GeoPoint } from './openMeteo.js';

function binKey(lat: number, lon: number): string {
  return `${Math.round(lat * 10) / 10}|${Math.round(lon * 10) / 10}`;
}

export function sampleCellPoints(micro: MicroSegment[]): GeoPoint[] {
  const seen = new Set<string>();
  const points: GeoPoint[] = [];
  for (const m of micro) {
    const key = binKey(m.lat, m.lon);
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ lat: m.lat, lon: m.lon });
  }
  return points;
}
