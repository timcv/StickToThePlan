/**
 * Machine-readable plan JSON (spec section 12.4).
 *
 * buildPlanJson assembles a plain serializable object holding the whole plan:
 * the resolved config, the FIT anchor, a per-scenario summary (expected /
 * optimistic / pessimistic), the expected scenario's full per-segment data,
 * the stops, the display segments and a meta block (reduced ensemble, weather
 * sources, notes).
 */

import type { Config, FitPassMetrics, DisplaySegment, PlanResult } from '../types.js';
import type { ThreeScenarios } from '../planner.js';

// ---------------------------------------------------------------------------
// Meta block carried into the plan JSON.
// ---------------------------------------------------------------------------

export interface PlanJsonMeta {
  reducedEnsemble: boolean;
  weatherSources: string[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * One-line scenario summary: anchor NP and the time breakdown the scenario
 * required to hit the target total. Reachable + notes surface caps / fallbacks.
 */
function scenarioSummary(plan: PlanResult): Record<string, unknown> {
  return {
    np_target_used: plan.np_target_used,
    rider_np_ride_w: plan.rider_np_ride_w,
    intensity_factor: plan.intensity_factor,
    total_time_s: plan.total_time_s,
    rolling_time_s: plan.rolling_time_s,
    stop_time_s: plan.stop_time_s,
    reachable: plan.reachable,
    notes: plan.notes,
  };
}

/**
 * Flatten a SegmentPlan into the documented per-segment record (spec 12.4).
 * grade / bearing / distances come off the micro; the rest off the plan row.
 */
function segmentRecord(seg: PlanResult['segments'][number]): Record<string, unknown> {
  return {
    index: seg.micro.index,
    cum_distance_m: seg.micro.cum_distance_m,
    distance_m: seg.micro.distance_m,
    grade: seg.micro.grade,
    bearing: seg.micro.bearing_deg,
    v_ms: seg.v_ms,
    speed_kmh: seg.speed_kmh,
    p_pull_w: seg.p_pull_w,
    p_draft_w: seg.p_draft_w,
    p_mean_w: seg.p_mean_w,
    rider_np_w: seg.rider_np_w,
    headwind_ms: seg.headwind_ms,
    crosswind_ms: seg.crosswind_ms,
    rho: seg.rho,
    eta_s: seg.eta_s,
    cap_binding: seg.cap_binding,
  };
}

// ---------------------------------------------------------------------------
// buildPlanJson
// ---------------------------------------------------------------------------

/**
 * Assemble the plan JSON object. Pure: no IO, fully serializable.
 */
export function buildPlanJson(
  scenarios: ThreeScenarios,
  displaySegments: DisplaySegment[],
  anchor: FitPassMetrics,
  cfg: Config,
  meta: PlanJsonMeta,
): object {
  return {
    config: cfg,
    anchor,
    scenarios: {
      expected: scenarioSummary(scenarios.expected),
      optimistic: scenarioSummary(scenarios.optimistic),
      pessimistic: scenarioSummary(scenarios.pessimistic),
    },
    // Full per-segment detail for the expected scenario.
    segments: scenarios.expected.segments.map(segmentRecord),
    stops: scenarios.expected.stops,
    displaySegments,
    meta,
  };
}
