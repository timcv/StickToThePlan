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
import { STANDARD_ATMOSPHERE } from '../physics.js';

export interface HourlyWind {
  hour: number; // hour of day 0..23
  dir_from_deg: number; // meteorological from-direction
  speed_ms: number;
}

function hourOf(timeIso: string): number {
  return parseInt(timeIso.slice(11, 13), 10);
}

function vectorMean(cells: EnsembleCell[]): { dir: number; speed: number } {
  let u = 0,
    v = 0;
  for (const c of cells) {
    const rad = (c.winddir_from_deg * Math.PI) / 180;
    u += -c.windspeed_mean_ms * Math.sin(rad);
    v += -c.windspeed_mean_ms * Math.cos(rad);
  }
  const n = Math.max(1, cells.length);
  u /= n;
  v /= n;
  const speed = Math.hypot(u, v);
  const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { dir, speed };
}

/** Absolute UTC hour index (epoch ms / 3.6e6) of a cell's timestamp. */
function cellHourIndex(c: EnsembleCell): number {
  return Math.floor(Date.parse(c.time_iso) / 3_600_000);
}

/** Cells in the absolute hour nearest to targetHourIndex (fallback when the exact hour is absent). */
function nearestHourCells(field: EnsembleField, targetHourIndex: number): EnsembleCell[] {
  if (field.cells.length === 0) return [];
  let bestIdx = cellHourIndex(field.cells[0]);
  let bestDiff = Infinity;
  for (const c of field.cells) {
    const diff = Math.abs(cellHourIndex(c) - targetHourIndex);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = cellHourIndex(c);
    }
  }
  return field.cells.filter((c) => cellHourIndex(c) === bestIdx);
}

/**
 * One summary row per requested hour-of-day. Empty hours fall back to the nearest.
 *
 * With a multi-day field (race_date + next day), the same hour-of-day appears on
 * two dates. Pass startEpochMs (the absolute UTC instant of race start) so each
 * requested hour resolves to its RIDE-WINDOW occurrence (the first matching UTC
 * hour at-or-after the start) instead of vector-meaning both days together. When
 * startEpochMs is omitted the legacy hour-of-day behavior is used (single-day
 * field).
 */
export function summarizeHourly(
  field: EnsembleField,
  hours: number[],
  startEpochMs?: number,
): HourlyWind[] {
  if (startEpochMs !== undefined) {
    const startHourIndex = Math.floor(startEpochMs / 3_600_000);
    return hours.map((hour) => {
      const wantHour = ((hour % 24) + 24) % 24;
      // First absolute hour at-or-after the start whose UTC hour === wantHour.
      let idx = startHourIndex;
      while (((new Date(idx * 3_600_000).getUTCHours() % 24) + 24) % 24 !== wantHour) idx++;
      const matching = field.cells.filter((c) => cellHourIndex(c) === idx);
      const cells = matching.length > 0 ? matching : nearestHourCells(field, idx);
      if (cells.length === 0) return { hour, dir_from_deg: 0, speed_ms: 0 };
      const { dir, speed } = vectorMean(cells);
      return { hour, dir_from_deg: dir, speed_ms: speed };
    });
  }

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
      const nearest = available.reduce((a, b) => (Math.abs(b - hour) < Math.abs(a - hour) ? b : a));
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
      lat: centroid.lat,
      lon: centroid.lon,
      windspeed_mean_ms: e.speed_ms,
      winddir_from_deg: e.dir_from_deg,
      windspeed_p10_ms: e.speed_ms,
      windspeed_p90_ms: e.speed_ms,
      temp_c: STANDARD_ATMOSPHERE.temp_c,
      pressure_pa: STANDARD_ATMOSPHERE.pressure_pa,
      n_sources: 1,
    };
  });
  return { cells, sources: ['manual'], reduced: true };
}
