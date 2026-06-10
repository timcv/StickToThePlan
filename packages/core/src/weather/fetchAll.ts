/**
 * Multi-source wind fetch (universal fetch; runs on a server or in Node).
 *
 * The URL builders + parsers are pure and live alongside this module; this file
 * performs the requests and the per-source isolation. Each source is wrapped so
 * a rejection or partial failure contributes nothing instead of failing the run.
 *
 * Per-point sources (SMHI, MET Norway, Open-Meteo ensemble) run with bounded
 * concurrency. The Open-Meteo forecast endpoint is batched to a single request.
 */
import {
  buildEnsembleUrl,
  parseOpenMeteo,
  fetchOpenMeteoForecastBatched,
  type GeoPoint,
} from './openMeteo.js';
import { buildSmhiUrl, parseSmhi } from './smhi.js';
import { buildMetNorwayUrl, metNorwayHeaders, parseMetNorway } from './metNorway.js';
import { fetchWithTimeout, FETCH_TIMEOUT_MS } from './http.js';
import type { WindSample } from '../types.js';

export { fetchWithTimeout, FETCH_TIMEOUT_MS } from './http.js';

/** Run `fn` over `items` with at most `limit` concurrent in-flight calls. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

const CONCURRENCY = 10;

export async function fetchSmhi(
  point: GeoPoint,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<WindSample[]> {
  try {
    const res = await fetchWithTimeout(buildSmhiUrl(point), {}, timeoutMs);
    if (!res.ok) return [];
    return parseSmhi(await res.json(), point);
  } catch {
    return [];
  }
}

export async function fetchMetNorway(
  point: GeoPoint,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<WindSample[]> {
  try {
    const res = await fetchWithTimeout(
      buildMetNorwayUrl(point),
      { headers: metNorwayHeaders() },
      timeoutMs,
    );
    if (!res.ok) return [];
    return parseMetNorway(await res.json(), point);
  } catch {
    return [];
  }
}

async function fetchOpenMeteoEnsemblePoint(point: GeoPoint, date: string): Promise<WindSample[]> {
  try {
    const res = await fetchWithTimeout(buildEnsembleUrl(point, date));
    if (!res.ok) return [];
    return parseOpenMeteo(await res.json(), point, 'open-meteo-ensemble');
  } catch {
    return [];
  }
}

/**
 * Gather wind samples from all sources for the given points + date.
 * Sources are isolated: each contributes whatever it can; none can fail the run.
 */
export async function gatherWindSamples(points: GeoPoint[], date: string): Promise<WindSample[]> {
  if (points.length === 0) return [];

  const [forecast, ensemble, smhi, met] = await Promise.all([
    fetchOpenMeteoForecastBatched(points, date),
    mapLimit(points, CONCURRENCY, (p) => fetchOpenMeteoEnsemblePoint(p, date)),
    mapLimit(points, CONCURRENCY, (p) => fetchSmhi(p)),
    mapLimit(points, CONCURRENCY, (p) => fetchMetNorway(p)),
  ]);

  return [forecast, ...ensemble, ...smhi, ...met].flat();
}
