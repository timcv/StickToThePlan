import type { WindSample } from '../types.js';

export interface GeoPoint {
  lat: number;
  lon: number;
}

/**
 * Build the SMHI Open Data point forecast URL.
 * lon and lat are rounded to 6 decimal places as required by the API path format.
 */
export function buildSmhiUrl(point: GeoPoint): string {
  const lon = point.lon.toFixed(6);
  const lat = point.lat.toFixed(6);
  return `https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point/lon/${lon}/lat/${lat}/data.json`;
}

/**
 * Parse SMHI point forecast JSON into WindSample array.
 *
 * SMHI response shape:
 *   { timeSeries: [ { validTime: ISO, parameters: [ { name, values:[v] }, ... ] } ] }
 *
 * Parameters used:
 *   ws  - wind speed m/s
 *   wd  - wind direction degrees FROM (meteorological)
 *   t   - temperature Celsius
 *   msl - mean sea level pressure hPa (converted to Pa by multiplying by 100)
 *
 * Entries missing ws or wd are skipped.
 */
export function parseSmhi(json: any, point: GeoPoint): WindSample[] {
  const timeSeries: any[] = json?.timeSeries ?? [];
  const samples: WindSample[] = [];

  for (const entry of timeSeries) {
    const params: any[] = entry?.parameters ?? [];

    const findParam = (name: string): number | undefined => {
      const p = params.find((x: any) => x.name === name);
      return p?.values?.[0];
    };

    const ws = findParam('ws');
    const wd = findParam('wd');

    if (ws === undefined || wd === undefined) {
      continue;
    }

    const t = findParam('t') ?? 0;
    const msl = findParam('msl') ?? 1013;

    samples.push({
      time_iso: entry.validTime as string,
      lat: point.lat,
      lon: point.lon,
      windspeed_ms: ws,
      winddir_from_deg: wd,
      temp_c: t,
      pressure_pa: msl * 100,
      source: 'smhi',
    });
  }

  return samples;
}

/**
 * Fetch SMHI point forecast and parse to WindSample array.
 * Returns empty array on any network or parse error.
 */
export async function fetchSmhi(point: GeoPoint): Promise<WindSample[]> {
  try {
    const url = buildSmhiUrl(point);
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }
    const json = await response.json();
    return parseSmhi(json, point);
  } catch {
    return [];
  }
}
