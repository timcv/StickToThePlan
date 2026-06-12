// routeIsNetDownwind now weights by the hours/places actually ridden: it reads
// each effort segment's LOCAL wind at its approximate ride time, instead of one
// flat vector mean over every cell. These tests prove both axes of locality.

import { describe, it, expect } from 'vitest';
import type { MicroSegment } from '../src/types.js';
import { routeIsNetDownwind } from '../src/planner.js';
import type { EnsembleField, EnsembleCell } from '../src/weather/ensemble.js';

/** Two effort segments heading east (bearing 90) at the route location. */
function eastRoute(lat = 58.0, lon = 14.5): MicroSegment[] {
  return [1, 2].map((i) => ({
    index: i,
    distance_m: 1000,
    cum_distance_m: i * 1000,
    grade: 0,
    bearing_deg: 90,
    lat,
    lon,
    ele_start_m: 100,
    ele_end_m: 100,
    neutral: false,
  }));
}

function cell(time_iso: string, lat: number, dirFrom: number): EnsembleCell {
  return {
    time_iso,
    lat,
    lon: 14.5,
    windspeed_mean_ms: 6,
    winddir_from_deg: dirFrom,
    windspeed_p10_ms: 6,
    windspeed_p90_ms: 6,
    temp_c: 15,
    pressure_pa: 101_325,
    n_sources: 1,
  };
}

describe('routeIsNetDownwind ridden-hours weighting', () => {
  it('uses the local ridden cell, not a flat average dominated by far-away decoys', () => {
    const startEpochMs = Date.UTC(2026, 5, 13, 18, 0, 0);
    // Route heads east; the ridden cell has wind FROM 270 (west) -> pure tailwind.
    // Three decoy cells ~165 km north carry headwind (FROM 90); a flat field-mean
    // direction would point into the wind and (wrongly) report not-downwind.
    const field: EnsembleField = {
      cells: [
        cell('2026-06-13T18:00:00Z', 58.0, 270), // ridden, tailwind
        cell('2026-06-13T18:00:00Z', 59.5, 90), // decoy north, headwind
        cell('2026-06-13T18:00:00Z', 59.7, 90), // decoy north, headwind
        cell('2026-06-13T18:00:00Z', 59.9, 90), // decoy north, headwind
      ],
      sources: ['x'],
      reduced: true,
    };
    expect(routeIsNetDownwind(eastRoute(), field, startEpochMs, 3600)).toBe(true);
  });

  it('reads the wind at the ride time when the wind veers during the day', () => {
    // Same place; tailwind (FROM 270) early, headwind (FROM 90) late.
    const field: EnsembleField = {
      cells: [cell('2026-06-13T18:00:00Z', 58.0, 270), cell('2026-06-13T23:00:00Z', 58.0, 90)],
      sources: ['x'],
      reduced: true,
    };
    // Ride entirely around 18:00 (1 h total) -> early tailwind cell -> downwind.
    const earlyStart = Date.UTC(2026, 5, 13, 18, 0, 0);
    expect(routeIsNetDownwind(eastRoute(), field, earlyStart, 3600)).toBe(true);
    // Ride entirely around 23:00 -> late headwind cell -> not downwind.
    const lateStart = Date.UTC(2026, 5, 13, 23, 0, 0);
    expect(routeIsNetDownwind(eastRoute(), field, lateStart, 3600)).toBe(false);
  });
});
