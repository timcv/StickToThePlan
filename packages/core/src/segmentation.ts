// Segmentation: aggregate SegmentPlan (micro-level) into DisplaySegment for
// the tempokort and FIT workout.
// Spec reference: section 11 (segmentation) and section 12.1 (raceplan columns).

import type { PlanResult, DisplaySegment, Config, SegmentPlan } from './types.js';

// ---------------------------------------------------------------------------
// Control points
// ---------------------------------------------------------------------------

export interface ControlPoint {
  name: string;
  km: number;
}

/** Locked Vatternrundan control points (section 4.1). */
export const VATTERN_CONTROLS: ControlPoint[] = [
  { name: 'Motala', km: 0 },
  { name: 'Hästholmen', km: 40 },
  { name: 'Gränna', km: 77 },
  { name: 'Jönköping', km: 105 },
  { name: 'Fagerhult', km: 134 },
  { name: 'Hjo', km: 173 },
  { name: 'Karlsborg', km: 204 },
  { name: 'Boviken', km: 226 },
  { name: 'Askersund', km: 256 },
  { name: 'Godegård', km: 284 },
  { name: 'Motala (mål)', km: 315 },
];

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface Group {
  indices: number[]; // indices into plan.segments
  segs: SegmentPlan[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(x: number): number {
  return Math.round(x);
}

/**
 * Snap a target cumulative distance (m) to the nearest SegmentPlan boundary.
 * Returns the cum_distance_m of the chosen segment (i.e. the END of that segment).
 */
function snapToBoundary(targetM: number, segments: SegmentPlan[]): number {
  let best = segments[0].micro.cum_distance_m;
  let bestDiff = Math.abs(best - targetM);
  for (const s of segments) {
    const d = Math.abs(s.micro.cum_distance_m - targetM);
    if (d < bestDiff) {
      bestDiff = d;
      best = s.micro.cum_distance_m;
    }
  }
  return best;
}

/**
 * Compute the wind label for a group of SegmentPlans.
 * Uses mean headwind and mean absolute crosswind over the group.
 */
function windLabel(segs: SegmentPlan[]): string {
  if (segs.length === 0) return 'Lugnt';
  const meanHead = segs.reduce((s, p) => s + p.headwind_ms, 0) / segs.length;
  const meanCross = segs.reduce((s, p) => s + Math.abs(p.crosswind_ms), 0) / segs.length;
  if (meanHead > 1) return `Mot ${round(meanHead)} m/s`;
  if (meanHead < -1) return `Med ${round(-meanHead)} m/s`;
  if (meanCross > 1) return `Sido ${round(meanCross)} m/s`;
  return 'Lugnt';
}

/**
 * Aggregate a group of SegmentPlan into a DisplaySegment.
 * cfg is used for band_pct and stop lookup.
 * controlAtEnd: the ControlPoint whose km matches the end boundary, if any.
 * stopMinutesAtEnd: the stop minutes for that control, if any.
 */
function aggregateGroup(
  group: Group,
  cfg: Config,
  allSegs: SegmentPlan[],
  controlAtEnd: ControlPoint | undefined,
  stopMinutesAtEnd: number | undefined,
): DisplaySegment {
  const segs = group.segs;
  const firstMicro = segs[0].micro;
  const lastSeg = segs[segs.length - 1];
  const lastMicro = lastSeg.micro;

  // from_km: start of the first micro (cum_distance_m - distance_m gives start of segment)
  const startCumM = firstMicro.cum_distance_m - firstMicro.distance_m;
  const endCumM = lastMicro.cum_distance_m;

  const from_km = Math.round(startCumM / 100) / 10;
  const to_km = Math.round(endCumM / 100) / 10;

  const distance_m = segs.reduce((s, p) => s + p.micro.distance_m, 0);
  const net_height_m = segs.reduce((s, p) => s + (p.micro.ele_end_m - p.micro.ele_start_m), 0);
  const avg_grade = distance_m > 0 ? net_height_m / distance_m : 0;

  const eta_s = lastSeg.eta_s;

  const total_time_s = segs.reduce((s, p) => s + p.time_s, 0);
  const avg_speed_kmh = total_time_s > 0 ? (distance_m / total_time_s) * 3.6 : 0;

  // Power: only non-neutral segments contribute.
  const effortSegs = segs.filter(s => !s.micro.neutral);
  let pull_w_mean = 0;
  let avg_w = 0;
  if (effortSegs.length > 0) {
    pull_w_mean = effortSegs.reduce((s, p) => s + p.p_pull_w, 0) / effortSegs.length;
    avg_w = round(effortSegs.reduce((s, p) => s + p.p_mean_w, 0) / effortSegs.length);
  }
  const pull_w_low = round(pull_w_mean * (1 - cfg.band_pct));
  const pull_w_high = round(pull_w_mean * (1 + cfg.band_pct));

  const wind = windLabel(segs);
  const meanHead = segs.length > 0
    ? segs.reduce((s, p) => s + p.headwind_ms, 0) / segs.length
    : 0;

  const town = controlAtEnd?.name;

  let stop_minutes: number | undefined;
  let depart_s: number | undefined;
  if (stopMinutesAtEnd !== undefined && stopMinutesAtEnd > 0) {
    stop_minutes = stopMinutesAtEnd;
    depart_s = eta_s + stop_minutes * 60;
  }

  // Note keyword (Swedish).
  // Determine if this is the last climbing segment before the finish.
  let note: string;
  if (stop_minutes !== undefined) {
    note = 'DEPÅ';
  } else if (avg_grade > cfg.climb_threshold) {
    // Check if this is the last climbing display segment before the finish.
    // We detect this at finalization time (after all groups are known).
    // For now, mark as KLÄTTRING and patch to SISTA UPPFÖR in a post-pass.
    note = 'KLÄTTRING';
  } else if (avg_grade < -cfg.climb_threshold) {
    note = 'BACKAR';
  } else if (meanHead > 3) {
    note = 'TA DET LUGNT';
  } else if (meanHead < -3) {
    note = 'ÖKA';
  } else {
    note = 'JÄMN FART';
  }

  return {
    from_km,
    to_km,
    town,
    distance_m,
    net_height_m,
    avg_grade,
    avg_speed_kmh: Math.round(avg_speed_kmh * 10) / 10,
    eta_s,
    wind_label: wind,
    pull_w_low,
    pull_w_high,
    avg_w,
    note,
    stop_minutes,
    depart_s,
    micro_indices: [...group.indices],
  };
}

/**
 * Re-aggregate two adjacent DisplaySegment groups into one.
 * Used for the merge pass.
 */
function mergeDisplaySegs(a: DisplaySegment, b: DisplaySegment): DisplaySegment {
  const distance_m = a.distance_m + b.distance_m;
  const net_height_m = a.net_height_m + b.net_height_m;
  const avg_grade = distance_m > 0 ? net_height_m / distance_m : 0;

  // Weighted average wind label: recompute from the already-labeled strings is
  // not ideal, but we need numeric values. We will derive them from avg_grade
  // and the stored wind_label. Instead, store the mean headwind numerically
  // during build, but since DisplaySegment only has wind_label, we re-derive.
  // Simple approach: keep b's eta, merge indices, pick note from the dominant
  // half by distance.
  const aNote = a.note;
  const bNote = b.note;
  const note = a.distance_m >= b.distance_m ? aNote : bNote;

  // pull_w: weighted average of the two averages (by distance).
  const totalDist = distance_m;
  const aW = a.avg_w;
  const bW = b.avg_w;
  const avg_w = totalDist > 0 ? round((aW * a.distance_m + bW * b.distance_m) / totalDist) : 0;

  // Weighted pull mean for band computation.
  const aPullMid = (a.pull_w_low + a.pull_w_high) / 2;
  const bPullMid = (b.pull_w_low + b.pull_w_high) / 2;
  const pullMid = totalDist > 0
    ? (aPullMid * a.distance_m + bPullMid * b.distance_m) / totalDist
    : 0;
  // We do not have band_pct here, so approximate: use b's band ratio as proxy.
  // Since band_pct is uniform we can recover it: band_pct ~ (high - low) / (2 * mid).
  const bandRatio = aPullMid > 0 ? (a.pull_w_high - a.pull_w_low) / (2 * aPullMid) : 0;
  const pull_w_low = round(pullMid * (1 - bandRatio));
  const pull_w_high = round(pullMid * (1 + bandRatio));

  // Wind label: pick from whichever half has larger distance.
  const wind_label = a.distance_m >= b.distance_m ? a.wind_label : b.wind_label;

  // avg_speed_kmh: time-weighted harmonic mean (total_dist / total_time).
  const time_a = a.avg_speed_kmh > 0 ? a.distance_m / (a.avg_speed_kmh / 3.6) : 0;
  const time_b = b.avg_speed_kmh > 0 ? b.distance_m / (b.avg_speed_kmh / 3.6) : 0;
  const total_time = time_a + time_b;
  const avg_speed_kmh = total_time > 0
    ? Math.round(((a.distance_m + b.distance_m) / total_time) * 3.6 * 10) / 10
    : 0;

  // town / stop_minutes / depart_s: preserve b (the end boundary matters).
  return {
    from_km: a.from_km,
    to_km: b.to_km,
    town: b.town,
    distance_m,
    net_height_m,
    avg_grade,
    avg_speed_kmh,
    eta_s: b.eta_s,
    wind_label,
    pull_w_low,
    pull_w_high,
    avg_w,
    note: b.stop_minutes !== undefined ? 'DEPÅ' : note,
    stop_minutes: b.stop_minutes,
    depart_s: b.depart_s,
    micro_indices: [...a.micro_indices, ...b.micro_indices],
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface SegmentOptions {
  /** Merge any display segment shorter than this into its nearest-avg_w neighbour.
   *  Defaults to cfg.min_segment_km. Set to 0 to disable. */
  minSegmentKm?: number;
  /** Merge down to at most this many display segments. Defaults to 50. */
  maxSegments?: number;
  /** Skip grade-transition and wind-flip boundaries; only use controls + stops.
   *  Produces smoother segments suited for a compact handlebar card. */
  compactMode?: boolean;
}

/**
 * Aggregate plan.segments (SegmentPlan[]) into DisplaySegment[] for the
 * tempokort and FIT workout. See spec section 11 and 12.1.
 *
 * Boundary types (unless compactMode):
 *  - control point km markers (snapped to nearest segment boundary)
 *  - stop km markers from cfg.stops
 *  - grade-state transitions (flat <-> climb where grade crosses climb_threshold)
 *  - headwind-sign flips (headwind_ms sign changes with magnitude > 1 m/s)
 *  - route start and end (always)
 *
 * After boundary-based splitting the list is merged down to <= maxSegments
 * by repeatedly combining the most similar-avg_w pair that does not cross a
 * depot boundary.
 */
export function segment(
  plan: PlanResult,
  cfg: Config,
  controls: ControlPoint[] = VATTERN_CONTROLS,
  opts: SegmentOptions = {},
): DisplaySegment[] {
  const { compactMode = false } = opts;
  const segments = plan.segments;
  if (segments.length === 0) return [];

  // Build a set of cumulative-distance boundary values (in metres).
  // A boundary is the cum_distance_m of the LAST segment in a group
  // (i.e. the END of that boundary segment).
  const boundarySet = new Set<number>();

  // Always include the start (represented as 0, meaning "before segment 0")
  // and the end.
  // We'll track boundaries as "split after segment at cum_distance_m = X",
  // which means segment X is the LAST segment of its group.
  // The end of the last segment is always a boundary.
  boundarySet.add(segments[segments.length - 1].micro.cum_distance_m);

  // Control points.
  for (const cp of controls) {
    if (cp.km === 0) continue; // start marker; route start is implicit
    const snapped = snapToBoundary(cp.km * 1000, segments);
    boundarySet.add(snapped);
  }

  // Stop km markers.
  for (const stop of cfg.stops) {
    const snapped = snapToBoundary(stop.km * 1000, segments);
    boundarySet.add(snapped);
  }

  if (!compactMode) {
    // Grade-state transitions (flat <-> climb).
    const thr = cfg.climb_threshold;
    let prevAboveThreshold = segments[0].micro.grade > thr;
    for (let i = 1; i < segments.length; i++) {
      const above = segments[i].micro.grade > thr;
      if (above !== prevAboveThreshold) {
        boundarySet.add(segments[i - 1].micro.cum_distance_m);
        prevAboveThreshold = above;
      }
    }

    // Head<->tail wind sign transitions (magnitude > 1 m/s).
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1].headwind_ms;
      const curr = segments[i].headwind_ms;
      if (Math.abs(prev) > 1 && Math.abs(curr) > 1 && Math.sign(prev) !== Math.sign(curr)) {
        boundarySet.add(segments[i - 1].micro.cum_distance_m);
      }
    }
  }

  // Sort boundaries.
  const boundaries = Array.from(boundarySet).sort((a, b) => a - b);

  // Build lookup: cum_distance_m -> index in segments.
  const cumToIdx = new Map<number, number>();
  for (let i = 0; i < segments.length; i++) {
    cumToIdx.set(segments[i].micro.cum_distance_m, i);
  }

  // Build groups. Each group is a contiguous range of segments.
  // A group ends at a boundary cum_distance_m.
  const groups: Group[] = [];
  let groupStart = 0;

  for (const bnd of boundaries) {
    const bndIdx = cumToIdx.get(bnd);
    if (bndIdx === undefined) continue; // snapped value not found exactly; skip
    if (bndIdx < groupStart) continue;  // already past this boundary

    const indices: number[] = [];
    for (let i = groupStart; i <= bndIdx; i++) {
      indices.push(i);
    }
    if (indices.length > 0) {
      groups.push({ indices, segs: indices.map(i => segments[i]) });
    }
    groupStart = bndIdx + 1;
  }

  // Any remaining segments after the last boundary.
  if (groupStart < segments.length) {
    const indices: number[] = [];
    for (let i = groupStart; i < segments.length; i++) {
      indices.push(i);
    }
    groups.push({ indices, segs: indices.map(i => segments[i]) });
  }

  // Build a lookup: which control (if any) ends at this cum_distance_m?
  const controlAtCum = new Map<number, ControlPoint>();
  for (const cp of controls) {
    if (cp.km === 0) continue;
    const snapped = snapToBoundary(cp.km * 1000, segments);
    controlAtCum.set(snapped, cp);
  }

  // Which stops (if any) end at this cum_distance_m?
  const stopAtCum = new Map<number, number>(); // cum -> minutes
  for (const stop of cfg.stops) {
    const snapped = snapToBoundary(stop.km * 1000, segments);
    stopAtCum.set(snapped, stop.minutes);
  }

  // Aggregate each group into a DisplaySegment.
  let displaySegs: DisplaySegment[] = groups.map(g => {
    const lastCum = g.segs[g.segs.length - 1].micro.cum_distance_m;
    const controlAtEnd = controlAtCum.get(lastCum);
    const stopMinutesAtEnd = stopAtCum.get(lastCum);
    return aggregateGroup(g, cfg, segments, controlAtEnd, stopMinutesAtEnd);
  });

  // Post-pass: patch the last KLÄTTRING before the finish to SISTA UPPFÖR.
  let lastClimbIdx = -1;
  for (let i = displaySegs.length - 1; i >= 0; i--) {
    if (displaySegs[i].note === 'KLÄTTRING') {
      lastClimbIdx = i;
      break;
    }
  }
  if (lastClimbIdx >= 0) {
    // Only mark SISTA UPPFÖR if there are non-climb segments after it
    // (i.e. it really is the last one before a downhill or flat to the finish).
    const hasNonClimbAfter = displaySegs.slice(lastClimbIdx + 1).some(
      s => s.note !== 'KLÄTTRING' && s.note !== 'SISTA UPPFÖR',
    );
    if (hasNonClimbAfter) {
      displaySegs[lastClimbIdx] = { ...displaySegs[lastClimbIdx], note: 'SISTA UPPFÖR' };
    }
  }

  // Merge segments shorter than minSegmentKm into their nearest-avg_w neighbour.
  // Hard boundaries (depot stops) are never merged across.
  const minM = (opts.minSegmentKm ?? cfg.min_segment_km) * 1000;
  if (minM > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < displaySegs.length; i++) {
        const seg = displaySegs[i];
        if (seg.distance_m >= minM) continue;
        if (seg.stop_minutes !== undefined) continue; // hard boundary, skip
        // Find best neighbour (closest avg_w, not a depot boundary between them).
        let bestIdx = -1;
        let bestDiff = Infinity;
        if (i > 0 && displaySegs[i - 1].stop_minutes === undefined) {
          const diff = Math.abs(displaySegs[i - 1].avg_w - seg.avg_w);
          if (diff < bestDiff) { bestDiff = diff; bestIdx = i - 1; }
        }
        if (i < displaySegs.length - 1 && displaySegs[i + 1].stop_minutes === undefined) {
          const diff = Math.abs(displaySegs[i + 1].avg_w - seg.avg_w);
          if (diff < bestDiff) { bestIdx = i + 1; }
        }
        if (bestIdx === -1) continue;
        const lo = Math.min(i, bestIdx);
        const hi = Math.max(i, bestIdx);
        const merged = mergeDisplaySegs(displaySegs[lo], displaySegs[hi]);
        displaySegs = [
          ...displaySegs.slice(0, lo),
          merged,
          ...displaySegs.slice(hi + 1),
        ];
        changed = true;
        break; // restart scan after any merge
      }
    }
  }

  // Merge adjacent segments whose gradient is near-identical. This collapses
  // cosmetic splits (e.g. a wind-sign flip that still reads as the same effort)
  // where the rows differ only by a fraction of a percent in grade. It runs
  // AFTER the minSegmentKm merge so it operates on already-coarsened rows: at
  // raw resolution neighbouring grades are noisy and rarely match, but the
  // consolidated rows expose the genuine same-gradient stretches.
  // Rules: same note (never blend a climb / headwind row into flat), never
  // cross a depot stop, and never cross a control town (a ends on a control)
  // so town markers stay visible. Comparing against the *merged* grade each
  // pass lets a long gentle stretch chain together and stop on its own.
  const gradeThr = cfg.grade_merge_pct;
  if (gradeThr > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < displaySegs.length - 1; i++) {
        const a = displaySegs[i];
        const b = displaySegs[i + 1];
        if (a.stop_minutes !== undefined || b.stop_minutes !== undefined) continue;
        if (a.town !== undefined) continue; // a ends at a control: keep town visible
        if (a.note !== b.note) continue;
        if (Math.abs(a.avg_grade - b.avg_grade) >= gradeThr) continue;
        const merged = mergeDisplaySegs(a, b);
        displaySegs = [
          ...displaySegs.slice(0, i),
          merged,
          ...displaySegs.slice(i + 2),
        ];
        changed = true;
        break; // restart scan after any merge
      }
    }
  }

  // Merge down to <= maxSegments display segments.
  // Strategy: find the pair of adjacent segments with the most similar avg_w
  // that does not cross a depot boundary (neither a nor b is a depot, and
  // neither has stop_minutes set).
  const maxSegs = opts.maxSegments ?? 50;
  while (displaySegs.length > maxSegs) {
    let bestDiff = Infinity;
    let bestIdx = -1;

    for (let i = 0; i < displaySegs.length - 1; i++) {
      const a = displaySegs[i];
      const b = displaySegs[i + 1];
      // Do not merge across a depot boundary.
      if (a.stop_minutes !== undefined || b.stop_minutes !== undefined) continue;
      const diff = Math.abs(a.avg_w - b.avg_w);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      // All remaining splits are depot boundaries; cannot merge further.
      break;
    }

    const merged = mergeDisplaySegs(displaySegs[bestIdx], displaySegs[bestIdx + 1]);
    displaySegs = [
      ...displaySegs.slice(0, bestIdx),
      merged,
      ...displaySegs.slice(bestIdx + 2),
    ];
  }

  return displaySegs;
}
