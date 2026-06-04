// Pacing solver for the Vatternrundan race-plan calculator (no-wind capable,
// but wind-ready: every effort segment queries a WeatherFn).
// Spec reference: design doc section 9 (pacing solver) and section 4 (locked
// race structure, neutral start, stop plan).
//
// The model holds constant rider normalized power (np_target) across all effort
// segments and lets speed vary with gradient and wind, with hard and soft pull
// caps so the front position never becomes unsustainable. The outer solver
// bisects np_target to hit the target total time.

import type {
  MicroSegment,
  PlanResult,
  SegmentPlan,
  StopPlan,
  Config,
  WindCond,
  WeatherFn,
  Scenario,
} from './types.js';
import type { EnsembleField } from './weather/ensemble.js';
import { makeWeatherFn } from './weather/ensemble.js';
import { airDensity, decomposeWind, solveSpeedForPower, yawCdaFactor } from './physics.js';
import {
  pullPower,
  draftPower,
  meanPower,
  fFront,
  riderNpAtSpeed,
  solveSpeedForRiderNp,
} from './chaingang.js';
import { clockToSeconds, hmToSeconds } from './util/time.js';

/**
 * Calm-weather provider: no wind, 15 C, sea-level standard pressure.
 * Used for the no-wind pacing pass and the validation tests (spec section 15).
 */
export const calmWeather: WeatherFn = () => ({
  windspeed_ms: 0,
  winddir_from_deg: 0,
  temp_c: 15,
  pressure_pa: 101325,
});

/**
 * Speed (m/s) at a capped PULL power on the front, at the current segment
 * conditions. Mirrors the yaw-adjusted cda_pull used in pullPower so the cap
 * is applied consistently. In solo mode pull == rider power, so capping the
 * pull also caps rider effort directly.
 *
 * @param capW       Target pull power in W
 * @param grade      Segment grade (decimal)
 * @param headwind   Signed headwind (m/s)
 * @param crosswind  Signed crosswind (m/s)
 * @param rho        Air density (kg/m^3)
 * @param vRef       Reference ground speed used to fix the yaw CdA factor
 * @param cfg        Config
 */
function speedAtPull(
  capW: number,
  grade: number,
  headwind: number,
  crosswind: number,
  rho: number,
  vRef: number,
  cfg: Config,
): number {
  const cda = yawCdaFactor(crosswind, vRef + headwind, cfg.k_yaw) * cfg.cda_pull;
  return solveSpeedForPower(capW, grade, headwind, {
    m: cfg.m,
    g: cfg.g,
    crr: cfg.crr,
    eta: cfg.eta,
    rho,
    cda,
  });
}

/**
 * Inner solve: time-march the route at a fixed effort level (np_target),
 * applying caps and inserting stops. Returns a full PlanResult.
 *
 * Algorithm (spec 9.1):
 *  - Neutral segments (km 0..1): fixed neutral_speed, no NP accounting.
 *  - Effort segments: solve ground speed for rider NP == np_target, then apply
 *    hard and (on climbs) soft pull caps. eta_s is elapsed seconds from start
 *    at the segment END.
 *  - Stops: insert at each stop's km marker; the stop delays everything after.
 *
 * @param microsegments  Ordered microsegments (from ingestGpx).
 * @param npTarget       Rider NP target (W).
 * @param weather        Weather provider (lat, lon, clockSecondsSinceMidnight).
 * @param cfg            Config.
 * @param startClockS    Seconds since midnight at the start (clockToSeconds(start_time)).
 */
export function runInnerSolve(
  microsegments: MicroSegment[],
  npTarget: number,
  weather: WeatherFn,
  cfg: Config,
  startClockS: number,
): PlanResult {
  const fFrontVal = fFront(cfg.n_riders, cfg.pull_seconds);
  const segments: SegmentPlan[] = [];

  let elapsed = 0; // seconds from start at the current point of the march

  let hardCount = 0;
  let softCount = 0;
  // Time added by caps relative to the uncapped (np-target) speed, in seconds.
  let capTimeMovedS = 0;

  for (const micro of microsegments) {
    if (micro.neutral) {
      // Fixed neutral segment, excluded from the effort model and NP (spec 4.4).
      const v = cfg.neutral_speed_kmh / 3.6;
      const time_s = micro.distance_m / v;
      elapsed += time_s;
      segments.push({
        micro,
        v_ms: v,
        speed_kmh: v * 3.6,
        p_pull_w: 0,
        p_draft_w: 0,
        p_mean_w: 0,
        rider_np_w: 0,
        time_s,
        eta_s: elapsed,
        headwind_ms: 0,
        crosswind_ms: 0,
        rho: cfg.rho_fallback,
        cap_binding: 'none',
      });
      continue;
    }

    // Effort segment.
    const w: WindCond = weather(micro.lat, micro.lon, startClockS + elapsed);
    const rho = airDensity(w.temp_c, w.pressure_pa);
    const { headwind, crosswind } = decomposeWind(
      w.windspeed_ms,
      w.winddir_from_deg,
      micro.bearing_deg,
    );

    // Uncapped speed that yields rider NP == npTarget.
    let v = solveSpeedForRiderNp(npTarget, micro.grade, headwind, crosswind, rho, cfg);
    const vUncapped = v;

    // Pull power on the front at the uncapped speed.
    const pPull = pullPower(v, micro.grade, headwind, crosswind, rho, cfg);

    let cap_binding: SegmentPlan['cap_binding'] = 'none';
    if (pPull > cfg.pull_cap_hard) {
      v = speedAtPull(cfg.pull_cap_hard, micro.grade, headwind, crosswind, rho, v, cfg);
      cap_binding = 'hard';
      hardCount++;
    } else if (
      micro.grade > cfg.climb_threshold &&
      cfg.climb_discount &&
      pPull > cfg.pull_cap_soft
    ) {
      v = speedAtPull(cfg.pull_cap_soft, micro.grade, headwind, crosswind, rho, v, cfg);
      cap_binding = 'soft';
      softCount++;
    }

    let p_pull_w: number;
    let rider_np_w: number;
    if (cap_binding === 'none') {
      // No cap moved the speed: pPull is already the pull power at v, and the
      // rider NP equals npTarget within the solver tolerance (0.1 W). Reuse
      // them instead of recomputing the (expensive) square-wave NP.
      p_pull_w = pPull;
      rider_np_w = npTarget;
    } else {
      // Cap lowered the speed; recompute exactly at the final v.
      capTimeMovedS += micro.distance_m / v - micro.distance_m / vUncapped;
      p_pull_w = pullPower(v, micro.grade, headwind, crosswind, rho, cfg);
      rider_np_w = riderNpAtSpeed(v, micro.grade, headwind, crosswind, rho, cfg);
    }
    const p_draft_w = cfg.solo
      ? p_pull_w
      : draftPower(v, micro.grade, headwind, crosswind, rho, cfg);
    const p_mean_w = cfg.solo ? p_pull_w : meanPower(p_pull_w, p_draft_w, fFrontVal);

    const time_s = micro.distance_m / v;
    elapsed += time_s;

    segments.push({
      micro,
      v_ms: v,
      speed_kmh: v * 3.6,
      p_pull_w,
      p_draft_w,
      p_mean_w,
      rider_np_w,
      time_s,
      eta_s: elapsed,
      headwind_ms: headwind,
      crosswind_ms: crosswind,
      rho,
      cap_binding,
    });
  }

  // ---- Stops (spec 4.2 / 9.4) ----
  // Each stop sits at the first segment boundary whose cumulative distance
  // reaches the stop km marker. The stop delays that segment's ETA and every
  // subsequent segment's ETA by minutes*60.
  const stops: StopPlan[] = [];
  let stopTimeS = 0;

  for (const stop of cfg.stops) {
    const targetM = stop.km * 1000;
    const idx = segments.findIndex((s) => s.micro.cum_distance_m >= targetM);
    if (idx === -1) continue; // stop km beyond the route end; skip
    const addS = stop.minutes * 60;
    const arrive_s = segments[idx].eta_s;
    const depart_s = arrive_s + addS;
    stops.push({ control: stop.control, km: stop.km, minutes: stop.minutes, arrive_s, depart_s });

    // Delay this segment and all subsequent segments by the stop duration.
    for (let j = idx; j < segments.length; j++) {
      segments[j].eta_s += addS;
    }
    elapsed += addS;
    stopTimeS += addS;
  }

  // ---- Totals ----
  const total_time_s = elapsed; // includes neutral + stops
  const rolling_time_s = total_time_s - stopTimeS;

  const notes: string[] = [];
  if (hardCount > 0 || softCount > 0) {
    notes.push(
      `Caps bound on ${hardCount} hard and ${softCount} soft segment(s); ` +
        `caps added ${(capTimeMovedS / 60).toFixed(1)} min (speed lowered, time banked elsewhere by the outer solver).`,
    );
  }

  return {
    np_target_used: npTarget,
    total_time_s,
    rolling_time_s,
    stop_time_s: stopTimeS,
    segments,
    stops,
    reachable: true,
    notes,
  };
}

/**
 * Outer solve: bisect np_target so the inner solve's total time hits the
 * target total (spec 9.1 outer). Higher NP -> faster -> lower total time, so
 * total_time_s is monotone decreasing in np_target.
 *
 * Search range [60, cfg.ftp]. ~45 iterations, tolerance 20 s on total.
 *
 * If even at np = ftp the total is still above target (cannot go fast enough
 * sustainably), returns the np = ftp result (fastest) with reachable = false
 * and an explanatory note.
 */
export function solveForTargetTime(
  microsegments: MicroSegment[],
  weather: WeatherFn,
  cfg: Config,
): PlanResult {
  const startClockS = clockToSeconds(cfg.start_time);
  const target = hmToSeconds(cfg.target_total_hm);

  const loNp = 60;
  const hiNp = cfg.ftp;

  // Fastest sustainable plan (np = ftp). If its total is still > target, the
  // target time is unreachable.
  const fastest = runInnerSolve(microsegments, hiNp, weather, cfg, startClockS);
  if (fastest.total_time_s > target) {
    const over = (fastest.total_time_s - target) / 60;
    fastest.reachable = false;
    fastest.notes.push(
      `Target time ${cfg.target_total_hm} not reachable sustainably: even at FTP ` +
        `(${cfg.ftp} W) the plan is ${over.toFixed(1)} min slower. Returning the fastest ` +
        `sustainable plan. Consider more time or shorter pulls.`,
    );
    return fastest;
  }

  // Bisect: total_time_s decreasing in np, so to lower total we raise np.
  let lo = loNp;
  let hi = hiNp;
  let best = fastest; // at np = hi, total <= target

  for (let i = 0; i < 45; i++) {
    const mid = (lo + hi) / 2;
    const plan = runInnerSolve(microsegments, mid, weather, cfg, startClockS);
    best = plan;
    if (Math.abs(plan.total_time_s - target) <= 20) {
      return plan;
    }
    if (plan.total_time_s > target) {
      // Too slow -> need more power.
      lo = mid;
    } else {
      // Too fast -> back off power.
      hi = mid;
    }
  }

  return best;
}

/**
 * The three time-scenario plans (spec 9.5). Each is a full PlanResult that hits
 * the SAME target total time (cfg.target_total_hm), so they differ in the anchor
 * NP they required: less headwind (optimistic) needs less NP, more headwind
 * (pessimistic) needs more NP.
 */
export interface ThreeScenarios {
  expected: PlanResult;
  optimistic: PlanResult;
  pessimistic: PlanResult;
}

/**
 * Run the full pacing solver three times against the same EnsembleField, once
 * per scenario (expected, optimistic, pessimistic). Each scenario builds its own
 * WeatherFn from the field (windspeed selected by percentile, see makeWeatherFn)
 * and re-bisects np_target to hit the same target total time, so the three
 * results report the three anchor NPs they required (spec 9.5).
 *
 * The wind field is queried at clock times offset from the race start
 * (clockToSeconds(cfg.start_time)), matching how the inner solve marches the clock.
 *
 * @param microsegments  Ordered microsegments (from ingestGpx).
 * @param field          The aggregated weather ensemble (cells + percentile spread).
 * @param cfg            Config.
 */
export function solveThreeScenarios(
  microsegments: MicroSegment[],
  field: EnsembleField,
  cfg: Config,
): ThreeScenarios {
  const startClockS = clockToSeconds(cfg.start_time);

  const solveScenario = (scenario: Scenario): PlanResult => {
    const weather = makeWeatherFn(field, scenario, startClockS);
    return solveForTargetTime(microsegments, weather, cfg);
  };

  return {
    expected: solveScenario('expected'),
    optimistic: solveScenario('optimistic'),
    pessimistic: solveScenario('pessimistic'),
  };
}
