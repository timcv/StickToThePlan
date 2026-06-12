import { describe, it, expect } from 'vitest';
import type { PlanResult } from '../src/types.js';
import {
  styrkortMeta,
  diffToStraightMin,
  formatDiff,
  formatAnkomst,
} from '../src/output/styrkort.js';

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
