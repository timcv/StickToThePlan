// Chaingang model for the Vatternrundan race-plan calculator.
// Models the power dynamics of a rotating paceline (or solo rider).
// Spec reference: design doc sections 7 and 2.1.

import type { Config, PhysicsParams } from './types.js';
import { pedalPower, yawCdaFactor } from './physics.js';

/**
 * Fraction of time a rider spends on the front.
 * With fixed pull length and n riders in the rotation, each rider is on
 * the front for pull_seconds out of every (n_riders * pull_seconds) cycle.
 * f_front = 1/n_riders, except for solo (n === 1) where f_front = 1.0.
 */
export function fFront(nRiders: number, pullSeconds: number): number {
  void pullSeconds; // not needed for the ratio, kept for signature compatibility
  if (nRiders === 1) return 1.0;
  return 1 / nRiders;
}

/**
 * Build the PhysicsParams for the pull (front) position, incorporating
 * the yaw-adjusted cda_pull.
 */
function buildPullParams(
  v: number,
  headwind: number,
  crosswind: number,
  rho: number,
  cfg: Config,
): PhysicsParams {
  const vAir = v + headwind;
  // yawCdaFactor raises CdA here; pedalPower additionally raises the apparent-wind magnitude (vApp). Both crosswind effects intentionally compound (spec C1).
  const cda = yawCdaFactor(crosswind, vAir, cfg.k_yaw) * cfg.cda_pull;
  return { m: cfg.m, g: cfg.g, crr: cfg.crr, eta: cfg.eta, rho, cda };
}

/**
 * Build the PhysicsParams for the draft (following) position, incorporating
 * the yaw-adjusted cda_draft.
 */
function buildDraftParams(
  v: number,
  headwind: number,
  crosswind: number,
  rho: number,
  cfg: Config,
): PhysicsParams {
  const vAir = v + headwind;
  // yawCdaFactor raises CdA here; pedalPower additionally raises the apparent-wind magnitude (vApp). Both crosswind effects intentionally compound (spec C1).
  const cda = yawCdaFactor(crosswind, vAir, cfg.k_yaw) * cfg.cda_draft;
  return { m: cfg.m, g: cfg.g, crr: cfg.crr, eta: cfg.eta, rho, cda };
}

/**
 * Steady-state pedal power when a rider is on the front (using cda_pull).
 * Effective CdA is yaw-angle adjusted.
 */
export function pullPower(
  v: number,
  grade: number,
  headwind: number,
  crosswind: number,
  rho: number,
  cfg: Config,
): number {
  return pedalPower(
    v,
    grade,
    headwind,
    buildPullParams(v, headwind, crosswind, rho, cfg),
    crosswind,
  );
}

/**
 * Steady-state pedal power when a rider is in the draft (using cda_draft).
 * Effective CdA is yaw-angle adjusted.
 */
export function draftPower(
  v: number,
  grade: number,
  headwind: number,
  crosswind: number,
  rho: number,
  cfg: Config,
): number {
  return pedalPower(
    v,
    grade,
    headwind,
    buildDraftParams(v, headwind, crosswind, rho, cfg),
    crosswind,
  );
}

/**
 * Time-averaged mean power for a rider in a rotating paceline.
 * P_mean = f_front * P_pull + (1 - f_front) * P_draft
 */
export function meanPower(pull: number, draft: number, fFrontVal: number): number {
  return fFrontVal * pull + (1 - fFrontVal) * draft;
}

/**
 * Circular 30-second rolling mean over an array, treating the array as a
 * periodic cycle that wraps around at both ends.
 *
 * For each index i, the 30-second window is centered on past values: it
 * covers the 30 samples ending at i (indices i-29 to i, wrapping circularly).
 * This is appropriate because the square wave repeats each rotation cycle.
 */
function circularRollingMean30(arr: number[]): number[] {
  const n = arr.length;
  const window = 30;
  const result = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < window; j++) {
      // Window covers samples ending at i: indices i, i-1, ..., i-(window-1)
      const idx = (((i - j) % n) + n) % n;
      sum += arr[idx];
    }
    result[i] = sum / window;
  }

  return result;
}

/**
 * Reference implementation of rider NP using the explicit square wave.
 *
 * In solo mode (cfg.solo === true): no rotation, rider is always on the front.
 * Returns pullPower directly (NP of a constant series = that constant).
 *
 * In group mode: the rider's power is a square wave over one rotation cycle
 * (n_riders * pull_seconds samples at 1 Hz):
 *   - first pull_seconds samples = pullPower
 *   - remaining samples = draftPower
 * Apply a circular 30-second rolling mean (wrapping, since the cycle repeats),
 * then NP = (mean(rolling^4))^0.25.
 *
 * NP is higher than P_mean because the power variability (step function)
 * is penalized by the fourth-power weighting.
 *
 * This O(n) implementation is kept as the reference against which the O(1)
 * closed-form riderNpAtSpeed is proven equivalent (see tests).
 */
export function riderNpSquareWaveReference(
  v: number,
  grade: number,
  headwind: number,
  crosswind: number,
  rho: number,
  cfg: Config,
): number {
  // Clamp braking/coasting power to zero (see riderNpAtSpeed): NP measures
  // training stress and must not credit negative (braking) power.
  const pPull = Math.max(0, pullPower(v, grade, headwind, crosswind, rho, cfg));

  if (cfg.solo) {
    // Solo: constant power, NP = that power
    return pPull;
  }

  const pDraft = Math.max(0, draftPower(v, grade, headwind, crosswind, rho, cfg));
  const cycleLen = cfg.n_riders * cfg.pull_seconds;

  // Build per-second power array for one rotation cycle
  const powerArr = new Array<number>(cycleLen);
  for (let t = 0; t < cycleLen; t++) {
    powerArr[t] = t < cfg.pull_seconds ? pPull : pDraft;
  }

  // Circular 30-second rolling mean
  const rolling = circularRollingMean30(powerArr);

  // NP = (mean(rolling^4))^(1/4)
  const meanFourthPow = rolling.reduce((acc, r) => acc + r ** 4, 0) / rolling.length;
  return meanFourthPow ** 0.25;
}

interface NpMoments {
  c0: number;
  c1: number;
  c2: number;
  c3: number;
  c4: number;
}
const momentCache = new Map<string, NpMoments>();

/**
 * Occupancy a_i: fraction of the trailing 30-sample window (ending at i,
 * circular) that lies in the pull phase. MUST match circularRollingMean30's
 * windowing exactly (same trailing direction, same modulo wrap over the
 * cycle length n = nRiders * pullSeconds, pull phase = indices [0, pullSeconds)).
 */
function occupancyArray(nRiders: number, pullSeconds: number): number[] {
  const n = nRiders * pullSeconds;
  const window = 30;
  const a = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let inPull = 0;
    for (let j = 0; j < window; j++) {
      const idx = (((i - j) % n) + n) % n;
      if (idx < pullSeconds) inPull++;
    }
    a[i] = inPull / window;
  }
  return a;
}

/**
 * Precompute the five moments of the 30-second window occupancy for a given
 * (nRiders, pullSeconds). Each rolling-mean sample is a convex combination
 * rolling_i = a_i * Pp + (1 - a_i) * Pd, so rolling_i^4 expands by the binomial
 * theorem into five terms whose coefficients depend only on the occupancy a_i.
 * Averaging those coefficients over the cycle gives c0..c4, after which NP is
 * an O(1) function of (Pp, Pd). Cached per (nRiders, pullSeconds).
 */
export function npMomentsFor(nRiders: number, pullSeconds: number): NpMoments {
  const key = `${nRiders}:${pullSeconds}`;
  const hit = momentCache.get(key);
  if (hit) return hit;
  const a = occupancyArray(nRiders, pullSeconds);
  const n = a.length;
  let c0 = 0,
    c1 = 0,
    c2 = 0,
    c3 = 0,
    c4 = 0;
  for (const ai of a) {
    const b = 1 - ai;
    c4 += ai * ai * ai * ai;
    c3 += ai * ai * ai * b;
    c2 += ai * ai * b * b;
    c1 += ai * b * b * b;
    c0 += b * b * b * b;
  }
  const m: NpMoments = {
    c4: c4 / n,
    c3: 4 * (c3 / n),
    c2: 6 * (c2 / n),
    c1: 4 * (c1 / n),
    c0: c0 / n,
  };
  momentCache.set(key, m);
  return m;
}

/**
 * O(1) closed form for rider NP given the pull power and draft power.
 * NP^4 = mean_i((a_i * Pp + (1 - a_i) * Pd)^4), expanded via precomputed
 * moments c0..c4 (which already fold in the binomial coefficients).
 */
export function npFromMoments(
  pPull: number,
  pDraft: number,
  nRiders: number,
  pullSeconds: number,
): number {
  const { c0, c1, c2, c3, c4 } = npMomentsFor(nRiders, pullSeconds);
  const Pp = pPull,
    Pd = pDraft;
  const np4 =
    c4 * Pp ** 4 + c3 * Pp ** 3 * Pd + c2 * Pp ** 2 * Pd ** 2 + c1 * Pp * Pd ** 3 + c0 * Pd ** 4;
  return np4 ** 0.25;
}

/**
 * Rider's normalized power (NP) at a given speed on a segment.
 *
 * In solo mode (cfg.solo === true): no rotation, rider is always on the front,
 * so NP equals pullPower (NP of a constant series = that constant).
 *
 * In group mode: uses the O(1) closed form npFromMoments, which is proven
 * equivalent to the explicit square-wave reference (riderNpSquareWaveReference)
 * within 1e-6 across a grid of powers (see tests). The closed form avoids
 * rebuilding and re-averaging the per-second cycle on every speed evaluation,
 * which dominated the bisection solver's runtime.
 */
export function riderNpAtSpeed(
  v: number,
  grade: number,
  headwind: number,
  crosswind: number,
  rho: number,
  cfg: Config,
): number {
  // Clamp braking/coasting power to zero: on a descent (or strong tailwind) the
  // steady-state pedal power goes negative, but normalized power measures
  // training stress and must not credit braking. Without this clamp the fourth
  // power in npFromMoments makes riderNpAtSpeed non-monotone in v, so the
  // bisection in solveSpeedForRiderNp lands on a spurious slow root.
  const pPull = Math.max(0, pullPower(v, grade, headwind, crosswind, rho, cfg));

  if (cfg.solo) {
    // Solo: constant power, NP = that power
    return pPull;
  }

  const pDraft = Math.max(0, draftPower(v, grade, headwind, crosswind, rho, cfg));
  return npFromMoments(pPull, pDraft, cfg.n_riders, cfg.pull_seconds);
}

/**
 * Bisection solver: find ground speed v such that riderNpAtSpeed(v,...) == npTarget.
 * Searches v in [0.5, 25] m/s. Converges within 60 iterations to tolerance
 * of 0.1 W on NP. riderNpAtSpeed is monotone non-decreasing in v because the
 * NP computation clamps braking power to zero (see riderNpAtSpeed), so the
 * bisection has a single root.
 */
export function solveSpeedForRiderNp(
  npTarget: number,
  grade: number,
  headwind: number,
  crosswind: number,
  rho: number,
  cfg: Config,
): number {
  let lo = 0.5;
  let hi = 25;

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const npMid = riderNpAtSpeed(mid, grade, headwind, crosswind, rho, cfg);
    if (Math.abs(npMid - npTarget) < 0.1) return mid;
    if (npMid < npTarget) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return (lo + hi) / 2;
}
