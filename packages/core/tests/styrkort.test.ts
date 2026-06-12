import { describe, it, expect } from 'vitest';
import type { PlanResult, DisplaySegment } from '../src/types.js';
import {
  styrkortMeta,
  diffToStraightMin,
  styrkortDiffsMin,
  formatDiff,
  formatAnkomst,
} from '../src/output/styrkort.js';

function row(to_km: number, eta_s: number, stop_minutes?: number): DisplaySegment {
  return {
    from_km: 0,
    to_km,
    distance_m: to_km * 1000,
    net_height_m: 0,
    avg_grade: 0,
    avg_speed_kmh: 28,
    eta_s,
    wind_label: 'Lugnt',
    pull_w_mean: 150,
    pull_w_low: 145,
    pull_w_high: 155,
    avg_w: 130,
    note: 'JÄMN FART',
    micro_indices: [],
    ...(stop_minutes !== undefined ? { stop_minutes, depart_s: eta_s + stop_minutes * 60 } : {}),
  };
}

function makePlan(total_time_s: number, rolling_time_s: number): PlanResult {
  return {
    np_target_used: 160,
    rider_np_ride_w: 160,
    intensity_factor: 0.6,
    total_time_s,
    rolling_time_s,
    stop_time_s: total_time_s - rolling_time_s,
    segments: [],
    stops: [],
    reachable: true,
    notes: [],
  };
}

describe('styrkortMeta', () => {
  it('computes rolling and stops-included averages from the plan', () => {
    // 100 km over 12000 s rolling (3h20m) = 30 km/h; over 15000 s total = 24 km/h.
    const meta = styrkortMeta(makePlan(15000, 12000), 100_000);
    expect(meta.refSpeedKmh).toBeCloseTo(30, 6);
    expect(meta.totalAvgKmh).toBeCloseTo(24, 6);
  });

  it('matches the spec reference of ~28.85 km/h for the canonical plan', () => {
    // 314.9 km, rolling time picked so refSpeed lands on 28.85.
    const rolling = (314.9 / 28.85) * 3600;
    const meta = styrkortMeta(makePlan(rolling + 49 * 60, rolling), 314_900);
    expect(meta.refSpeedKmh).toBeCloseTo(28.85, 2);
  });

  it('returns 0 instead of NaN/Infinity when a divisor is non-positive', () => {
    const meta = styrkortMeta(makePlan(0, 0), 0);
    expect(meta.refSpeedKmh).toBe(0);
    expect(meta.totalAvgKmh).toBe(0);
  });
});

describe('diffToStraightMin', () => {
  it('matches the spec example: 77 km, arrival 07:14 from 04:22 start -> -12', () => {
    // 07:14 - 04:22 = 2h52m = 10320 s elapsed.
    expect(diffToStraightMin(77, 10320, 28.85)).toBe(-12);
  });

  it('is positive when arrival is ahead of the reference line', () => {
    // Reference at 30 km = 1 h (3600 s) at 30 km/h; arrive after 3000 s -> +10 min.
    expect(diffToStraightMin(30, 3000, 30)).toBe(10);
  });

  it('is zero when arrival matches the reference line', () => {
    expect(diffToStraightMin(30, 3600, 30)).toBe(0);
  });

  it('guards against a non-positive reference speed', () => {
    expect(diffToStraightMin(30, 3600, 0)).toBe(0);
  });
});

describe('styrkortDiffsMin', () => {
  const ref = 28.85;

  it('does not let a prior depot stop drag a later row (depot time excluded)', () => {
    // Depot at 77 km (10 min), then a normal row at 105 km whose arrival eta
    // already includes the 10-min stop.
    const segs = [row(77, 10320, 10), row(105, 14414)];
    const diffs = styrkortDiffsMin(segs, ref);
    expect(diffs[0]).toBe(-12); // the row's own stop is not counted
    expect(diffs[1]).toBe(-12); // prior 10 min removed; raw wall-clock would be -22
  });

  it('lands the finish row on ±0 (rolling reference, all stops excluded)', () => {
    const dist = 314.9;
    const rollingFinishS = (dist / ref) * 3600;
    const stopsS = 50 * 60;
    const segs = [
      row(150, 18000, 50), // one depot carrying all 50 min of stops
      row(dist, rollingFinishS + stopsS), // finish eta includes those 50 min
    ];
    const diffs = styrkortDiffsMin(segs, ref);
    expect(diffs[1]).toBe(0);
  });
});

describe('formatDiff', () => {
  it('prefixes positive values with +', () => {
    expect(formatDiff(8)).toBe('+8');
  });
  it('keeps the minus on negative values', () => {
    expect(formatDiff(-12)).toBe('-12');
  });
  it('shows zero as ±0', () => {
    expect(formatDiff(0)).toBe('±0');
  });
});

describe('formatAnkomst', () => {
  it('renders a normal passage as HH:MM (±X)', () => {
    expect(formatAnkomst('08:26', -25)).toBe('08:26 (-25)');
  });

  it('renders a depot as HH:MM (±X, HH:MM) without the word "ut"', () => {
    const out = formatAnkomst('07:14', -12, '07:24');
    expect(out).toBe('07:14 (-12, 07:24)');
    expect(out).not.toContain('ut');
  });

  it('renders a positive diff with the + sign', () => {
    expect(formatAnkomst('05:47', 3)).toBe('05:47 (+3)');
  });
});
