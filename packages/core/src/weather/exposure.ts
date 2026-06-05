/**
 * Per-segment exposure: map baked land-cover runs onto microsegments so the
 * effective-wind engine can use a per-segment roughness. Pure, no IO. The
 * baked file is produced offline by scripts/bake-exposure.mjs and injected by
 * the app/CLI layer (core never fetches it).
 */
import type { MicroSegment, ExposureClass } from '../types.js';
import { exposureClassToZ0 } from './effective.js';

export interface ExposureRun {
  from_km: number;
  to_km: number;
  class: ExposureClass;
}
export interface ExposureRuns {
  route_id: string;
  total_km: number;
  runs: ExposureRun[];
  generated_note?: string;
}

/** Stamp exposure_class + z0_used on each microsegment by its midpoint km. */
export function applyExposure(micros: MicroSegment[], data: ExposureRuns): void {
  if (!data?.runs?.length) return;
  for (const m of micros) {
    const midKm = (m.cum_distance_m - m.distance_m / 2) / 1000;
    // runs are short (~100s) and the route ~thousands of segments; O(n×m) find is fine here
    const run = data.runs.find((r) => midKm >= r.from_km && midKm < r.to_km);
    if (run) {
      m.exposure_class = run.class;
      m.z0_used = exposureClassToZ0(run.class);
    }
  }
}

/** Percent of total distance that carries an exposure_class. */
export function exposureCoveragePct(micros: MicroSegment[]): number {
  let total = 0;
  let covered = 0;
  for (const m of micros) {
    total += m.distance_m;
    if (m.exposure_class) covered += m.distance_m;
  }
  return total > 0 ? (covered / total) * 100 : 0;
}
