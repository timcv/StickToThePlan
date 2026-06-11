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

const HOURLY_PARAMS =
  'windspeed_10m,winddirection_10m,temperature_2m,surface_pressure,relativehumidity_2m';

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
 * The API returns surface_pressure in hPa; multiply by 100 to get Pa, and
 * relativehumidity_2m in percent; divide by 100 to get a fraction.
 * Wind speed is already in m/s because we requested windspeed_unit=ms.
 * Wind direction is meteorological from-direction (no conversion needed).
 *
 * Ensemble responses carry one extra array set per member
 * (windspeed_10m_member01, ...). Each member becomes its own sample series
 * (source suffixed `-mNN`) so buildEnsemble's p10/p90 reflects the real
 * ensemble spread instead of just the control run. Member arrays missing a
 * variable fall back to the control arrays.
 *
 * Rows with a non-finite speed/direction/temp/pressure are skipped.
 */
export function parseOpenMeteo(
  json: any,
  point: GeoPoint,
  source = 'open-meteo-forecast',
): WindSample[] {
  const h = json?.hourly;
  if (!h) return [];

  const times: string[] = h.time ?? [];
  const samples: WindSample[] = [];

  const pushSeries = (
    speeds: number[],
    dirs: number[],
    temps: number[],
    pressures: number[],
    humidities: number[],
    seriesSource: string,
  ): void => {
    for (let i = 0; i < times.length; i++) {
      const windspeed_ms = speeds[i];
      const winddir_from_deg = dirs[i];
      const temp_c = temps[i];
      const pressure_pa = pressures[i] * 100; // hPa to Pa
      if (
        !Number.isFinite(windspeed_ms) ||
        !Number.isFinite(winddir_from_deg) ||
        !Number.isFinite(temp_c) ||
        !Number.isFinite(pressure_pa)
      ) {
        continue;
      }
      const rh = humidities[i];
      samples.push({
        time_iso: times[i],
        lat: point.lat,
        lon: point.lon,
        windspeed_ms,
        winddir_from_deg,
        temp_c,
        pressure_pa,
        ...(Number.isFinite(rh) ? { rel_humidity: rh / 100 } : {}), // % to fraction
        source: seriesSource,
      });
    }
  };

  const ctrlSpeeds: number[] = h.windspeed_10m ?? [];
  const ctrlDirs: number[] = h.winddirection_10m ?? [];
  const ctrlTemps: number[] = h.temperature_2m ?? [];
  const ctrlPressures: number[] = h.surface_pressure ?? [];
  const ctrlHumidities: number[] = h.relativehumidity_2m ?? [];

  pushSeries(ctrlSpeeds, ctrlDirs, ctrlTemps, ctrlPressures, ctrlHumidities, source);

  // Ensemble members: hourly keys like "windspeed_10m_member01".
  const memberSuffixes = Object.keys(h)
    .filter((k) => k.startsWith('windspeed_10m_member'))
    .map((k) => k.slice('windspeed_10m'.length))
    .sort();
  for (const suf of memberSuffixes) {
    pushSeries(
      h['windspeed_10m' + suf] ?? [],
      h['winddirection_10m' + suf] ?? ctrlDirs,
      h['temperature_2m' + suf] ?? ctrlTemps,
      h['surface_pressure' + suf] ?? ctrlPressures,
      h['relativehumidity_2m' + suf] ?? ctrlHumidities,
      `${source}${suf}`,
    );
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
