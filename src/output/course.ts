/**
 * Course GPX output with ETA waypoints.
 * Spec reference: design doc section 12.3.
 *
 * Exports:
 *   buildCourseGpx  - pure function, returns GPX XML string
 *   writeCourseGpx  - writes the string to a file path (UTF-8)
 */

import { writeFileSync } from 'node:fs';
import type { MicroSegment, PlanResult, Config } from '../types.js';
import type { ControlPoint } from '../segmentation.js';
import { secondsToClock } from '../util/time.js';

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/**
 * Escape XML special characters in a string.
 * Preserves Swedish diacritics and all other UTF-8 characters untouched.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Nearest-segment lookup
// ---------------------------------------------------------------------------

/**
 * Find the index of the microsegment whose cum_distance_m is nearest targetM.
 */
function nearestMicroIndex(micros: MicroSegment[], targetM: number): number {
  let bestIdx = 0;
  let bestDiff = Math.abs(micros[0].cum_distance_m - targetM);
  for (let i = 1; i < micros.length; i++) {
    const diff = Math.abs(micros[i].cum_distance_m - targetM);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Find the index of the SegmentPlan whose micro.cum_distance_m is nearest targetM.
 * Returns the eta_s from that segment.
 */
function nearestEtaS(plan: PlanResult, targetM: number): number {
  const segs = plan.segments;
  if (segs.length === 0) return 0;
  let bestIdx = 0;
  let bestDiff = Math.abs(segs[0].micro.cum_distance_m - targetM);
  for (let i = 1; i < segs.length; i++) {
    const diff = Math.abs(segs[i].micro.cum_distance_m - targetM);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return segs[bestIdx].eta_s;
}

// ---------------------------------------------------------------------------
// buildCourseGpx
// ---------------------------------------------------------------------------

/**
 * Build a GPX 1.1 document with:
 *   - One <wpt> per control point (with ETA clock baked into the name,
 *     and stop duration annotation if the control has a stop with minutes > 0).
 *   - One <trk> containing one <trkseg> with one <trkpt> per microsegment.
 *
 * Waypoints are placed before the track element per GPX convention.
 * Swedish diacritics (a, a with umlaut, o with umlaut etc.) are preserved as UTF-8.
 */
export function buildCourseGpx(
  microsegments: MicroSegment[],
  plan: PlanResult,
  cfg: Config,
  controls: ControlPoint[],
): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<gpx version="1.1" creator="StickToThePlan" xmlns="http://www.topografix.com/GPX/1/1">');

  // Build a lookup: control.km (as string key) to stop minutes.
  // A stop matches when its km equals the control km exactly.
  const stopMinutesForKm = new Map<number, number>();
  for (const stop of cfg.stops) {
    if (stop.minutes > 0) {
      stopMinutesForKm.set(stop.km, stop.minutes);
    }
  }

  // Waypoints: one per control point, placed before <trk>.
  for (const cp of controls) {
    const targetM = cp.km * 1000;

    // Find the nearest microsegment for lat/lon.
    const microIdx = nearestMicroIndex(microsegments, targetM);
    const micro = microsegments[microIdx];

    // Find the nearest ETA from the plan.
    const eta_s = nearestEtaS(plan, targetM);

    // Build the waypoint name.
    const clock = secondsToClock(eta_s, cfg.start_time);
    let name = `${cp.name} ${clock}`;

    // Append stop duration if this control has a stop.
    const stopMin = stopMinutesForKm.get(cp.km);
    if (stopMin !== undefined) {
      name += ` (${stopMin} min)`;
    }

    lines.push(
      `  <wpt lat="${micro.lat}" lon="${micro.lon}">`,
      `    <name>${escapeXml(name)}</name>`,
      `  </wpt>`,
    );
  }

  // Track section.
  lines.push('  <trk>');
  lines.push('    <name>Vatternrundan</name>');
  lines.push('    <trkseg>');

  for (const micro of microsegments) {
    lines.push(
      `      <trkpt lat="${micro.lat}" lon="${micro.lon}">`,
      `        <ele>${micro.ele_start_m}</ele>`,
      `      </trkpt>`,
    );
  }

  lines.push('    </trkseg>');
  lines.push('  </trk>');
  lines.push('</gpx>');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// writeCourseGpx
// ---------------------------------------------------------------------------

/**
 * Build the course GPX string and write it to outPath using UTF-8 encoding.
 */
export function writeCourseGpx(
  microsegments: MicroSegment[],
  plan: PlanResult,
  cfg: Config,
  controls: ControlPoint[],
  outPath: string,
): void {
  const gpx = buildCourseGpx(microsegments, plan, cfg, controls);
  writeFileSync(outPath, gpx, 'utf-8');
}
