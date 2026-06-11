// Weather-clock correctness (math review M1, M7, M8):
//  - runInnerSolve passes elapsed seconds from race start to the WeatherFn
//    (the contract), with stop time included in the march clock.
//  - makeWeatherFn anchors hour selection to a UTC start clock, so a local
//    CEST start matches UTC-binned cells.
//  - rel_humidity flows into air density; humid air is less dense.
//  - solveForTargetTime notes when the target is slower than the minimum-effort plan.

import { describe, it, expect } from 'vitest';
import type { MicroSegment, Config, WeatherFn, WindSample } from '../src/types.js';
import { applyDefaults } from '../src/config.js';
import { runInnerSolve, solveForTargetTime, calmWeather } from '../src/planner.js';
import { buildEnsemble, makeWeatherFn } from '../src/weather/ensemble.js';
import { utcStartClockSeconds } from '../src/util/time.js';

function makeConfig(overrides: Record<string, unknown> = {}): Config {
  return applyDefaults({
    race_date: '2026-06-13',
    start_time: '06:00',
    gpx_path: 'x',
    ftp: 272,
    n_riders: 12,
    target_total_hm: '11:45',
    stops: [],
    ...overrides,
  });
}

/** n flat 1 km microsegments heading east; first km neutral. */
function flatMicros(n: number): MicroSegment[] {
  const out: MicroSegment[] = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const distance_m = 1000;
    const neutral = cum < 1000;
    cum += distance_m;
    out.push({
      index: i,
      distance_m,
      cum_distance_m: cum,
      grade: 0,
      bearing_deg: 90,
      lat: 58.0,
      lon: 14.5,
      ele_start_m: 100,
      ele_end_m: 100,
      neutral,
    });
  }
  return out;
}

describe('runInnerSolve weather clock', () => {
  it('passes elapsed seconds from start (timeS = 0-ish at km 1, not the wall clock)', () => {
    const cfg = makeConfig();
    const seen: number[] = [];
    const recorder: WeatherFn = (_lat, _lon, timeS) => {
      seen.push(timeS);
      return { windspeed_ms: 0, winddir_from_deg: 0, temp_c: 15, pressure_pa: 101325 };
    };
    runInnerSolve(flatMicros(5), 163, recorder, cfg);
    // First effort segment starts after the 1 km neutral: elapsed = 1000 m at
    // neutral_speed (20 km/h) = 180 s. NOT 06:00 (21600 s) + 180.
    expect(seen[0]).toBeCloseTo(180, 0);
    expect(seen[0]).toBeLessThan(3600);
  });

  it('includes stop minutes in the march clock for segments after the stop', () => {
    const cfg = makeConfig({ stops: [{ control: 'Mitt', km: 3, minutes: 10 }] });
    const seen: Array<{ timeS: number }> = [];
    const recorder: WeatherFn = (_lat, _lon, timeS) => {
      seen.push({ timeS });
      return { windspeed_ms: 0, winddir_from_deg: 0, temp_c: 15, pressure_pa: 101325 };
    };
    const cfgNoStop = makeConfig();
    const seenNoStop: number[] = [];
    const recorderNoStop: WeatherFn = (_lat, _lon, timeS) => {
      seenNoStop.push(timeS);
      return { windspeed_ms: 0, winddir_from_deg: 0, temp_c: 15, pressure_pa: 101325 };
    };

    runInnerSolve(flatMicros(6), 163, recorder, cfg);
    runInnerSolve(flatMicros(6), 163, recorderNoStop, cfgNoStop);

    // Effort segments: km1-2, 2-3, 3-4, 4-5, 5-6 -> 5 queries each run.
    expect(seen).toHaveLength(5);
    // The stop attaches to the segment ENDING at km 3, so queries up to and
    // including km2-3 are identical; every query after it shifts by 600 s.
    expect(seen[0].timeS).toBeCloseTo(seenNoStop[0], 6);
    expect(seen[1].timeS).toBeCloseTo(seenNoStop[1], 6);
    expect(seen[2].timeS).toBeCloseTo(seenNoStop[2] + 600, 6);
    expect(seen[3].timeS).toBeCloseTo(seenNoStop[3] + 600, 6);
    expect(seen[4].timeS).toBeCloseTo(seenNoStop[4] + 600, 6);
  });

  it('keeps stop accounting intact (ETAs, totals) with inline stops', () => {
    const cfg = makeConfig({ stops: [{ control: 'Mitt', km: 3, minutes: 10 }] });
    const plan = runInnerSolve(flatMicros(6), 163, calmWeather, cfg);
    expect(plan.stops).toHaveLength(1);
    expect(plan.stop_time_s).toBe(600);
    expect(plan.stops[0].depart_s - plan.stops[0].arrive_s).toBe(600);
    // The segment hosting the stop carries the departure ETA.
    const hostIdx = plan.segments.findIndex((s) => s.micro.cum_distance_m >= 3000);
    expect(plan.segments[hostIdx].eta_s).toBeCloseTo(plan.stops[0].depart_s, 6);
    // Total = rolling + stop.
    expect(plan.total_time_s).toBeCloseTo(plan.rolling_time_s + 600, 6);
    // ETA monotone increasing.
    for (let i = 1; i < plan.segments.length; i++) {
      expect(plan.segments[i].eta_s).toBeGreaterThan(plan.segments[i - 1].eta_s);
    }
  });
});

describe('makeWeatherFn UTC hour anchoring', () => {
  function sample(hourUtc: number, speed: number): WindSample {
    const hh = String(hourUtc).padStart(2, '0');
    return {
      time_iso: `2026-06-13T${hh}:00:00Z`,
      lat: 58.0,
      lon: 14.5,
      windspeed_ms: speed,
      winddir_from_deg: 270,
      temp_c: 12,
      pressure_pa: 101325,
      source: 'src-A',
    };
  }

  it('a 06:00 CEST start queries the 04:00 UTC cell at race start', () => {
    // Windy at 04 UTC (= race start, 06:00 local), calm at 12 UTC.
    const field = buildEnsemble([sample(4, 9), sample(12, 0.5)]);
    const utcStart = utcStartClockSeconds('2026-06-13', '06:00', 'Europe/Stockholm');
    const fn = makeWeatherFn(field, 'expected', utcStart);
    expect(fn(58.0, 14.5, 0).windspeed_ms).toBeCloseTo(9, 6);
    // Eight hours into the race the 12 UTC cell wins.
    expect(fn(58.0, 14.5, 8 * 3600).windspeed_ms).toBeCloseTo(0.5, 6);
  });

  it('passes cell rel_humidity through to the WindCond', () => {
    const field = buildEnsemble([{ ...sample(4, 5), rel_humidity: 0.8 }]);
    const fn = makeWeatherFn(field, 'expected', 4 * 3600);
    expect(fn(58.0, 14.5, 0).rel_humidity).toBeCloseTo(0.8, 6);
  });
});

describe('humidity affects air density in the plan', () => {
  it('humid air -> lower rho -> at least as fast at equal effort', () => {
    const cfg = makeConfig();
    const dry: WeatherFn = () => ({
      windspeed_ms: 0,
      winddir_from_deg: 0,
      temp_c: 25,
      pressure_pa: 101325,
    });
    const humid: WeatherFn = () => ({
      windspeed_ms: 0,
      winddir_from_deg: 0,
      temp_c: 25,
      pressure_pa: 101325,
      rel_humidity: 1,
    });
    const planDry = runInnerSolve(flatMicros(5), 163, dry, cfg);
    const planHumid = runInnerSolve(flatMicros(5), 163, humid, cfg);
    const effortDry = planDry.segments.find((s) => !s.micro.neutral)!;
    const effortHumid = planHumid.segments.find((s) => !s.micro.neutral)!;
    expect(effortHumid.rho).toBeLessThan(effortDry.rho);
    expect(effortHumid.v_ms).toBeGreaterThan(effortDry.v_ms);
  });
});

describe('solveForTargetTime slow-target guard', () => {
  it('notes when the target is slower than the minimum-effort plan', () => {
    // 5 km at >= 60 W NP finishes in minutes; target 11:45 is far slower.
    const cfg = makeConfig();
    const plan = solveForTargetTime(flatMicros(5), calmWeather, cfg);
    expect(plan.reachable).toBe(true);
    expect(plan.np_target_used).toBe(60);
    expect(plan.notes.join(' ')).toMatch(/slower than even a minimum-effort plan/i);
  });
});
