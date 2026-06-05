import type { GeoPoint, EnsembleField } from '@stp/core';

/** Round to the 0.1deg ensemble grid so the request URL (cache key) is canonical. */
function roundPt(p: GeoPoint): GeoPoint {
  return { lat: Math.round(p.lat * 10) / 10, lon: Math.round(p.lon * 10) / 10 };
}

export function buildPtsParam(points: GeoPoint[]): string {
  return points
    .map(roundPt)
    .map((p) => `${p.lat},${p.lon}`)
    .join('|');
}

/** Fetch the server-built ensemble for a date + route points. Throws on HTTP error. */
export async function fetchEnsemble(date: string, points: GeoPoint[]): Promise<EnsembleField> {
  const pts = buildPtsParam(points);
  const res = await fetch(
    `/api/weather?date=${encodeURIComponent(date)}&pts=${encodeURIComponent(pts)}`,
  );
  if (!res.ok) throw new Error(`Weather fetch failed (${res.status})`);
  return (await res.json()) as EnsembleField;
}
