import { describe, it, expect } from 'vitest';
import { solveThreeScenarios } from '../src/planner.js';
import { applyDefaults } from '../src/config.js';
import type { EnsembleField } from '../src/weather/ensemble.js';
import type { MicroSegment } from '../src/types.js';

function micros(n: number): MicroSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    distance_m: 1000,
    cum_distance_m: (i + 1) * 1000,
    grade: 0,
    bearing_deg: 0,
    lat: 59,
    lon: 16,
    ele_start_m: 0,
    ele_end_m: 0,
    neutral: false,
  }));
}

function field(p10: number, p90: number): EnsembleField {
  return {
    cells: [
      {
        time_iso: '2026-06-13T04:00:00Z',
        lat: 59,
        lon: 16,
        windspeed_mean_ms: (p10 + p90) / 2,
        winddir_from_deg: 0,
        windspeed_p10_ms: p10,
        windspeed_p90_ms: p90,
        temp_c: 12,
        pressure_pa: 101325,
        n_sources: 3,
      },
    ],
    sources: ['a', 'b', 'c'],
    reduced: false,
  };
}

const cfg = applyDefaults({
  gpx_path: 'r.gpx',
  race_date: '2026-06-13',
  start_time: '04:22',
  n_riders: 1,
  target_total_hm: '0:40',
  stops: [],
});

describe('time uncertainty interval', () => {
  it('puts expected inside [low, high]', () => {
    const s = solveThreeScenarios(micros(20), field(2, 8), cfg);
    const u = s.time_uncertainty_s;
    expect(u.source).toBe('scenario');
    expect(u.low).toBeLessThanOrEqual(u.expected + 1);
    expect(u.high).toBeGreaterThanOrEqual(u.expected - 1);
  });

  it('widens with more wind spread', () => {
    const narrow = solveThreeScenarios(micros(20), field(4, 6), cfg).time_uncertainty_s;
    const wide = solveThreeScenarios(micros(20), field(1, 12), cfg).time_uncertainty_s;
    expect(wide.high - wide.low).toBeGreaterThan(narrow.high - narrow.low);
  });
});
