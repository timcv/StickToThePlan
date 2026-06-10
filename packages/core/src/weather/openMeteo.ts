/**
 * Open-Meteo weather client.
 *
 * Callers should reduce the ~4820 microsegments to ~10 representative sample
 * points to bound API calls. Each point triggers two fetches (forecast +
 * ensemble), so 10 points = 20 requests, each returning 24 hourly entries.
 */

import { fetchWithTimeout } from './http.js';
import type { WindSample } from '../types.js';

export interface GeoPoint {
  lat: number;
  lon: number;
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

const HOURLY_PARAMS = 'windspeed_10m,winddirection_10m,temperature_2m,surface_pressure';

/**
 * Build a query string where the hourly field keeps literal commas.
 * URLSearchParams percent-encodes commas, but Open-Meteo expects raw commas
 * in the hourly parameter value.
 */
function buildQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2C/gi, ',')}`)
    .join('&');
}

export function buildForecastUrl(point: GeoPoint, date: string): string {
  const q = buildQuery({
    latitude: String(point.lat),
    longitude: String(point.lon),
    hourly: HOURLY_PARAMS,
    windspeed_unit: 'ms',
    start_date: date,
    end_date: date,
    timezone: 'UTC',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export function buildEnsembleUrl(point: GeoPoint, date: string): string {
  const q = buildQuery({
    latitude: String(point.lat),
    longitude: String(point.lon),
    hourly: HOURLY_PARAMS,
    windspeed_unit: 'ms',
    models: 'icon_seamless',
    start_date: date,
    end_date: date,
    timezone: 'UTC',
  });
  return `https://ensemble-api.open-meteo.com/v1/ensemble?${q}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Convert an Open-Meteo JSON response to an array of WindSample values.
 *
 * The API returns surface_pressure in hPa; multiply by 100 to get Pa.
 * Wind speed is already in m/s because we requested windspeed_unit=ms.
 * Wind direction is meteorological from-direction (no conversion needed).
 */
export function parseOpenMeteo(
  json: any,
  point: GeoPoint,
  source = 'open-meteo-forecast',
): WindSample[] {
  const h = json?.hourly;
  if (!h) return [];

  const times: string[] = h.time ?? [];
  const speeds: number[] = h.windspeed_10m ?? [];
  const dirs: number[] = h.winddirection_10m ?? [];
  const temps: number[] = h.temperature_2m ?? [];
  const pressures: number[] = h.surface_pressure ?? [];

  const samples: WindSample[] = [];
  for (let i = 0; i < times.length; i++) {
    samples.push({
      time_iso: times[i],
      lat: point.lat,
      lon: point.lon,
      windspeed_ms: speeds[i],
      winddir_from_deg: dirs[i],
      temp_c: temps[i],
      pressure_pa: pressures[i] * 100, // hPa to Pa
      source,
    });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Batched multi-point forecast
// ---------------------------------------------------------------------------

/**
 * Build a single forecast URL covering many points via comma-separated
 * latitude/longitude lists. Open-Meteo returns an array of location objects in
 * the same order. Bounds the forecast endpoint to ONE request for the route.
 */
export function buildForecastUrlMulti(points: GeoPoint[], date: string): string {
  const q = buildQuery({
    latitude: points.map((p) => p.lat).join(','),
    longitude: points.map((p) => p.lon).join(','),
    hourly: HOURLY_PARAMS,
    windspeed_unit: 'ms',
    start_date: date,
    end_date: date,
    timezone: 'UTC',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/**
 * Parse a batched Open-Meteo response. When multiple coordinates are requested
 * the API returns an array (one element per point); a single coordinate returns
 * one object. Each element maps to points[i].
 */
export function parseOpenMeteoBatch(
  json: any,
  points: GeoPoint[],
  source = 'open-meteo-forecast',
): WindSample[] {
  const arr = Array.isArray(json) ? json : [json];
  const out: WindSample[] = [];
  for (let i = 0; i < arr.length && i < points.length; i++) {
    out.push(...parseOpenMeteo(arr[i], points[i], source));
  }
  return out;
}

/**
 * Fetch the batched forecast for all points in one request. Returns [] on error
 * so a dead source never blocks the rest of the pipeline.
 */
export async function fetchOpenMeteoForecastBatched(
  points: GeoPoint[],
  date: string,
): Promise<WindSample[]> {
  if (points.length === 0) return [];
  try {
    const res = await fetchWithTimeout(buildForecastUrlMulti(points, date));
    if (!res.ok) return [];
    const json = await res.json();
    return parseOpenMeteoBatch(json, points, 'open-meteo-forecast');
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Fetch forecast and ensemble data for a set of geographic points.
 *
 * Each fetch is wrapped in try/catch; a failed request returns [] so a dead
 * source never blocks the rest of the pipeline. The caller should log which
 * sources answered via the source field on each WindSample.
 */
export async function fetchOpenMeteo(points: GeoPoint[], date: string): Promise<WindSample[]> {
  const all: WindSample[] = [];

  for (const point of points) {
    // Forecast
    try {
      const res = await fetch(buildForecastUrl(point, date));
      const json = await res.json();
      all.push(...parseOpenMeteo(json, point, 'open-meteo-forecast'));
    } catch {
      // Dead source: return nothing for this fetch, continue with others
    }

    // Ensemble
    try {
      const res = await fetch(buildEnsembleUrl(point, date));
      const json = await res.json();
      all.push(...parseOpenMeteo(json, point, 'open-meteo-ensemble'));
    } catch {
      // Dead source: return nothing for this fetch, continue with others
    }
  }

  return all;
}
