import { describe, it, expect } from 'vitest';
import {
  summarizeHourly,
  applyHourlyOverrides,
  buildManualField,
  type HourlyWind,
} from '../src/weather/hourly.js';
import type { EnsembleField } from '../src/weather/ensemble.js';

function cell(hour: number, dir: number, speed: number) {
  const HH = String(hour).padStart(2, '0');
  return {
    time_iso: `2026-06-13T${HH}:00:00Z`,
    lat: 58.5,
    lon: 14.6,
    windspeed_mean_ms: speed,
    winddir_from_deg: dir,
    windspeed_p10_ms: speed - 1,
    windspeed_p90_ms: speed + 1,
    temp_c: 10,
    pressure_pa: 101_325,
    n_sources: 3,
  };
}

const field: EnsembleField = {
  cells: [cell(6, 90, 4), cell(7, 180, 6)],
  sources: ['a', 'b', 'c'],
  reduced: false,
};

describe('summarizeHourly', () => {
  it('returns one row per requested hour', () => {
    const rows = summarizeHourly(field, [6, 7]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ hour: 6 });
    expect(Math.round(rows[0].dir_from_deg)).toBe(90);
    expect(Math.round(rows[0].speed_ms)).toBe(4);
  });

  it('falls back to the nearest hour when a requested hour has no cells', () => {
    const rows = summarizeHourly(field, [9]);
    expect(rows).toHaveLength(1);
    expect(Math.round(rows[0].speed_ms)).toBe(6); // hour 7 is nearest
  });

  it('resolves the ride-window day for a multi-day field when given startEpochMs', () => {
    // Same hour-of-day (06) on two dates with different wind; only the absolute
    // start instant tells the solver which day the ride actually covers.
    const multiDay: EnsembleField = {
      cells: [cell(6, 90, 4), { ...cell(6, 270, 9), time_iso: '2026-06-14T06:00:00Z' }],
      sources: ['a', 'b', 'c'],
      reduced: false,
    };
    // Ride starts 2026-06-13 20:00 UTC -> hour 06 occurs on 2026-06-14 (the 270/9 cell).
    const startEpochMs = Date.UTC(2026, 5, 13, 20, 0, 0);
    const [row] = summarizeHourly(multiDay, [6], startEpochMs);
    expect(Math.round(row.dir_from_deg)).toBe(270);
    expect(Math.round(row.speed_ms)).toBe(9);
  });
});

describe('applyHourlyOverrides', () => {
  it('overrides only the named hour and collapses its spread', () => {
    const overrides: HourlyWind[] = [{ hour: 6, dir_from_deg: 0, speed_ms: 10 }];
    const out = applyHourlyOverrides(field, overrides);
    const h6 = out.cells.find((c) => c.time_iso.includes('T06'))!;
    const h7 = out.cells.find((c) => c.time_iso.includes('T07'))!;
    expect(h6.winddir_from_deg).toBe(0);
    expect(h6.windspeed_mean_ms).toBe(10);
    expect(h6.windspeed_p10_ms).toBe(10);
    expect(h6.windspeed_p90_ms).toBe(10);
    expect(h7.winddir_from_deg).toBe(180); // untouched
    expect(field.cells[0].winddir_from_deg).toBe(90); // input not mutated
  });
});

describe('buildManualField', () => {
  it('creates one centroid cell per entry', () => {
    const entries: HourlyWind[] = [
      { hour: 6, dir_from_deg: 270, speed_ms: 5 },
      { hour: 7, dir_from_deg: 270, speed_ms: 5 },
    ];
    const out = buildManualField(entries, '2026-06-13', { lat: 58.4, lon: 14.5 });
    expect(out.cells).toHaveLength(2);
    expect(out.cells[0].time_iso).toBe('2026-06-13T06:00:00Z');
    expect(out.cells[0].lat).toBe(58.4);
    expect(out.sources).toEqual(['manual']);
    expect(out.reduced).toBe(true);
  });
});
