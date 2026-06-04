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
  return pedalPower(v, grade, headwind, buildPullParams(v, headwind, crosswind, rho, cfg));
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
  return pedalPower(v, grade, headwind, buildDraftParams(v, headwind, crosswind, rho, cfg));
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
      const idx = ((i - j) % n + n) % n;
      sum += arr[idx];
    }
    result[i] = sum / window;
  }

  return result;
}

/**
 * Rider's normalized power (NP) at a given speed on a segment.
 *
 * In solo mode (cfg.solo === true): no rotation, rider is always on the front.
 * riderNpAtSpeed returns pullPower directly (NP of a constant series = that constant).
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
 */
export function riderNpAtSpeed(
  v: number,
  grade: number,
  headwind: number,
  crosswind: number,
  rho: number,
  cfg: Config,
): number {
  const pPull = pullPower(v, grade, headwind, crosswind, rho, cfg);

  if (cfg.solo) {
    // Solo: constant power, NP = that power
    return pPull;
  }

  const pDraft = draftPower(v, grade, headwind, crosswind, rho, cfg);
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

/**
 * Bisection solver: find ground speed v such that riderNpAtSpeed(v,...) == npTarget.
 * Searches v in [0.5, 25] m/s. Converges within 60 iterations to tolerance
 * of 0.1 W on NP. riderNpAtSpeed is monotone increasing in v under normal conditions.
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
