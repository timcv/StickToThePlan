import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import type { RoutePoint, MicroSegment, Config } from '../types.js';
import { haversine, bearing } from '../util/geo.js';

// -------------------------------------------------------------------------
// parseGpx
// -------------------------------------------------------------------------

/**
 * Parse a GPX file and return an array of RoutePoints.
 * Handles trk and trkseg as either arrays or single objects.
 */
export function parseGpx(path: string): RoutePoint[] {
  const xml = readFileSync(path, 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const doc = parser.parse(xml) as Record<string, unknown>;

  const gpx = doc['gpx'] as Record<string, unknown>;

  // trk may be a single object or an array
  let trk = gpx['trk'];
  if (Array.isArray(trk)) {
    trk = trk[0];
  }
  const trkObj = trk as Record<string, unknown>;

  // trkseg may be a single object or an array
  let trkseg = trkObj['trkseg'];
  if (Array.isArray(trkseg)) {
    trkseg = trkseg[0];
  }
  const trksegObj = trkseg as Record<string, unknown>;

  // trkpt is always an array (fast-xml-parser may return a single object if only 1 point)
  let trkpts = trksegObj['trkpt'];
  if (!Array.isArray(trkpts)) {
    trkpts = [trkpts];
  }
  const points = trkpts as Array<Record<string, unknown>>;

  return points.map((pt) => ({
    lat: Number(pt['@_lat']),
    lon: Number(pt['@_lon']),
    ele: Number(pt['ele']),
  }));
}

// -------------------------------------------------------------------------
// dedupePoints
// -------------------------------------------------------------------------

/**
 * Drop a point if its haversine distance to the previous kept point is < 0.5 m.
 */
export function dedupePoints(pts: RoutePoint[]): RoutePoint[] {
  if (pts.length === 0) return [];
  const kept: RoutePoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const dist = haversine(kept[kept.length - 1], pts[i]);
    if (dist >= 0.5) {
      kept.push(pts[i]);
    }
  }
  return kept;
}

// -------------------------------------------------------------------------
// smoothElevation
// -------------------------------------------------------------------------

/**
 * Centered moving average with an odd window size.
 * Clamps at array ends: the window is truncated to only the one-sided portion
 * that fits inside the array. For example, with window=3 and half=1:
 *   - i=0: only [0] (right half, no left overhang) -> average of 1 element
 *   - i=1: [0..2] (full window) -> average of 3 elements
 *   - last: only [n-1] -> average of 1 element
 * Returns an array of the same length as the input.
 */
export function smoothElevation(eles: number[], window: number): number[] {
  const n = eles.length;
  const half = Math.floor(window / 2);
  const result = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    // Only use the half-window on each side that fits; endpoints use no extension
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    // Restrict to the symmetric portion that does not overhang either end
    const actualHalf = Math.min(i - lo, hi - i);
    const symLo = i - actualHalf;
    const symHi = i + actualHalf;
    let sum = 0;
    for (let j = symLo; j <= symHi; j++) {
      sum += eles[j];
    }
    result[i] = sum / (symHi - symLo + 1);
  }
  return result;
}

// -------------------------------------------------------------------------
// buildMicroSegments
// -------------------------------------------------------------------------

/**
 * Build MicroSegments from consecutive point pairs using smoothed elevation.
 * - distance_m: haversine between consecutive points.
 * - bearing_deg: forward azimuth from start to end.
 * - grade: clamped to [-max_grade, max_grade]; 0 when distance_m === 0.
 * - cum_distance_m: cumulative distance at segment END.
 * - lat/lon: START point coordinates.
 * - neutral: true when the segment START cum_distance is < neutral_distance_km * 1000.
 */
export function buildMicroSegments(
  pts: RoutePoint[],
  smoothedEle: number[],
  cfg: Config,
): MicroSegment[] {
  const segments: MicroSegment[] = [];
  let cumDist = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];

    const distance_m = haversine(a, b);
    const bearing_deg = bearing(a, b);

    const eleStart = smoothedEle[i];
    const eleEnd = smoothedEle[i + 1];

    let grade = 0;
    if (distance_m !== 0) {
      const rawGrade = (eleEnd - eleStart) / distance_m;
      grade = Math.max(-cfg.max_grade, Math.min(cfg.max_grade, rawGrade));
    }

    // neutral is based on the START cumulative distance (before this segment)
    const neutral = cumDist < cfg.neutral_distance_km * 1000;

    cumDist += distance_m;

    segments.push({
      index: i,
      distance_m,
      cum_distance_m: cumDist,
      grade,
      bearing_deg,
      lat: a.lat,
      lon: a.lon,
      ele_start_m: eleStart,
      ele_end_m: eleEnd,
      neutral,
    });
  }

  return segments;
}

// -------------------------------------------------------------------------
// ingestGpx
// -------------------------------------------------------------------------

/**
 * Full pipeline: parse -> dedup -> smooth -> build microsegments.
 */
export function ingestGpx(path: string, cfg: Config): MicroSegment[] {
  const pts = parseGpx(path);
  const deduped = dedupePoints(pts);
  const smoothedEle = smoothElevation(
    deduped.map((p) => p.ele),
    cfg.ele_smooth_window,
  );
  return buildMicroSegments(deduped, smoothedEle, cfg);
}
