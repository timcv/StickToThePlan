// Geodetic utilities for bearing and distance calculations.
// Uses WGS-84 mean radius R = 6 371 000 m (spec section 6 implicit).

const R = 6_371_000; // metres

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Haversine great-circle distance between two points.
 * @returns distance in metres
 */
export function haversine(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Forward azimuth (bearing) from a to b.
 * Due north = 0, due east = 90, due south = 180, due west = 270.
 * @returns bearing in degrees [0, 360)
 */
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const theta = Math.atan2(y, x);
  return (toDeg(theta) + 360) % 360;
}
