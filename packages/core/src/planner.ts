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
import { airDensity, decomposeWind } from './physics.js';
import { adjustWindForHeight, terrainToZ0 } from './weather/effective.js';
import { exposureCoveragePct } from './weather/exposure.js';
import {
  pullPower,
  draftPower,
  meanPower,
  fFront,
  riderNpAtSpeed,
  solveSpeedForRiderNp,
  solveSpeedForPullPower,
} from './chaingang.js';
import { hmToSeconds, utcStartClockSeconds } from './util/time.js';

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

/** Roughness length for a segment: per-segment exposure if present, else an
 *  explicit override, else the coarse terrain default. */
function resolveZ0(micro: MicroSegment, cfg: Config): number {
  return micro.z0_used ?? cfg.wind_roughness_z0 ?? terrainToZ0(cfg.exposure_terrain);
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
 *  - Stops: applied inline at each stop's km marker, so the march clock (and
 *    therefore every later weather query) includes earlier stop time.
 *
 * @param microsegments  Ordered microsegments (from ingestGpx).
 * @param npTarget       Rider NP target (W).
 * @param weather        Weather provider; receives elapsed seconds from race
 *                       start (the WeatherFn contract). Clock/UTC conversion
 *                       lives inside the provider (see makeWeatherFn).
 * @param cfg            Config.
 */
export function runInnerSolve(
  microsegments: MicroSegment[],
  npTarget: number,
  weather: WeatherFn,
  cfg: Config,
): PlanResult {
  const fFrontVal = fFront(cfg.n_riders, cfg.pull_seconds);
  const segments: SegmentPlan[] = [];

  let elapsed = 0; // seconds from start at the current point of the march

  let hardCount = 0;
  let softCount = 0;
  let spinoutCount = 0;
  // Time added by caps relative to the uncapped (np-target) speed, in seconds.
  let capTimeMovedS = 0;

  // Stops, applied inline when the march crosses their km marker. A stop
  // attaches to the first segment whose END reaches the marker. The boundary
  // segment's eta_s stays the ARRIVAL time at that boundary; the stop then
  // shifts the march clock (and therefore every later segment's eta_s and
  // weather query) by the stop duration. Departure lives in StopPlan.depart_s.
  const stopsSorted = [...cfg.stops].sort((a, b) => a.km - b.km);
  let stopIdx = 0;
  const stops: StopPlan[] = [];
  let stopTimeS = 0;

  const applyStopsAtBoundary = (cumDistanceM: number): void => {
    while (stopIdx < stopsSorted.length && cumDistanceM >= stopsSorted[stopIdx].km * 1000) {
      const stop = stopsSorted[stopIdx];
      const addS = stop.minutes * 60;
      const arrive_s = elapsed;
      elapsed += addS;
      stopTimeS += addS;
      stops.push({
        control: stop.control,
        km: stop.km,
        minutes: stop.minutes,
        arrive_s,
        depart_s: elapsed,
      });
      stopIdx++;
    }
  };

  for (const micro of microsegments) {
    const z0 = resolveZ0(micro, cfg);

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
        raw_windspeed_ms: 0,
        eff_windspeed_ms: 0,
        z0_used: z0,
        exposure_class: micro.exposure_class,
      });
      applyStopsAtBoundary(micro.cum_distance_m);
      continue;
    }

    // Effort segment.
    const w: WindCond = weather(micro.lat, micro.lon, elapsed);
    const rho = airDensity(w.temp_c, w.pressure_pa, w.rel_humidity ?? 0);
    const rawW = w.windspeed_ms;
    const effW = cfg.apply_wind_height_correction
      ? adjustWindForHeight(rawW, z0, cfg.rider_wind_height_m, cfg.forecast_wind_height_m)
      : rawW;
    const { headwind, crosswind } = decomposeWind(effW, w.winddir_from_deg, micro.bearing_deg);

    // Uncapped speed that yields rider NP == npTarget.
    let v = solveSpeedForRiderNp(npTarget, micro.grade, headwind, crosswind, rho, cfg);
    const vUncapped = v;

    // Pull power on the front at the uncapped speed.
    const pPull = pullPower(v, micro.grade, headwind, crosswind, rho, cfg);

    // Pull caps. On a climb (grade > climb_threshold, climb_discount on) the
    // soft cap is the climb discount and takes PRECEDENCE: the binding cap is
    // min(soft, hard). Off-climb only the hard cap applies. Checking hard
    // first would let the steepest ramps pull at the (higher) hard cap while
    // moderate climbs sit at the soft cap, inverting the intended severity.
    const onClimb = micro.grade > cfg.climb_threshold && cfg.climb_discount;
    const capW = onClimb ? Math.min(cfg.pull_cap_soft, cfg.pull_cap_hard) : cfg.pull_cap_hard;

    let cap_binding: SegmentPlan['cap_binding'] = 'none';
    if (pPull > capW) {
      v = solveSpeedForPullPower(capW, micro.grade, headwind, crosswind, rho, cfg);
      cap_binding = onClimb && capW < cfg.pull_cap_hard ? 'soft' : 'hard';
    }

    // Spin-out / planning-speed ceiling. A rotating group will not (and for
    // safety should not) plan a paceline faster than max_plan_speed_kmh in a
    // strong tailwind or descent: above it the rider eases, and the extra wind /
    // gravity is buffer, not banked time. Capping here keeps tailwind splits
    // realistic for a tempokort and forces the outer solver to find the target
    // time from real effort rather than from implausible 50+ km/h medvind splits.
    // It overrides any (higher-speed) hard/soft classification: it is the binding
    // constraint on the final speed.
    const vMax = cfg.max_plan_speed_kmh / 3.6;
    if (v > vMax) {
      v = vMax;
      cap_binding = 'spinout';
    }

    // Count the FINAL binding so the notes line matches what the plan shows.
    if (cap_binding === 'hard') hardCount++;
    else if (cap_binding === 'soft') softCount++;
    else if (cap_binding === 'spinout') spinoutCount++;

    let p_pull_w: number;
    let rider_np_w: number;
    if (cap_binding === 'none') {
      // No cap moved the speed: pPull is already the pull power at v, and the
      // rider NP equals npTarget within the solver tolerance (0.1 W). Reuse
      // them instead of recomputing the (expensive) square-wave NP.
      p_pull_w = pPull;
      rider_np_w = npTarget;
    } else {
      // Cap moved the speed; recompute exactly at the final v.
      capTimeMovedS += micro.distance_m / v - micro.distance_m / vUncapped;
      p_pull_w = pullPower(v, micro.grade, headwind, crosswind, rho, cfg);
      rider_np_w = riderNpAtSpeed(v, micro.grade, headwind, crosswind, rho, cfg);
    }
    let p_draft_w = cfg.solo ? p_pull_w : draftPower(v, micro.grade, headwind, crosswind, rho, cfg);
    // A descent (or spin-out cap) can drive the steady pull/draft power below
    // zero (freewheeling); a plan cannot show negative pedal power, so clamp all
    // displayed power to zero (coasting) for every segment.
    p_pull_w = Math.max(0, p_pull_w);
    p_draft_w = Math.max(0, p_draft_w);
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
      raw_windspeed_ms: rawW,
      eff_windspeed_ms: effW,
      z0_used: z0,
      exposure_class: micro.exposure_class,
    });
    applyStopsAtBoundary(micro.cum_distance_m);
  }

  // Stops the march never reached (km beyond the route end) must be surfaced:
  // silently dropping them would make the plan look faster than the rider's day.
  const lastCumM =
    microsegments.length > 0 ? microsegments[microsegments.length - 1].cum_distance_m : 0;
  const missedStops = stopsSorted.slice(stopIdx);

  // ---- Totals ----
  const total_time_s = elapsed; // includes neutral + stops
  const rolling_time_s = total_time_s - stopTimeS;

  // Ride-level rider normalized power and intensity factor (sustainability).
  // NP^4 averages over time; each effort segment's rider_np_w is already its
  // local NP, so the ride NP is the time-weighted quartic mean of the segment NPs
  // (30 s cross-segment boundary effects are negligible at this resolution).
  const effortSegs = segments.filter((s) => !s.micro.neutral);
  const effortTime = effortSegs.reduce((a, s) => a + s.time_s, 0);
  const rider_np_ride_w =
    effortTime > 0
      ? (effortSegs.reduce((a, s) => a + s.rider_np_w ** 4 * s.time_s, 0) / effortTime) ** 0.25
      : 0;
  const intensity_factor = cfg.ftp > 0 ? rider_np_ride_w / cfg.ftp : 0;

  const notes: string[] = [];
  for (const missed of missedStops) {
    notes.push(
      `Stop "${missed.control}" at km ${missed.km} lies beyond the route end ` +
        `(${(lastCumM / 1000).toFixed(1)} km) and was NOT applied.`,
    );
  }
  if (hardCount > 0 || softCount > 0 || spinoutCount > 0) {
    notes.push(
      `Caps bound on ${hardCount} hard, ${softCount} soft and ${spinoutCount} spin-out segment(s); ` +
        `caps moved ${(capTimeMovedS / 60).toFixed(1)} min (speed adjusted, time rebalanced by the outer solver).`,
    );
  }
  if (intensity_factor > cfg.sustain_if_warn) {
    notes.push(
      `Planen kräver IF ${intensity_factor.toFixed(2)} (förar-NP ${Math.round(rider_np_ride_w)} W av FTP ` +
        `${cfg.ftp} W). Det är en hård dagsinsats; kontrollera att gruppen håller den uthålligt.`,
    );
  }

  return {
    np_target_used: npTarget,
    rider_np_ride_w,
    intensity_factor,
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
 * and an explanatory note. Symmetrically, if the target is slower than the
 * minimum-effort plan (np = 60), returns that plan with a note instead of
 * silently pinning the bisection to the floor.
 */
export function solveForTargetTime(
  microsegments: MicroSegment[],
  weather: WeatherFn,
  cfg: Config,
): PlanResult {
  const target = hmToSeconds(cfg.target_total_hm);

  const loNp = 60;
  const hiNp = cfg.ftp;

  // Fastest sustainable plan (np = ftp). If its total is still > target, the
  // target time is unreachable.
  const fastest = runInnerSolve(microsegments, hiNp, weather, cfg);
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

  // Slowest plan in the search range (np = 60). If it already beats the target,
  // the target is slower than any plan the solver can produce.
  const slowest = runInnerSolve(microsegments, loNp, weather, cfg);
  if (slowest.total_time_s < target) {
    const under = (target - slowest.total_time_s) / 60;
    slowest.notes.push(
      `Target time ${cfg.target_total_hm} is slower than even a minimum-effort plan ` +
        `(${loNp} W NP finishes ${under.toFixed(1)} min early). Returning the minimum-effort ` +
        `plan. Consider longer stops or a faster target.`,
    );
    return slowest;
  }

  // Bisect: total_time_s decreasing in np, so to lower total we raise np.
  let lo = loNp;
  let hi = hiNp;
  let best = fastest; // at np = hi, total <= target

  for (let i = 0; i < 45; i++) {
    const mid = (lo + hi) / 2;
    const plan = runInnerSolve(microsegments, mid, weather, cfg);
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
  /**
   * Honest finish-time interval: the expected anchor NP is held fixed and the
   * route is re-marched under optimistic/pessimistic wind to reveal the actual
   * time spread due to weather uncertainty. `source` is always 'scenario'.
   */
  time_uncertainty_s: { expected: number; low: number; high: number; source: 'scenario' };
  /**
   * Plan-level data-quality summary. exposureCoveragePct/exposureSource reflect
   * whatever exposure was stamped on `microsegments` BEFORE this call: callers
   * must run `applyExposure(microsegments, runs)` first for baked data to register
   * (otherwise coverage reads 0% and source reads 'terrain'). The 'fetched' source
   * and 'ensemble'/'none' variants are set by the app layer (web/CLI) which knows
   * the provenance; the core only distinguishes 'baked' vs 'terrain' and
   * 'manual' vs 'forecast'.
   */
  data_quality?: {
    exposureCoveragePct: number;
    exposureSource: 'baked' | 'fetched' | 'terrain' | 'none';
    weatherSource: 'manual' | 'forecast' | 'ensemble';
  };
}

/**
 * Run the full pacing solver three times against the same EnsembleField, once
 * per scenario (expected, optimistic, pessimistic). Each scenario builds its own
 * WeatherFn from the field (windspeed selected by percentile, see makeWeatherFn)
 * and re-bisects np_target to hit the same target total time, so the three
 * results report the three anchor NPs they required (spec 9.5).
 *
 * The wind field is queried at elapsed seconds from race start; makeWeatherFn
 * anchors that march to the UTC start clock (utcStartClockSeconds) so the
 * local start time matches the UTC-binned cells.
 *
 * @param microsegments  Ordered microsegments (from ingestGpx).
 * @param field          The aggregated weather ensemble (cells + percentile spread).
 * @param cfg            Config.
 */
/**
 * Decide whether the route is net downwind for the field's mean wind. Projects
 * each effort segment's travel onto the dominant (speed-weighted vector-mean)
 * wind direction and sums the signed headwind exposure
 * (cos(dir_from - bearing) * distance): positive = into the wind, negative =
 * downwind. Net negative beyond a 5%-of-distance deadband means the route gains
 * more from tailwind than it loses to headwind, so MORE wind is FASTER and the
 * optimistic/pessimistic percentile mapping must invert (see makeWeatherFn). The
 * deadband keeps a balanced loop (exposure ~ 0, e.g. Vatternrundan) on the convex
 * default where more wind is slightly slower, so pessimistic = windier.
 */
function routeIsNetDownwind(microsegments: MicroSegment[], field: EnsembleField): boolean {
  if (field.cells.length === 0) return false;
  let u = 0;
  let v = 0;
  for (const c of field.cells) {
    const rad = (c.winddir_from_deg * Math.PI) / 180;
    u += -c.windspeed_mean_ms * Math.sin(rad);
    v += -c.windspeed_mean_ms * Math.cos(rad);
  }
  if (u === 0 && v === 0) return false;
  const dirFrom = (Math.atan2(-u, -v) * 180) / Math.PI;
  let exposure = 0;
  let total = 0;
  for (const m of microsegments) {
    if (m.neutral) continue;
    const delta = ((dirFrom - m.bearing_deg) * Math.PI) / 180;
    exposure += Math.cos(delta) * m.distance_m; // + into wind, - downwind
    total += m.distance_m;
  }
  return total > 0 && exposure < -0.05 * total;
}

export function solveThreeScenarios(
  microsegments: MicroSegment[],
  field: EnsembleField,
  cfg: Config,
): ThreeScenarios {
  // Weather cells are binned on UTC hours; convert the local start clock to
  // UTC once here so makeWeatherFn matches the right hour (ETAs stay local).
  const utcStartS = utcStartClockSeconds(cfg.race_date, cfg.start_time, cfg.time_zone);
  const favorableWind = routeIsNetDownwind(microsegments, field);

  const solveScenario = (scenario: Scenario): PlanResult => {
    const weather = makeWeatherFn(field, scenario, utcStartS, favorableWind);
    return solveForTargetTime(microsegments, weather, cfg);
  };

  const expected = solveScenario('expected');
  const optimistic = solveScenario('optimistic');
  const pessimistic = solveScenario('pessimistic');

  // Time interval: hold the expected anchor NP fixed and re-march under the
  // optimistic / pessimistic wind. (The three scenarios above all hit the same
  // target time and differ in NP, so their times are equal; the honest time
  // spread comes from fixing effort and varying wind luck.)
  const np = expected.np_target_used;
  const lowTime = runInnerSolve(
    microsegments,
    np,
    makeWeatherFn(field, 'optimistic', utcStartS, favorableWind),
    cfg,
  ).total_time_s;
  const highTime = runInnerSolve(
    microsegments,
    np,
    makeWeatherFn(field, 'pessimistic', utcStartS, favorableWind),
    cfg,
  ).total_time_s;
  const expTime = expected.total_time_s;

  return {
    expected,
    optimistic,
    pessimistic,
    time_uncertainty_s: {
      expected: expTime,
      low: Math.min(lowTime, expTime),
      high: Math.max(highTime, expTime),
      source: 'scenario',
    },
    data_quality: {
      exposureCoveragePct: exposureCoveragePct(microsegments),
      exposureSource: microsegments.some((m) => m.exposure_class) ? 'baked' : 'terrain',
      weatherSource: field.sources.includes('manual') ? 'manual' : 'forecast',
    },
  };
}
