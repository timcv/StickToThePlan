// Physics model for the Vätternrundan race-plan calculator.
// All units: velocity in m/s, grade as decimal (0.05 = 5%), headwind in m/s
// (positive into the wind, negative tailwind), power in W.
// Spec reference: design doc section 6.

import type { PhysicsParams } from './types.js';

/**
 * Steady-state pedal power for a given speed, grade, and headwind.
 *
 * Implements spec section 6 verbatim:
 *   theta   = atan(grade)
 *   F_grav  = m * g * sin(theta)
 *   F_roll  = m * g * cos(theta) * crr
 *   v_air   = v_ground + headwind   // positive headwind, negative tailwind
 *   F_aero  = 0.5 * rho * CdA * v_air * |v_air|  // signed, handles tailwind > ground speed
 *   P_wheel = (F_grav + F_roll + F_aero) * v_ground
 *   P_pedal = P_wheel / eta
 */
export function pedalPower(
  v: number,
  grade: number,
  headwind: number,
  p: PhysicsParams,
): number {
  const theta = Math.atan(grade);
  const fGrav = p.m * p.g * Math.sin(theta);
  const fRoll = p.m * p.g * Math.cos(theta) * p.crr;
  const vAir = v + headwind;
  const fAero = 0.5 * p.rho * p.cda * vAir * Math.abs(vAir);
  const pWheel = (fGrav + fRoll + fAero) * v;
  return pWheel / p.eta;
}

/**
 * Bisection solver: find ground speed v such that pedalPower(v) == target.
 * Robust over v in [0.5, 25] m/s (spec section 6.1).
 * Converges to 0.01 W accuracy within 100 iterations.
 */
export function solveSpeedForPower(
  target: number,
  grade: number,
  headwind: number,
  p: PhysicsParams,
): number {
  let lo = 0.5;
  let hi = 25;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const pm = pedalPower(mid, grade, headwind, p);
    if (Math.abs(pm - target) < 0.01) return mid;
    if (pm < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Decompose total wind speed W into headwind and crosswind components.
 *
 * Spec section 6.2:
 *   delta     = radians(phi_from - beta)
 *   headwind  = W * cos(delta)    // + headwind, - tailwind
 *   crosswind = W * sin(delta)    // signed crosswind
 *
 * @param W        Wind speed in m/s
 * @param phiFrom  Meteorological wind direction (degrees, where the wind comes FROM)
 * @param beta     Road bearing (degrees, direction of travel)
 */
export function decomposeWind(
  W: number,
  phiFrom: number,
  beta: number,
): { headwind: number; crosswind: number } {
  const delta = ((phiFrom - beta) * Math.PI) / 180;
  const headwind = W * Math.cos(delta);
  const crosswind = W * Math.sin(delta);
  return { headwind, crosswind };
}

/**
 * Compute dry-air density from temperature and pressure.
 * Dry air: rho = p / (Rd * T), Rd = 287.058 J/(kg*K), T in kelvin, p in pascal.
 *
 * If relHumidity > 0, apply a virtual-temperature correction for moist air:
 *   Tv = T / (1 - (e/p) * (1 - Rd/Rv))
 * where e = relHumidity * saturation_vapor_pressure(T) and Rv = 461.5 J/(kg*K).
 * Saturation vapor pressure (Tetens approximation): es = 611.2 * exp(17.67*(T-273.15)/(T-29.65)) Pa.
 * This correction reduces density by up to ~0.5% at typical race conditions (15 C, 60% RH).
 */
export function airDensity(
  tempC: number,
  pressurePa: number,
  relHumidity = 0,
): number {
  const Rd = 287.058; // J/(kg*K)
  const T = tempC + 273.15; // kelvin

  if (relHumidity <= 0) {
    return pressurePa / (Rd * T);
  }

  // Moist-air virtual temperature correction
  const Rv = 461.5; // J/(kg*K), gas constant for water vapour
  // Tetens approximation for saturation vapour pressure
  const es = 611.2 * Math.exp((17.67 * (T - 273.15)) / (T - 29.65));
  const e = relHumidity * es; // actual vapour pressure
  // Virtual temperature Tv accounts for the lower molecular weight of water vapour
  const Tv = T / (1 - (e / pressurePa) * (1 - Rd / Rv));
  return pressurePa / (Rd * Tv);
}

/**
 * Yaw-angle CdA factor. Increases effective CdA with yaw angle.
 *
 * Spec section 6.3:
 *   yaw     = atan2(crosswind, v_ground + headwind)
 *   factor  = 1 + k_yaw * |yaw_deg| / 10
 *
 * @param crosswind  Signed crosswind component in m/s
 * @param vAir       v_ground + headwind (apparent air speed along the road axis) in m/s
 * @param kYaw       Yaw drag coefficient (e.g. 0.04 gives ~8% rise at 20 deg yaw)
 * @returns Multiplicative CdA factor (>= 1.0)
 */
export function yawCdaFactor(
  crosswind: number,
  vAir: number,
  kYaw: number,
): number {
  const yawRad = Math.atan2(crosswind, vAir);
  const yawDeg = (yawRad * 180) / Math.PI;
  return 1 + kYaw * Math.abs(yawDeg) / 10;
}

/**
 * Training/racing normalized power (NP).
 * NP = (mean(rolling_30s(P)^4))^(1/4)
 *
 * Spec section 6.5. Window = 30 * hz samples (30-second rolling mean).
 * For arrays shorter than the window, each sample uses the prefix up to that point.
 *
 * @param samples  Power samples in W
 * @param hz       Sampling rate in Hz (default 1 Hz)
 * @returns NP in W
 */
export function normalizedPower(samples: number[], hz = 1): number {
  if (samples.length === 0) return 0;

  const window = 30 * hz;
  const rolling: number[] = [];

  for (let i = 0; i < samples.length; i++) {
    // Use available prefix for samples before a full window is available
    const start = Math.max(0, i - window + 1);
    const slice = samples.slice(start, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    rolling.push(mean);
  }

  // Mean of (rolling^4), then take the fourth root
  const meanFourthPow =
    rolling.reduce((a, v) => a + v ** 4, 0) / rolling.length;
  return meanFourthPow ** 0.25;
}
