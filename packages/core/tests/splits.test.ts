import { describe, it, expect } from 'vitest';
import type { MicroSegment, Config } from '../src/types.js';
import { applyDefaults } from '../src/config.js';
import { calmWeather, solveForTargetTime } from '../src/planner.js';
import type { ControlPoint } from '../src/segmentation.js';
import { buildSplitTable } from '../src/output/splits.js';

// ---------------------------------------------------------------------------
// Synthetic flat route: 300 segments x 200 m = 60 km total.
// Controls at 0, 20, 40, 60 km.  Stop at the 20 km control (5 min).
// ---------------------------------------------------------------------------

function buildRoute(n = 300, segLen = 200): MicroSegment[] {
  const segs: MicroSegment[] = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const startCum = cum;
    cum += segLen;
    segs.push({
      index: i,
      distance_m: segLen,
      cum_distance_m: cum,
      grade: 0,
      bearing_deg: 90,
      lat: 58.0,
      lon: 14.5,
      ele_start_m: 100,
      ele_end_m: 100,
      neutral: startCum < 1000,
    });
  }
  return segs;
}

const CONTROLS: ControlPoint[] = [
  { name: 'Start', km: 0 },
  { name: 'Alpha', km: 20 },
  { name: 'Beta', km: 40 },
  { name: 'Finish', km: 60 },
];

// One stop at the 20 km control (Alpha), 5 minutes.
const cfg: Config = applyDefaults({
  race_date: '2026-06-13',
  start_time: '04:22',
  gpx_path: 'x',
  ftp: 272,
  n_riders: 12,
  target_total_hm: '2:15',
  stops: [{ control: 'Alpha', km: 20, minutes: 5 }],
});

const micro = buildRoute();
const plan = solveForTargetTime(micro, calmWeather, cfg);

describe('buildSplitTable – synthetic 60 km route', () => {
  it('returns controls.length - 1 rows', () => {
    const rows = buildSplitTable(plan, cfg, CONTROLS);
    expect(rows.length).toBe(CONTROLS.length - 1);
  });

  it('every row has non-negative leg_distance_m and leg_time_s', () => {
    const rows = buildSplitTable(plan, cfg, CONTROLS);
    for (const row of rows) {
      expect(row.leg_distance_m).toBeGreaterThanOrEqual(0);
      expect(row.leg_time_s).toBeGreaterThanOrEqual(0);
    }
  });

  it('fromControl / toControl names match control array', () => {
    const rows = buildSplitTable(plan, cfg, CONTROLS);
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].fromControl).toBe(CONTROLS[i].name);
      expect(rows[i].toControl).toBe(CONTROLS[i + 1].name);
    }
  });

  it('depart_s === arrive_s + stop_minutes * 60 for every row', () => {
    const rows = buildSplitTable(plan, cfg, CONTROLS);
    for (const row of rows) {
      expect(row.depart_s).toBe(row.arrive_s + row.stop_minutes * 60);
    }
  });

  it('last row depart_s equals plan.total_time_s within 2 s', () => {
    const rows = buildSplitTable(plan, cfg, CONTROLS);
    // The last control has no stop, so depart_s === arrive_s.
    // arrive_s = rolling(all segments) + all stop times, which equals total_time_s.
    const lastRow = rows[rows.length - 1];
    expect(Math.abs(lastRow.depart_s - plan.total_time_s)).toBeLessThanOrEqual(2);
  });

  it('the leg with the stop (Alpha) has stop_minutes === 5', () => {
    const rows = buildSplitTable(plan, cfg, CONTROLS);
    const alphaRow = rows.find((r) => r.toControl === 'Alpha');
    expect(alphaRow).toBeDefined();
    expect(alphaRow!.stop_minutes).toBe(5);
  });
});
