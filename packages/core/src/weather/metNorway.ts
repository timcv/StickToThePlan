import type { WindSample } from '../types.js';

export interface GeoPoint {
  lat: number;
  lon: number;
}

/**
 * Build the MET Norway Locationforecast 2.0 compact endpoint URL.
 */
export function buildMetNorwayUrl(point: GeoPoint): string {
  return `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${point.lat}&lon=${point.lon}`;
}

/**
 * Return required headers for MET Norway API requests.
 * MET Norway requires a descriptive User-Agent identifying the application and a contact address.
 */
export function metNorwayHeaders(): Record<string, string> {
  return {
    'User-Agent': 'StickToThePlan/1.0 vatternrundan-raceplan (tim@haus.se)',
  };
}

/**
 * Parse MET Norway Locationforecast 2.0 compact JSON into WindSample array.
 *
 * MET Norway response shape:
 *   { properties: { timeseries: [ {
 *       time: ISO,
 *       data: { instant: { details: {
 *         wind_speed,
 *         wind_from_direction,
 *         air_temperature,
 *         air_pressure_at_sea_level
 *       } } }
 *   } ] } }
 *
 * pressure_pa = air_pressure_at_sea_level (hPa) * 100.
 * Entries with missing details are skipped.
 */
export function parseMetNorway(json: any, point: GeoPoint): WindSample[] {
  const timeseries: any[] = json?.properties?.timeseries ?? [];
  const samples: WindSample[] = [];

  for (const entry of timeseries) {
    const details = entry?.data?.instant?.details;
    if (!details) {
      continue;
    }

    const windSpeed: number | undefined = details.wind_speed;
    const windDir: number | undefined = details.wind_from_direction;

    if (windSpeed === undefined || windDir === undefined) {
      continue;
    }

    const temp: number = details.air_temperature ?? 0;
    const pressureHpa: number = details.air_pressure_at_sea_level ?? 1013;

    samples.push({
      time_iso: entry.time as string,
      lat: point.lat,
      lon: point.lon,
      windspeed_ms: windSpeed,
      winddir_from_deg: windDir,
      temp_c: temp,
      pressure_pa: pressureHpa * 100,
      source: 'met-norway',
    });
  }

  return samples;
}
