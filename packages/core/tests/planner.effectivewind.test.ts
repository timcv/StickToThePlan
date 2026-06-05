import { describe, it, expect } from 'vitest';
import { runInnerSolve } from '../src/planner.js';
import { applyDefaults } from '../src/config.js';
import type { MicroSegment, WeatherFn } from '../src/types.js';

function flatMicros(n: number): MicroSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    distance_m: 1000,
    cum_distance_m: (i + 1) * 1000,
    grade: 0,
    bearing_deg: 0, // travelling north
    lat: 59,
    lon: 16,
    ele_start_m: 0,
    ele_end_m: 0,
    neutral: false,
  }));
}

// Wind from the north (0 deg) = pure headwind on a northbound segment.
const headwind6: WeatherFn = () => ({
  windspeed_ms: 6,
  winddir_from_deg: 0,
  temp_c: 15,
  pressure_pa: 101325,
});

describe('effective wind in the planner', () => {
  const cfg = applyDefaults({
    gpx_path: 'r.gpx',
    race_date: '2026-06-13',
    start_time: '04:22',
    n_riders: 1,
    target_total_hm: '10:00',
    stops: [],
  });

  it('reduces effective headwind below the raw forecast', () => {
    const plan = runInnerSolve(flatMicros(5), 150, headwind6, cfg, 0);
    const seg = plan.segments[0];
    expect(seg.raw_windspeed_ms).toBeCloseTo(6, 6);
    expect(seg.eff_windspeed_ms).toBeLessThan(6);
    expect(seg.eff_windspeed_ms).toBeGreaterThan(0);
    expect(seg.headwind_ms).toBeCloseTo(seg.eff_windspeed_ms, 6);
  });

  it('escape hatch: apply_wind_height_correction=false uses raw wind', () => {
    const raw = applyDefaults({
      gpx_path: 'r.gpx',
      race_date: '2026-06-13',
      start_time: '04:22',
      n_riders: 1,
      target_total_hm: '10:00',
      stops: [],
      apply_wind_height_correction: false,
    });
    const plan = runInnerSolve(flatMicros(5), 150, headwind6, raw, 0);
    expect(plan.segments[0].eff_windspeed_ms).toBeCloseTo(6, 6);
  });

  it('calm wind is unchanged (0 -> 0)', () => {
    const calm: WeatherFn = () => ({
      windspeed_ms: 0,
      winddir_from_deg: 0,
      temp_c: 15,
      pressure_pa: 101325,
    });
    const plan = runInnerSolve(flatMicros(3), 150, calm, cfg, 0);
    expect(plan.segments[0].eff_windspeed_ms).toBe(0);
    expect(plan.segments[0].headwind_ms).toBeCloseTo(0, 9);
  });

  it('per-segment z0_used overrides the global roughness', () => {
    const water = flatMicros(3).map((m) => ({ ...m, z0_used: 0.001 }));
    const urban = flatMicros(3).map((m) => ({ ...m, z0_used: 0.5 }));
    const wPlan = runInnerSolve(water, 150, headwind6, cfg, 0);
    const uPlan = runInnerSolve(urban, 150, headwind6, cfg, 0);
    // smooth water keeps more wind at rider level than rough urban
    expect(wPlan.segments[0].eff_windspeed_ms).toBeGreaterThan(uPlan.segments[0].eff_windspeed_ms);
    expect(wPlan.segments[0].z0_used).toBe(0.001);
  });
});
