/**
 * Connect IQ plan-delta data field source generation (spec section 12.5).
 *
 * The planner re-generates a Monkey C data field on every run, embedding a
 * distance/elapsed lookup table for the current plan. The hard, tested gate is
 * source generation plus a monotonic lookup table. Writing the source to disk
 * and the best-effort monkeyc compile live in the cli package.
 *
 * Exports (pure):
 *   buildLookupTable        - display-segment boundaries -> lookup entries
 *   generatePlanDeltaSource - fill the embedded .mc template placeholders
 */

import type { DisplaySegment, PlanResult, Config } from '../types.js';
import { clockToSeconds } from '../util/time.js';
import { PLAN_DELTA_TEMPLATE } from './template.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LookupEntry {
  distance_m: number;
  elapsed_s: number;
}

// ---------------------------------------------------------------------------
// Lookup table
// ---------------------------------------------------------------------------

/**
 * Build the distance/elapsed lookup table from the display-segment boundaries.
 *
 * Each display segment contributes one boundary: the cumulative distance at its
 * end (to_km * 1000 metres) paired with the planned elapsed seconds at that
 * point (eta_s, which includes stop time, the correct basis for a vs-plan
 * comparison). The table starts at the {0, 0} origin and is made monotonic
 * non-decreasing in distance by dropping out-of-order points and deduping equal
 * distances (keeping the larger elapsed). The result includes the final
 * boundary.
 */
export function buildLookupTable(displaySegments: DisplaySegment[], _plan: PlanResult): LookupEntry[] {
  const raw: LookupEntry[] = [{ distance_m: 0, elapsed_s: 0 }];
  for (const seg of displaySegments) {
    raw.push({ distance_m: Math.round(seg.to_km * 1000), elapsed_s: Math.round(seg.eta_s) });
  }

  // Sort by distance, then by elapsed, so equal distances are adjacent with the
  // larger elapsed last (it wins on dedupe).
  raw.sort((a, b) => (a.distance_m - b.distance_m) || (a.elapsed_s - b.elapsed_s));

  const out: LookupEntry[] = [];
  for (const e of raw) {
    const prev = out[out.length - 1];
    if (prev === undefined) {
      out.push(e);
      continue;
    }
    if (e.distance_m === prev.distance_m) {
      // Same distance: keep the larger elapsed (raw is sorted so e wins).
      if (e.elapsed_s > prev.elapsed_s) {
        prev.elapsed_s = e.elapsed_s;
      }
      continue;
    }
    // Distance increases. Keep elapsed non-decreasing too.
    if (e.elapsed_s < prev.elapsed_s) {
      out.push({ distance_m: e.distance_m, elapsed_s: prev.elapsed_s });
    } else {
      out.push(e);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Source generation
// ---------------------------------------------------------------------------

/**
 * Render the lookup table as a Monkey C array literal of [distance, elapsed]
 * pairs, e.g. [[0,0],[76900,9300],[134000,17880]].
 */
function lookupLiteral(table: LookupEntry[]): string {
  const pairs = table.map((e) => `[${e.distance_m},${e.elapsed_s}]`);
  return `[${pairs.join(',')}]`;
}

/**
 * Generate the PlanDelta.mc source by filling the template placeholders with
 * the lookup table, total planned time, and start clock for this plan.
 */
export function generatePlanDeltaSource(
  displaySegments: DisplaySegment[],
  plan: PlanResult,
  cfg: Config,
): string {
  const template = PLAN_DELTA_TEMPLATE;
  const table = buildLookupTable(displaySegments, plan);

  const source = template
    .replace('/*__LOOKUP__*/', lookupLiteral(table))
    .replace('/*__PLAN_TOTAL_S__*/', String(Math.round(plan.total_time_s)))
    .replace('/*__START_CLOCK_S__*/', String(clockToSeconds(cfg.start_time)));

  return source;
}
