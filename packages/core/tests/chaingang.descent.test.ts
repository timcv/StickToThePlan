import { describe, it, expect } from 'vitest';
import { applyDefaults } from '../src/config.js';
import { solveSpeedForRiderNp, riderNpAtSpeed } from '../src/chaingang.js';

// Regression tests for the descent wrong-root bug: on a steep descent the
// rider's pedal power goes negative (braking), and the fourth-power in NP made
// riderNpAtSpeed non-monotone, so the bisection solver landed on a spurious
// slow root (e.g. 8 km/h on a -8% grade). NP must treat braking/coasting as
// zero power so the solver finds the physically correct high-speed root.

const cfg = applyDefaults({
  race_date: '2026-06-13',
  start_time: '04:22',
  gpx_path: 'x',
  ftp: 272,
  n_riders: 12,
  target_total_hm: '11:45',
});
const NP = 163;
const RHO = 1.2;

describe('chaingang descent solver', () => {
  it('a descent is not slower than flat at the same NP target', () => {
    const flat = solveSpeedForRiderNp(NP, 0, 0, 0, RHO, cfg);
    const d2 = solveSpeedForRiderNp(NP, -0.02, 0, 0, RHO, cfg);
    const d8 = solveSpeedForRiderNp(NP, -0.08, 0, 0, RHO, cfg);
    expect(d2).toBeGreaterThanOrEqual(flat - 1e-6);
    expect(d8).toBeGreaterThanOrEqual(flat - 1e-6);
  });

  it('produces a realistic (not crawling) speed on a -8% descent', () => {
    const v = solveSpeedForRiderNp(NP, -0.08, 0, 0, RHO, cfg);
    // The bug returned 2.25 m/s (8.1 km/h). A real descent at this effort is fast.
    expect(v * 3.6).toBeGreaterThan(30);
  });

  it('riderNpAtSpeed is monotone non-decreasing in speed on a descent', () => {
    let prev = -Infinity;
    for (let v = 1; v <= 22; v += 0.5) {
      const np = riderNpAtSpeed(v, -0.08, 0, 0, RHO, cfg);
      expect(np).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = np;
    }
  });

  it('normalized power is never negative or NaN on a steep descent', () => {
    for (let v = 0.5; v <= 25; v += 0.5) {
      const np = riderNpAtSpeed(v, -0.12, 3, 2, RHO, cfg);
      expect(Number.isFinite(np)).toBe(true);
      expect(np).toBeGreaterThanOrEqual(0);
    }
  });
});
