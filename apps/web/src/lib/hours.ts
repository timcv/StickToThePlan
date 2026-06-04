import type { GeoPoint } from '@stp/core';

/** Clock hours (0..23) the rider is on course: floor(start) .. ceil(start+target). */
export function raceHours(startTime: string, targetHm: string): number[] {
  const [sh, sm] = startTime.split(':').map(Number);
  const [th, tm] = targetHm.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = startMin + th * 60 + tm;
  const firstHour = Math.floor(startMin / 60);
  const lastHour = Math.floor(endMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h <= lastHour; h++) hours.push(((h % 24) + 24) % 24);
  return hours;
}

export function centroidOf(points: GeoPoint[]): GeoPoint {
  if (points.length === 0) return { lat: 0, lon: 0 };
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lon = points.reduce((s, p) => s + p.lon, 0) / points.length;
  return { lat, lon };
}
