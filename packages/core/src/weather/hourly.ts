/**
 * Per-clock-hour wind summary, user overrides, and manual field construction.
 *
 * The web UI shows wind "hour by hour" (route-wide). summarizeHourly collapses
 * the spatial ensemble to one vector-mean wind per hour for display.
 * applyHourlyOverrides folds the user's edits back onto the field;
 * buildManualField makes a field out of nothing but the user's numbers.
 */
import type { EnsembleField, EnsembleCell } from './ensemble.js';
import type { GeoPoint } from './openMeteo.js';

export interface HourlyWind {
  hour: number;          // hour of day 0..23
  dir_from_deg: number;  // meteorological from-direction
  speed_ms: number;
}

function hourOf(timeIso: string): number {
  return parseInt(timeIso.slice(11, 13), 10);
}

function vectorMean(cells: EnsembleCell[]): { dir: number; speed: number } {
  let u = 0, v = 0;
  for (const c of cells) {
    const rad = (c.winddir_from_deg * Math.PI) / 180;
    u += -c.windspeed_mean_ms * Math.sin(rad);
    v += -c.windspeed_mean_ms * Math.cos(rad);
  }
  const n = Math.max(1, cells.length);
  u /= n; v /= n;
  const speed = Math.hypot(u, v);
  const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { dir, speed };
}

/** One summary row per requested hour; empty hours fall back to the nearest. */
export function summarizeHourly(field: EnsembleField, hours: number[]): HourlyWind[] {
  const byHour = new Map<number, EnsembleCell[]>();
  for (const c of field.cells) {
    const h = hourOf(c.time_iso);
    const list = byHour.get(h);
    if (list) list.push(c);
    else byHour.set(h, [c]);
  }
  const available = [...byHour.keys()];
  return hours.map((hour) => {
    let cells = byHour.get(hour);
    if (!cells || cells.length === 0) {
      if (available.length === 0) return { hour, dir_from_deg: 0, speed_ms: 0 };
      const nearest = available.reduce((a, b) =>
        Math.abs(b - hour) < Math.abs(a - hour) ? b : a);
      cells = byHour.get(nearest)!;
    }
    const { dir, speed } = vectorMean(cells);
    return { hour, dir_from_deg: dir, speed_ms: speed };
  });
}

/** Return a new field with the given hours overridden (spread collapsed). */
export function applyHourlyOverrides(field: EnsembleField, overrides: HourlyWind[]): EnsembleField {
  const map = new Map(overrides.map((o) => [o.hour, o]));
  const cells = field.cells.map((c) => {
    const o = map.get(hourOf(c.time_iso));
    if (!o) return c;
    return {
      ...c,
      winddir_from_deg: o.dir_from_deg,
      windspeed_mean_ms: o.speed_ms,
      windspeed_p10_ms: o.speed_ms,
      windspeed_p90_ms: o.speed_ms,
    };
  });
  return { ...field, cells };
}

/** Build a synthetic field: one centroid cell per manual hourly entry. */
export function buildManualField(
  entries: HourlyWind[],
  raceDate: string,
  centroid: GeoPoint,
): EnsembleField {
  const cells: EnsembleCell[] = entries.map((e) => {
    const HH = String(e.hour).padStart(2, '0');
    return {
      time_iso: `${raceDate}T${HH}:00:00Z`,
      lat: centroid.lat, lon: centroid.lon,
      windspeed_mean_ms: e.speed_ms, winddir_from_deg: e.dir_from_deg,
      windspeed_p10_ms: e.speed_ms, windspeed_p90_ms: e.speed_ms,
      temp_c: 10, pressure_pa: 101_325, n_sources: 1,
    };
  });
  return { cells, sources: ['manual'], reduced: true };
}
