import { describe, it, expect } from 'vitest';
import type { MicroSegment, Config } from '../src/types.js';
import { applyDefaults } from '../src/config.js';
import { calmWeather, runInnerSolve } from '../src/planner.js';

// A plan cannot show negative pedal power: on a gentle descent at low effort the
// draft rider freewheels, so its steady-state power goes negative. That is
// coasting, not pedaling, and the displayed p_pull_w/p_draft_w/p_mean_w must be
// clamped to zero for every segment, not only on a spin-out cap. (grade -3% at
// np 80 W reproduces a -4.5 W draft power before the clamp.)

function buildDescentRoute(grade: number, n = 50): MicroSegment[] {
  const segs: MicroSegment[] = [];
  let cum = 0;
  let ele = 1000;
  for (let i = 0; i < n; i++) {
    const distance_m = 100;
    cum += distance_m;
    const ele_end = ele + grade * distance_m;
    segs.push({
      index: i,
      distance_m,
      cum_distance_m: cum,
      grade,
      bearing_deg: 90,
      lat: 58.0,
      lon: 14.5,
      ele_start_m: ele,
      ele_end_m: ele_end,
      neutral: false,
    });
    ele = ele_end;
  }
  return segs;
}

const cfg: Config = applyDefaults({
  race_date: '2026-06-13',
  start_time: '04:22',
  gpx_path: 'x',
  ftp: 272,
  n_riders: 12,
  target_total_hm: '11:45',
  stops: [],
});

describe('planner descent power', () => {
  it('never reports negative pedal power on a gentle descent at low effort', () => {
    const plan = runInnerSolve(buildDescentRoute(-0.03), 80, calmWeather, cfg);
    for (const s of plan.segments) {
      expect(s.p_pull_w).toBeGreaterThanOrEqual(0);
      expect(s.p_draft_w).toBeGreaterThanOrEqual(0);
      expect(s.p_mean_w).toBeGreaterThanOrEqual(0);
    }
  });
});
