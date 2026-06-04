/**
 * Pure-ish weather request handler, decoupled from the Vercel runtime so it can
 * be unit-tested with a mocked global fetch. api/weather.ts is the thin adapter.
 */
import { gatherWindSamples, buildEnsemble, type GeoPoint, type EnsembleField } from '@stp/core';

export interface WeatherQuery {
  date?: string | string[];
  pts?: string | string[];
}

export interface WeatherResult {
  status: number;
  headers: Record<string, string>;
  body: EnsembleField | { error: string };
}

const CACHE_HEADER = 'public, s-maxage=10800, stale-while-revalidate=86400';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// This is a public endpoint: each point fans out to 1 + 3N upstream fetches per
// cache miss (Open-Meteo forecast batched, plus ensemble + SMHI + MET Norway per
// point). Cap the count so a caller cannot turn one request into thousands of
// upstream hits. sampleCellPoints yields ~44 for the 315 km route, so 64 is ample.
const MAX_POINTS = 64;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse + validate the query. Returns null when invalid. */
export function parseWeatherQuery(q: WeatherQuery): { date: string; points: GeoPoint[] } | null {
  const date = first(q.date);
  const pts = first(q.pts);
  if (!date || !ISO_DATE.test(date) || !pts) return null;

  const points: GeoPoint[] = [];
  for (const pair of pts.split('|')) {
    const [latS, lonS] = pair.split(',');
    // Reject empty halves: Number('') is 0 (finite), so "58.5," would otherwise
    // slip through as lon=0 instead of being rejected.
    if (!latS || !lonS) return null;
    const lat = Number(latS), lon = Number(lonS);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    points.push({ lat, lon });
  }
  if (points.length === 0 || points.length > MAX_POINTS) return null;
  return { date, points };
}

export async function handleWeather(q: WeatherQuery): Promise<WeatherResult> {
  const parsed = parseWeatherQuery(q);
  if (!parsed) {
    return { status: 400, headers: {}, body: { error: 'bad query: require date=YYYY-MM-DD&pts=lat,lon|...' } };
  }
  const samples = await gatherWindSamples(parsed.points, parsed.date);
  const field = buildEnsemble(samples);
  return {
    status: 200,
    headers: { 'Cache-Control': CACHE_HEADER, 'Content-Type': 'application/json' },
    body: field,
  };
}
