import { describe, it, expect } from 'vitest';
import type { MicroSegment, Config, WindCond, WeatherFn } from '../src/types.js';
import { applyDefaults } from '../src/config.js';
import { runInnerSolve } from '../src/planner.js';

// Flat synthetic route travelling due east (bearing 90). First 10 segments are
// the neutral km (cum_distance_m < 1000). 100 m each.
function buildFlatRoute(n = 400): MicroSegment[] {
  const segs: MicroSegment[] = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += 100;
    segs.push({
      index: i,
      distance_m: 100,
      cum_distance_m: cum,
      grade: 0,
      bearing_deg: 90,
      lat: 58.0,
      lon: 14.5,
      ele_start_m: 100,
      ele_end_m: 100,
      neutral: cum - 100 < 1000,
    });
  }
  return segs;
}

// Constant-wind WeatherFn. winddir_from_deg 90 + bearing 90 = pure headwind;
// winddir_from_deg 270 = pure tailwind.
function wind(dirFrom: number, speed: number): WeatherFn {
  return (): WindCond => ({
    windspeed_ms: speed,
    winddir_from_deg: dirFrom,
    temp_c: 15,
    pressure_pa: 101_325,
  });
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
const micro = buildFlatRoute(400);

describe('spin-out / planning-speed ceiling', () => {
  // Strong tailwind + high effort would push flat speed well past 50 km/h.
  const plan = runInnerSolve(micro, 220, wind(270, 12), cfg, 0);
  const effort = plan.segments.filter((s) => !s.micro.neutral);

  it('no effort segment exceeds max_plan_speed_kmh', () => {
    for (const s of effort) {
      expect(s.speed_kmh).toBeLessThanOrEqual(cfg.max_plan_speed_kmh + 1e-6);
    }
  });

  it('the ceiling actually binds (some segment is spin-out capped)', () => {
    expect(effort.some((s) => s.cap_binding === 'spinout')).toBe(true);
  });

  it('spin-out segments never show negative pedal power', () => {
    for (const s of effort.filter((s) => s.cap_binding === 'spinout')) {
      expect(s.p_pull_w).toBeGreaterThanOrEqual(0);
      expect(s.p_draft_w).toBeGreaterThanOrEqual(0);
      expect(s.p_mean_w).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('raised hard pull cap unblocks headwind speed', () => {
  // Into a 9 m/s headwind a rider NP of 230 W requires front pulls above FTP.
  // The old cap (= ftp) would have clamped them; the new cap (1.3*ftp) allows
  // the short supra-threshold pull, so the rider uses sustainable NP headroom.
  const plan = runInnerSolve(micro, 230, wind(90, 9), cfg, 0);
  const effort = plan.segments.filter((s) => !s.micro.neutral);

  it('at least one front pull runs above FTP (supra-threshold 45 s pull)', () => {
    expect(effort.some((s) => s.p_pull_w > cfg.ftp)).toBe(true);
  });

  it('no pull exceeds the hard cap (1.3 * ftp)', () => {
    for (const s of effort) {
      expect(s.p_pull_w).toBeLessThanOrEqual(cfg.pull_cap_hard + 1e-6);
    }
  });

  it('rider ride-NP stays at/below the held target (sustainability bound)', () => {
    expect(plan.rider_np_ride_w).toBeLessThanOrEqual(230 + 1);
  });
});

describe('intensity factor + sustainability warning', () => {
  it('intensity_factor === rider_np_ride_w / ftp', () => {
    const plan = runInnerSolve(micro, 200, wind(90, 6), cfg, 0);
    expect(plan.intensity_factor).toBeCloseTo(plan.rider_np_ride_w / cfg.ftp, 6);
  });

  it('a hard plan (high NP) emits an IF sustainability note', () => {
    const plan = runInnerSolve(micro, 260, wind(90, 6), cfg, 0);
    expect(plan.intensity_factor).toBeGreaterThan(cfg.sustain_if_warn);
    expect(plan.notes.some((n) => n.includes('IF'))).toBe(true);
  });

  it('an easy plan (low NP) emits no IF note', () => {
    const plan = runInnerSolve(micro, 150, wind(0, 0), cfg, 0);
    expect(plan.intensity_factor).toBeLessThan(cfg.sustain_if_warn);
    expect(plan.notes.some((n) => n.includes('IF'))).toBe(false);
  });
});
