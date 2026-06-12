/**
 * Styrkort helpers: the compact three-column handlebar card shows arrival time
 * with a signed difference against a "rakt rullsnitt" (a constant rolling-speed
 * reference line) baked into the Ankomst column.
 *
 * The reference speed is the shown plan's own rolling average (distance divided
 * by rolling time, i.e. excluding depot stops). Computing it from the plan keeps
 * the header and every per-row diff self-consistent: the finish-row diff then
 * equals the total stop minutes.
 *
 * These helpers are shared by both the React compact view and the A6 print HTML
 * so the numbers can never diverge between screen and paper.
 */

import type { DisplaySegment, PlanResult } from '../types.js';

export interface StyrkortMeta {
  /** Rakt rullsnitt: distance / rolling time (km/h), excludes depot stops. */
  refSpeedKmh: number;
  /** Totalsnitt inkl. pauser: distance / total time (km/h). */
  totalAvgKmh: number;
}

/**
 * Derive the reference rolling speed and the stops-included average from the
 * expected plan and the route distance (metres). Returns zeros when a divisor is
 * non-positive so callers never propagate NaN/Infinity into the card.
 */
export function styrkortMeta(expected: PlanResult, totalDistanceM: number): StyrkortMeta {
  const km = totalDistanceM / 1000;
  const refSpeedKmh = expected.rolling_time_s > 0 ? km / (expected.rolling_time_s / 3600) : 0;
  const totalAvgKmh = expected.total_time_s > 0 ? km / (expected.total_time_s / 3600) : 0;
  return { refSpeedKmh, totalAvgKmh };
}

/**
 * Minutes the planned arrival is ahead (+) or behind (-) the straight rolling
 * reference line at the segment end. Positive = före (ahead), negative = efter.
 *
 *   referenstid = km / refSpeedKmh           (elapsed seconds from start)
 *   diff        = referenstid - eta_s        (rounded to whole minutes)
 *
 * Always uses the arrival eta_s, never the departure: a depot's stop time must
 * not bias the diff (the departure is shown only as extra info in the card).
 */
export function diffToStraightMin(toKm: number, etaS: number, refSpeedKmh: number): number {
  if (refSpeedKmh <= 0) return 0;
  const refSeconds = (toKm / refSpeedKmh) * 3600;
  return Math.round((refSeconds - etaS) / 60);
}

/**
 * Per-row diff (minutes) against the rolling reference line for an ordered list
 * of styrkort rows, with depot stop time removed from the rider's elapsed clock
 * so stops never bias the value. Each arrival has all PRIOR depot minutes
 * subtracted; the row's own depot stop is not (the arrival precedes the stop).
 *
 * Because the reference speed is the plan's rolling average (distance / rolling
 * time), removing the stop time makes the final row land on ±0: the rider's
 * moving time at the finish equals the rolling reference time there.
 */
export function styrkortDiffsMin(segments: DisplaySegment[], refSpeedKmh: number): number[] {
  let priorStopS = 0;
  const out: number[] = [];
  for (const seg of segments) {
    out.push(diffToStraightMin(seg.to_km, seg.eta_s - priorStopS, refSpeedKmh));
    if (seg.stop_minutes && seg.stop_minutes > 0) priorStopS += seg.stop_minutes * 60;
  }
  return out;
}

/** Signed minute label: "+8", "-12", or "±0" for zero (consistent symbol). */
export function formatDiff(min: number): string {
  if (min === 0) return '±0'; // ±0
  return min > 0 ? `+${min}` : `${min}`;
}

/**
 * Compose the Ankomst cell: "HH:MM (±X)" for a normal passage, or
 * "HH:MM (±X, HH:MM)" at a depot where the trailing time is the planned
 * departure. The word "ut" is intentionally never used.
 */
export function formatAnkomst(etaClock: string, diffMin: number, departClock?: string): string {
  const inner = departClock !== undefined
    ? `${formatDiff(diffMin)}, ${departClock}`
    : formatDiff(diffMin);
  return `${etaClock} (${inner})`;
}
