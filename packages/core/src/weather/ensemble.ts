/**
 * Weather ensemble builder and WeatherFn factory.
 *
 * Aggregates WindSamples from multiple sources into spatially/temporally
 * binned EnsembleCells with vector-mean wind direction, percentile spread,
 * and arithmetic-mean temperature/pressure.
 */

import type { WindSample, WindCond, Scenario, WeatherFn } from '../types.js';
import { haversine } from '../util/geo.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EnsembleCell {
  time_iso: string;
  lat: number;
  lon: number;
  windspeed_mean_ms: number; // scalar mean of member speeds
  winddir_from_deg: number; // vector mean
  windspeed_p10_ms: number;
  windspeed_p90_ms: number;
  temp_c: number;
  pressure_pa: number;
  rel_humidity?: number; // 0..1 fraction, mean over samples that carry it
  n_sources: number;
}

export interface EnsembleField {
  cells: EnsembleCell[];
  sources: string[];
  reduced: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Compute a percentile value from a sorted (ascending) array using linear
 * interpolation. p is in [0, 1].
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Round a coordinate to 1 decimal place for spatial grouping (~11 km bin).
 */
function roundCoord(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Truncate an ISO-8601 timestamp to the hour: "2026-06-13T06:32:00Z" -> "2026-06-13T06".
 */
function truncateToHour(timeIso: string): string {
  // e.g. "2026-06-13T06:00:00Z" -> "2026-06-13T06"
  return timeIso.slice(0, 13);
}

/**
 * Extract the hour of day (0-23) from an ISO-8601 string.
 * Works for both "2026-06-13T06:00:00Z" and "2026-06-13T06:00" forms.
 */
function hourOfDay(timeIso: string): number {
  const t = timeIso.slice(11, 13);
  return parseInt(t, 10);
}

// ---------------------------------------------------------------------------
// buildEnsemble
// ---------------------------------------------------------------------------

/**
 * Provider identity of a sample source: ensemble members ("xxx_member03") all
 * belong to one provider. Keeps n_sources / the reduced flag meaning "how many
 * independent providers answered" rather than counting members.
 */
function providerOf(source: string): string {
  return source.replace(/_member\d+$/, '');
}

/** A sample is usable only if every field the physics consumes is finite. */
function isFiniteSample(s: WindSample): boolean {
  return (
    Number.isFinite(s.windspeed_ms) &&
    Number.isFinite(s.winddir_from_deg) &&
    Number.isFinite(s.temp_c) &&
    Number.isFinite(s.pressure_pa)
  );
}

/**
 * Aggregate WindSamples into EnsembleCells.
 *
 * Non-finite samples (NaN/Infinity in any physics-relevant field) are dropped
 * before aggregation so one bad sample cannot poison a cell.
 *
 * Grouping key: (rounded lat, rounded lon, truncated-to-hour time_iso).
 * Within each group:
 *   - Wind speed: scalar arithmetic mean of member speeds. (A vector-mean
 *     magnitude would cancel when members disagree on direction and bias the
 *     expected wind low, even below p10.)
 *   - Wind direction: vector mean via u/v components
 *       u = -W * sin(rad(dirFrom))
 *       v = -W * cos(rad(dirFrom))
 *     winddir_from_deg  = (toDeg(atan2(-meanU, -meanV)) + 360) % 360
 *   - windspeed_p10/p90: 10th/90th percentile of scalar wind speeds
 *   - temp_c, pressure_pa: arithmetic mean; rel_humidity: mean over samples
 *     that carry a finite value (absent if none do)
 *   - n_sources: count of distinct `source` values in the group
 *
 * Field-level:
 *   - sources: all distinct source strings across all samples
 *   - reduced: true if distinct source count < 3
 */
export function buildEnsemble(rawSamples: WindSample[]): EnsembleField {
  const samples = rawSamples.filter(isFiniteSample);

  // Collect all distinct providers across the whole field (members collapse)
  const allSources = new Set<string>();
  for (const s of samples) {
    allSources.add(providerOf(s.source));
  }

  // Group samples by (roundedLat, roundedLon, hourKey)
  const groups = new Map<string, WindSample[]>();
  for (const s of samples) {
    const key = `${roundCoord(s.lat)}|${roundCoord(s.lon)}|${truncateToHour(s.time_iso)}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = [];
      groups.set(key, group);
    }
    group.push(s);
  }

  const cells: EnsembleCell[] = [];

  for (const [, group] of groups) {
    // Vector-mean wind direction, scalar-mean speed
    let sumU = 0;
    let sumV = 0;
    let sumSpeed = 0;
    const speeds: number[] = [];
    let sumTemp = 0;
    let sumPressure = 0;
    let sumRh = 0;
    let nRh = 0;
    const groupSources = new Set<string>();

    // Use the first sample's rounded coords and truncated time as cell representative
    const rep = group[0];
    const cellLat = roundCoord(rep.lat);
    const cellLon = roundCoord(rep.lon);
    const cellTimeIso = truncateToHour(rep.time_iso) + ':00:00Z';

    for (const s of group) {
      const rad = toRad(s.winddir_from_deg);
      const u = -s.windspeed_ms * Math.sin(rad);
      const v = -s.windspeed_ms * Math.cos(rad);
      sumU += u;
      sumV += v;
      sumSpeed += s.windspeed_ms;
      speeds.push(s.windspeed_ms);
      sumTemp += s.temp_c;
      sumPressure += s.pressure_pa;
      if (s.rel_humidity !== undefined && Number.isFinite(s.rel_humidity)) {
        sumRh += s.rel_humidity;
        nRh++;
      }
      groupSources.add(providerOf(s.source));
    }

    const n = group.length;
    const meanU = sumU / n;
    const meanV = sumV / n;

    const windspeed_mean_ms = sumSpeed / n;
    const winddir_from_deg = (toDeg(Math.atan2(-meanU, -meanV)) + 360) % 360;

    speeds.sort((a, b) => a - b);
    const windspeed_p10_ms = percentile(speeds, 0.1);
    const windspeed_p90_ms = percentile(speeds, 0.9);

    cells.push({
      time_iso: cellTimeIso,
      lat: cellLat,
      lon: cellLon,
      windspeed_mean_ms,
      winddir_from_deg,
      windspeed_p10_ms,
      windspeed_p90_ms,
      temp_c: sumTemp / n,
      pressure_pa: sumPressure / n,
      ...(nRh > 0 ? { rel_humidity: sumRh / nRh } : {}),
      n_sources: groupSources.size,
    });
  }

  const sourcesArray = Array.from(allSources).sort();
  const reduced = allSources.size < 3;

  return { cells, sources: sourcesArray, reduced };
}

// ---------------------------------------------------------------------------
// makeWeatherFn
// ---------------------------------------------------------------------------

/**
 * Return a WeatherFn for the given EnsembleField and Scenario.
 *
 * For each query (lat, lon, timeS):
 *   1. Convert timeS (seconds from race start) to hour-of-day using startClockS.
 *      startClockS MUST be the UTC start clock (utcStartClockSeconds): cells are
 *      binned on UTC hours, while the planner's elapsed march is timezone-free.
 *   2. Find the best matching cell using a two-stage approach:
 *      a. Find cells nearest in space (haversine).
 *      b. Among those, pick the one nearest in time (absolute hour difference).
 *      (Implemented as a single pass with a normalized combined score.)
 *   3. Return WindCond with windspeed selected by scenario.
 *
 * Cell selection is memoized per (lat, lon, hour): the planner re-queries the
 * same microsegment coordinates on every bisection iteration, and the O(cells)
 * haversine scan dominated solver runtime. The cache is exact, not an
 * approximation, because the score depends only on (lat, lon, queryHour).
 *
 * Scenario -> percentile mapping. Optimistic = best (fastest) case, pessimistic
 * = worst (slowest). On a route that is NET INTO the wind, more wind is slower,
 * so pessimistic = p90 and optimistic = p10. On a NET DOWNWIND route more wind is
 * *faster*, so the mapping inverts: pessimistic = p10 (least tailwind = slowest),
 * optimistic = p90. The caller (solveThreeScenarios) decides which case the route
 * is in by projecting the route onto the mean wind direction and passes
 * `favorableWind`. For a loop (net exposure ~ 0) head/tail cancel and either
 * choice is near-identical; we keep favorableWind=false so the convex "more wind
 * is slightly slower" default holds. Manual wind has p10=p90=mean, so the mapping
 * is moot. (spec 10.2, 10.5; supersedes the old magnitude-only approximation.)
 *
 * @param favorableWind  true when the route is net downwind (more wind => faster),
 *                       which swaps the optimistic/pessimistic percentiles.
 */
export function makeWeatherFn(
  field: EnsembleField,
  scenario: Scenario,
  startClockS: number,
  favorableWind = false,
): WeatherFn {
  const { cells } = field;

  if (cells.length === 0) {
    // Fallback: return calm wind
    return (_lat, _lon, _timeS) => ({
      windspeed_ms: 0,
      winddir_from_deg: 0,
      temp_c: 10,
      pressure_pa: 101_325,
    });
  }

  const cellCache = new Map<string, EnsembleCell>();

  return (lat: number, lon: number, timeS: number): WindCond => {
    // Convert timeS (seconds from race start) to UTC hour-of-day
    const queryHour = Math.floor(((startClockS + timeS) % 86400) / 3600);

    const cacheKey = `${lat}|${lon}|${queryHour}`;
    let bestCell = cellCache.get(cacheKey);

    if (bestCell === undefined) {
      // Find best cell: minimize combined score of spatial distance and time distance.
      // We normalize space by a reference distance (100 km = 100_000 m) and time
      // by a reference (12 hours). This ensures nearby cells in both dimensions are
      // preferred, with spatial proximity weighted slightly more.
      const SPACE_REF_M = 100_000;
      const TIME_REF_H = 12;

      bestCell = cells[0];
      let bestScore = Infinity;

      for (const cell of cells) {
        const distM = haversine({ lat, lon }, { lat: cell.lat, lon: cell.lon });
        const cellHour = hourOfDay(cell.time_iso);
        const hourDiff = Math.abs(cellHour - queryHour);
        // Wrap hour difference for crossing midnight (e.g. hour 23 vs 1 -> diff 2)
        const wrappedHourDiff = Math.min(hourDiff, 24 - hourDiff);

        const score = distM / SPACE_REF_M + wrappedHourDiff / TIME_REF_H;

        if (score < bestScore) {
          bestScore = score;
          bestCell = cell;
        }
      }
      cellCache.set(cacheKey, bestCell);
    }

    const pLow = bestCell.windspeed_p10_ms;
    const pHigh = bestCell.windspeed_p90_ms;
    let windspeed_ms: number;
    switch (scenario) {
      case 'optimistic':
        // Best case: less wind on a net-headwind route, more wind if net downwind.
        windspeed_ms = favorableWind ? pHigh : pLow;
        break;
      case 'pessimistic':
        // Worst case: more wind on a net-headwind route, less wind if net downwind.
        windspeed_ms = favorableWind ? pLow : pHigh;
        break;
      case 'expected':
      default:
        windspeed_ms = bestCell.windspeed_mean_ms;
        break;
    }

    return {
      windspeed_ms,
      winddir_from_deg: bestCell.winddir_from_deg,
      temp_c: bestCell.temp_c,
      pressure_pa: bestCell.pressure_pa,
      ...(bestCell.rel_humidity !== undefined ? { rel_humidity: bestCell.rel_humidity } : {}),
    };
  };
}
