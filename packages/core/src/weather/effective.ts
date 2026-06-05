/**
 * Effective wind: convert forecast wind (given at forecast_wind_height_m, e.g.
 * 10 m) to the wind the cyclist feels (rider_wind_height_m, e.g. 1.2 m) using
 * the neutral logarithmic wind profile. Pure, deterministic, no IO.
 *
 *   U(z) ∝ ln(z / z0)
 *   factor = U(riderH) / U(forecastH) = ln(riderH/z0) / ln(forecastH/z0)
 *
 * z0 is the aerodynamic roughness length (m). Lower z0 (open water, bridges) =>
 * less near-ground slowdown => higher factor. Higher z0 (forest, buildings) =>
 * more shelter => lower factor. The factor is floored at 0.15 because the bare
 * log profile over-shelters tall-roughness classes for a rider on an open road
 * gap, and capped at 1 (rider level is never windier than forecast level here).
 */
import type { ExposureClass } from '../types.js';

const K_FLOOR = 0.15;

export function heightFactor(z0: number, riderH = 1.2, forecastH = 10): number {
  if (!(z0 > 0) || !(riderH > 0) || !(forecastH > 0)) {
    throw new Error(
      `heightFactor: z0, riderH, forecastH must all be > 0 (got z0=${z0}, riderH=${riderH}, forecastH=${forecastH})`,
    );
  }
  const k = Math.log(riderH / z0) / Math.log(forecastH / z0);
  return Math.min(1, Math.max(K_FLOOR, k));
}

export function adjustWindForHeight(
  rawWind_ms: number,
  z0: number,
  riderH = 1.2,
  forecastH = 10,
): number {
  return Math.max(0, rawWind_ms * heightFactor(z0, riderH, forecastH));
}

const TERRAIN_Z0: Record<'open' | 'mixed' | 'sheltered', number> = {
  open: 0.03,
  mixed: 0.05,
  sheltered: 0.3,
};

export function terrainToZ0(terrain: 'open' | 'mixed' | 'sheltered'): number {
  return TERRAIN_Z0[terrain];
}

// Starting values, literature-derived, configurable, NOT calibrated to real rides.
const CLASS_Z0: Record<ExposureClass, number> = {
  water: 0.001,
  bridge: 0.002,
  open: 0.03,
  semi_open: 0.08,
  forest: 0.3,
  urban: 0.4,
  sheltered: 0.5,
};

export function exposureClassToZ0(cls: ExposureClass): number {
  return CLASS_Z0[cls];
}
