import { describe, it, expect } from 'vitest';
import type { MicroSegment, SegmentPlan, PlanResult, Config } from '../src/types.js';
import { applyDefaults } from '../src/config.js';
import { segment, VATTERN_CONTROLS, type ControlPoint } from '../src/segmentation.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal SegmentPlan from a MicroSegment and overrides.
// ---------------------------------------------------------------------------
function makeSeg(micro: MicroSegment, overrides: Partial<SegmentPlan> = {}): SegmentPlan {
  return {
    micro,
    v_ms: 8,
    speed_kmh: 28.8,
    p_pull_w: 150,
    p_draft_w: 100,
    p_mean_w: 110,
    rider_np_w: 163,
    time_s: micro.distance_m / 8,
    eta_s: micro.cum_distance_m / 8,
    headwind_ms: 0,
    crosswind_ms: 0,
    rho: 1.2,
    cap_binding: 'none',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: build synthetic MicroSegment list.
// n segments, each 1000 m (so total = n km).
// climbRanges: array of [start, end) index ranges that get grade = 0.05 (5%).
// gradeAlt: alternate grade +0.04 / -0.04 on each segment.
// ---------------------------------------------------------------------------
function buildMicros(
  n: number,
  climbRanges?: Array<[number, number]>,
  gradeAlt?: boolean,
): MicroSegment[] {
  const segs: MicroSegment[] = [];
  let cum = 0;
  let ele = 100;
  for (let i = 0; i < n; i++) {
    const distance_m = 1000;
    const inClimb = climbRanges?.some(([s, e]) => i >= s && i < e) ?? false;
    const grade = gradeAlt ? (i % 2 === 0 ? 0.04 : -0.04) : inClimb ? 0.05 : 0;
    cum += distance_m;
    const ele_end = ele + grade * distance_m;
    segs.push({
      index: i,
      distance_m,
      cum_distance_m: cum,
      grade,
      bearing_deg: 90,
      lat: 58.0 + i * 0.01,
      lon: 14.5,
      ele_start_m: ele,
      ele_end_m: ele_end,
      neutral: i === 0,
    });
    ele = ele_end;
  }
  return segs;
}

// Build a PlanResult from a list of SegmentPlan.
// eta_s is cumulative (each seg adds its time), with optional stop at km 30.
function buildPlanResult(segs: SegmentPlan[], stopMinutesAt30: number = 0): PlanResult {
  const stopAddS = stopMinutesAt30 * 60;
  let elapsed = 0;
  const adjusted = segs.map((s) => {
    const time_s = s.micro.distance_m / s.v_ms;
    elapsed += time_s;
    const eta_s = elapsed + (s.micro.cum_distance_m > 30000 ? stopAddS : 0);
    return { ...s, time_s, eta_s };
  });

  return {
    np_target_used: 163,
    total_time_s: elapsed + stopAddS,
    rolling_time_s: elapsed,
    stop_time_s: stopAddS,
    segments: adjusted,
    stops: stopMinutesAt30 > 0
      ? [{
          control: 'Mid',
          km: 30,
          minutes: stopMinutesAt30,
          arrive_s: adjusted.find(s => s.micro.cum_distance_m >= 30000)?.eta_s ?? 0,
          depart_s: (adjusted.find(s => s.micro.cum_distance_m >= 30000)?.eta_s ?? 0) + stopAddS,
        }]
      : [],
    reachable: true,
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Config for the synthetic tests.
// controls = [{name:'Start',km:0},{name:'Mid',km:30},{name:'End',km:60}]
// stops = [{control:'Mid',km:30,minutes:10}]
//
// NOTE: Climb is placed at indices 15-24 (km 15-25), so it ends BEFORE the
// depot at km 30. This means there will be a separate KLÄTTRING group (km
// 15-25) and a separate flat group before the depot (km 25-30, note DEPÅ).
// ---------------------------------------------------------------------------
const CONTROLS: ControlPoint[] = [
  { name: 'Start', km: 0 },
  { name: 'Mid', km: 30 },
  { name: 'End', km: 60 },
];

const BASE_CFG: Config = applyDefaults({
  race_date: '2026-06-13',
  start_time: '04:22',
  gpx_path: 'x',
  ftp: 272,
  n_riders: 12,
  target_total_hm: '11:45',
  stops: [{ control: 'Mid', km: 30, minutes: 10 }],
});

// ---------------------------------------------------------------------------
// SUITE 1: Main synthetic test with TWO climb sectors and a stop at km 30.
// 60 segments, 1000 m each = 60 km total.
// Climb A: indices 5-14 (km 5-15) -- note will be KLÄTTRING (not the last climb).
// Climb B: indices 45-54 (km 45-55) -- note will be SISTA UPPFÖR (last climb).
// Depot at km 30 (control 'Mid', 10 min stop).
// This ensures a distinct KLÄTTRING group (climb A) exists.
// ---------------------------------------------------------------------------
describe('segment() synthetic 60-segment route', () => {
  // Two climb ranges: indices 5-14 and 45-54.
  const micros = buildMicros(60, [[5, 15], [45, 55]]);
  const plans = micros.map((m, i) => {
    const inClimb = (i >= 5 && i < 15) || (i >= 45 && i < 55);
    return makeSeg(m, {
      v_ms: inClimb ? 5 : 8,
      p_pull_w: inClimb ? 250 : 150,
      p_draft_w: inClimb ? 200 : 100,
      p_mean_w: inClimb ? 210 : 110,
    });
  });

  const planResult = buildPlanResult(plans, 10);
  const result = segment(planResult, BASE_CFG, CONTROLS);

  it('returns an array of DisplaySegment', () => {
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('total segment count is <= 50', () => {
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('boundaries include km 0, 30, and 60', () => {
    const fromKms = result.map(s => s.from_km);
    const toKms = result.map(s => s.to_km);
    // Route starts at 0
    expect(fromKms[0]).toBeCloseTo(0, 0);
    // Route ends at 60
    expect(toKms[toKms.length - 1]).toBeCloseTo(60, 0);
    // km 30 must appear as a boundary (either a to_km or a from_km)
    const has30 = toKms.some(k => Math.abs(k - 30) < 0.5) || fromKms.some(k => Math.abs(k - 30) < 0.5);
    expect(has30).toBe(true);
  });

  it('at least one segment has note KLÄTTRING', () => {
    const climbSegs = result.filter(s => s.note === 'KLÄTTRING');
    expect(climbSegs.length).toBeGreaterThan(0);
  });

  it('segment ending at km 30 has note DEPÅ and stop_minutes 10', () => {
    const depot = result.find(s => Math.abs(s.to_km - 30) < 0.5);
    expect(depot).toBeDefined();
    expect(depot!.note).toBe('DEPÅ');
    expect(depot!.stop_minutes).toBe(10);
  });

  it('depot segment has depart_s set and depart_s > eta_s', () => {
    const depot = result.find(s => Math.abs(s.to_km - 30) < 0.5);
    expect(depot!.depart_s).toBeDefined();
    expect(depot!.depart_s!).toBeGreaterThan(depot!.eta_s);
  });

  it('conservation: sum of distance_m equals plan total distance', () => {
    const totalDist = result.reduce((acc, s) => acc + s.distance_m, 0);
    const planDist = planResult.segments.reduce((acc, s) => acc + s.micro.distance_m, 0);
    expect(Math.abs(totalDist - planDist)).toBeLessThan(1);
  });

  it('conservation: micro_indices cover every input segment exactly once', () => {
    const allIndices = result.flatMap(s => s.micro_indices);
    allIndices.sort((a, b) => a - b);
    expect(allIndices.length).toBe(planResult.segments.length);
    for (let i = 0; i < planResult.segments.length; i++) {
      expect(allIndices[i]).toBe(i);
    }
  });

  it('each display segment has valid numeric fields', () => {
    for (const s of result) {
      expect(typeof s.from_km).toBe('number');
      expect(typeof s.to_km).toBe('number');
      expect(s.to_km).toBeGreaterThan(s.from_km);
      expect(typeof s.distance_m).toBe('number');
      expect(s.distance_m).toBeGreaterThan(0);
      expect(typeof s.eta_s).toBe('number');
      expect(typeof s.wind_label).toBe('string');
      expect(typeof s.note).toBe('string');
    }
  });

  it('KLÄTTRING segments have avg_grade > climb_threshold', () => {
    const climbSegs = result.filter(s => s.note === 'KLÄTTRING' || s.note === 'SISTA UPPFÖR');
    for (const s of climbSegs) {
      expect(s.avg_grade).toBeGreaterThan(BASE_CFG.climb_threshold - 0.001);
    }
  });

  it('BACKAR segments have avg_grade < -climb_threshold', () => {
    const downSegs = result.filter(s => s.note === 'BACKAR');
    for (const s of downSegs) {
      expect(s.avg_grade).toBeLessThan(-BASE_CFG.climb_threshold + 0.001);
    }
  });

  it('pull_w_low <= pull_w_high for all segments', () => {
    for (const s of result) {
      expect(s.pull_w_low).toBeLessThanOrEqual(s.pull_w_high);
    }
  });

  it('wind_label is a non-empty string for all segments', () => {
    for (const s of result) {
      expect(s.wind_label.length).toBeGreaterThan(0);
    }
  });

  it('flat calm segment before the first climb has note JÄMN FART', () => {
    // First group (km 0-5) should be flat and calm.
    const preclimb = result.find(s => s.to_km <= 5);
    expect(preclimb?.note).toBe('JÄMN FART');
  });

  it('KLÄTTRING segment covers the first climb indices (5-14)', () => {
    const climb = result.find(s => s.note === 'KLÄTTRING');
    expect(climb).toBeDefined();
    // The climb A group must include indices 5 through 14.
    const minIdx = Math.min(...climb!.micro_indices);
    const maxIdx = Math.max(...climb!.micro_indices);
    expect(minIdx).toBe(5);
    expect(maxIdx).toBe(14);
  });

  it('last climb (indices 45-54) has note SISTA UPPFÖR', () => {
    const sista = result.find(s => s.note === 'SISTA UPPFÖR');
    expect(sista).toBeDefined();
    const minIdx = Math.min(...sista!.micro_indices);
    const maxIdx = Math.max(...sista!.micro_indices);
    expect(minIdx).toBe(45);
    expect(maxIdx).toBe(54);
  });
});

// ---------------------------------------------------------------------------
// SUITE 2: Forced > 50 boundaries -- alternating grade on each of 60 segments.
// This creates grade-flip transitions at every segment, yielding many boundaries.
// Assert that the merge brings count to <= 50.
// ---------------------------------------------------------------------------
describe('segment() merge: alternating grades force >50 boundaries before merge', () => {
  const micros = buildMicros(60, undefined, true);
  const plans = micros.map((m, i) => {
    const isUp = i % 2 === 0;
    return makeSeg(m, {
      v_ms: isUp ? 5 : 9,
      p_pull_w: isUp ? 230 : 130,
      p_draft_w: isUp ? 180 : 90,
      p_mean_w: isUp ? 185 : 95,
    });
  });

  const planResult = buildPlanResult(plans, 0);

  // Use minimal controls and no stops.
  const minCfg: Config = applyDefaults({
    race_date: '2026-06-13',
    start_time: '04:22',
    gpx_path: 'x',
    ftp: 272,
    n_riders: 12,
    target_total_hm: '11:45',
    stops: [],
  });
  const minControls: ControlPoint[] = [
    { name: 'Start', km: 0 },
    { name: 'End', km: 60 },
  ];

  const result = segment(planResult, minCfg, minControls);

  it('result count is <= 50 after merge', () => {
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('conservation still holds after merge: sum distance_m == plan total', () => {
    const totalDist = result.reduce((acc, s) => acc + s.distance_m, 0);
    const planDist = planResult.segments.reduce((acc, s) => acc + s.micro.distance_m, 0);
    expect(Math.abs(totalDist - planDist)).toBeLessThan(1);
  });

  it('micro_indices cover every segment exactly once after merge', () => {
    const allIndices = result.flatMap(s => s.micro_indices);
    allIndices.sort((a, b) => a - b);
    expect(allIndices.length).toBe(planResult.segments.length);
    for (let i = 0; i < planResult.segments.length; i++) {
      expect(allIndices[i]).toBe(i);
    }
  });
});

// ---------------------------------------------------------------------------
// SUITE 3: VATTERN_CONTROLS constant.
// ---------------------------------------------------------------------------
describe('VATTERN_CONTROLS', () => {
  it('has 11 entries', () => {
    expect(VATTERN_CONTROLS.length).toBe(11);
  });

  it('starts at Motala km 0', () => {
    expect(VATTERN_CONTROLS[0].name).toContain('Motala');
    expect(VATTERN_CONTROLS[0].km).toBe(0);
  });

  it('ends at km 315', () => {
    const last = VATTERN_CONTROLS[VATTERN_CONTROLS.length - 1];
    expect(last.km).toBe(315);
  });

  it('contains Hjo at km 173', () => {
    const hjo = VATTERN_CONTROLS.find(c => c.name === 'Hjo');
    expect(hjo).toBeDefined();
    expect(hjo!.km).toBe(173);
  });

  it('all km values are strictly increasing', () => {
    for (let i = 1; i < VATTERN_CONTROLS.length; i++) {
      expect(VATTERN_CONTROLS[i].km).toBeGreaterThan(VATTERN_CONTROLS[i - 1].km);
    }
  });
});

// ---------------------------------------------------------------------------
// SUITE 4: Wind label tests.
// Use a longer route (20 segments) so we get distinct non-neutral segments.
// The wind label is tested on segments from_km > 1 to avoid the neutral block.
// ---------------------------------------------------------------------------
describe('segment() wind labels', () => {
  // Build a 20-segment route (1000 m each = 20 km) with uniform wind.
  function makeWindPlan(headwind: number, crosswind: number): PlanResult {
    const micros = buildMicros(20);
    const plans = micros.map(m =>
      makeSeg(m, { headwind_ms: headwind, crosswind_ms: crosswind }),
    );
    const planResult = buildPlanResult(plans, 0);
    return planResult;
  }

  const noStopCfg: Config = applyDefaults({
    race_date: '2026-06-13',
    start_time: '04:22',
    gpx_path: 'x',
    ftp: 272,
    n_riders: 12,
    target_total_hm: '2:00',
    stops: [],
  });
  // Controls span 0 to 20 km with a mid-point to ensure multiple segments.
  const simpleControls: ControlPoint[] = [
    { name: 'Start', km: 0 },
    { name: 'Mid', km: 10 },
    { name: 'End', km: 20 },
  ];

  it('strong headwind gives Mot label (non-neutral segments)', () => {
    const plan = makeWindPlan(5, 0);
    const segs = segment(plan, noStopCfg, simpleControls);
    // At least one non-neutral segment (from_km > 0) should have Mot label.
    const withMot = segs.filter(s => s.wind_label.startsWith('Mot'));
    expect(withMot.length).toBeGreaterThan(0);
  });

  it('strong tailwind gives Med label', () => {
    const plan = makeWindPlan(-5, 0);
    const segs = segment(plan, noStopCfg, simpleControls);
    const withMed = segs.filter(s => s.wind_label.startsWith('Med'));
    expect(withMed.length).toBeGreaterThan(0);
  });

  it('strong crosswind with calm head gives Sido label', () => {
    const plan = makeWindPlan(0, 5);
    const segs = segment(plan, noStopCfg, simpleControls);
    const withSido = segs.filter(s => s.wind_label.startsWith('Sido'));
    expect(withSido.length).toBeGreaterThan(0);
  });

  it('calm wind gives Lugnt label on all segments', () => {
    const plan = makeWindPlan(0, 0);
    const segs = segment(plan, noStopCfg, simpleControls);
    expect(segs.every(s => s.wind_label === 'Lugnt')).toBe(true);
  });
});
