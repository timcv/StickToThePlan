/**
 * Network weather fetching (Node + global fetch). The url builders and parsers
 * are pure and live in @stp/core; this module performs the actual requests and
 * the multi-source orchestration the cli uses.
 */

import {
  fetchOpenMeteo,
  buildSmhiUrl,
  parseSmhi,
  buildMetNorwayUrl,
  metNorwayHeaders,
  parseMetNorway,
  type GeoPoint,
  type WindSample,
} from '@stp/core';

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

/**
 * Fetch MET Norway point forecast and parse to WindSample array.
 * Passes the required User-Agent header. Returns empty array on any error.
 */
export async function fetchMetNorway(point: GeoPoint): Promise<WindSample[]> {
  try {
    const url = buildMetNorwayUrl(point);
    const response = await fetch(url, { headers: metNorwayHeaders() });
    if (!response.ok) {
      return [];
    }
    const json = await response.json();
    return parseMetNorway(json, point);
  } catch {
    return [];
  }
}

/**
 * Gather wind samples from all three sources, isolating each source so a dead
 * one contributes nothing instead of failing the run.
 *
 * Open-Meteo is queried for all points at once (it batches internally). SMHI
 * and MET Norway are point endpoints, so they are queried per point. Every
 * call is wrapped so a rejection or partial failure never propagates.
 */
export async function gatherWindSamples(points: GeoPoint[], date: string): Promise<WindSample[]> {
  const all: WindSample[] = [];

  // Open-Meteo (forecast + ensemble) for all points.
  try {
    all.push(...(await fetchOpenMeteo(points, date)));
  } catch {
    // Dead source: contribute nothing.
  }

  // SMHI and MET Norway: per-point point forecasts.
  for (const point of points) {
    try {
      all.push(...(await fetchSmhi(point)));
    } catch {
      // Dead source for this point: skip.
    }
    try {
      all.push(...(await fetchMetNorway(point)));
    } catch {
      // Dead source for this point: skip.
    }
  }

  return all;
}
