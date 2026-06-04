/**
 * Filesystem IO wrappers around the pure @stp/core builders and parsers.
 * The core package never touches the disk; every read/write lives here.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  parseGpxString,
  ingestGpxString,
  readFitPowerBytes,
  determineAnchorFromPower,
  buildCourseGpx,
  buildSteps,
  encodeWorkout,
  buildPlanJson,
  type RoutePoint,
  type MicroSegment,
  type FitPassMetrics,
  type Config,
  type PlanResult,
  type DisplaySegment,
  type ControlPoint,
  type ThreeScenarios,
  type PlanJsonMeta,
} from '@stp/core';

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

/**
 * Parse a GPX file and return an array of RoutePoints.
 */
export function parseGpx(path: string): RoutePoint[] {
  return parseGpxString(readFileSync(path, 'utf8'));
}

/**
 * Full pipeline: read file -> parse -> dedup -> smooth -> build microsegments.
 */
export function ingestGpx(path: string, cfg: Config): MicroSegment[] {
  return ingestGpxString(readFileSync(path, 'utf8'), cfg);
}

// ---------------------------------------------------------------------------
// FIT
// ---------------------------------------------------------------------------

/**
 * Read raw power values (watts) from a FIT activity file.
 */
export function readFitPower(path: string): number[] {
  return readFitPowerBytes(readFileSync(path));
}

/**
 * Determine the np_target anchor from cfg.
 *
 * If cfg.fit_path is set and the file exists, reads and analyzes the FIT.
 * Otherwise returns a synthetic FitPassMetrics with a 0.60 x ftp fallback.
 */
export function determineAnchor(cfg: Config): FitPassMetrics {
  const powerStream = cfg.fit_path && existsSync(cfg.fit_path) ? readFitPower(cfg.fit_path) : null;
  return determineAnchorFromPower(powerStream, cfg);
}

// ---------------------------------------------------------------------------
// Course GPX
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

// ---------------------------------------------------------------------------
// FIT workout
// ---------------------------------------------------------------------------

/**
 * Build the workout steps and write a distance-based FIT workout file to outPath.
 * Returns the step count and the size of the encoded file in bytes.
 */
export function writeWorkout(
  displaySegments: DisplaySegment[],
  cfg: Config,
  outPath: string,
): { numSteps: number; bytes: number } {
  const steps = buildSteps(displaySegments, cfg);
  const bytes = encodeWorkout(displaySegments, cfg);
  writeFileSync(outPath, Buffer.from(bytes));
  return { numSteps: steps.length, bytes: bytes.length };
}

// ---------------------------------------------------------------------------
// Plan JSON
// ---------------------------------------------------------------------------

/**
 * Build the plan JSON and write it to outPath as pretty-printed UTF-8.
 */
export function writePlanJson(
  scenarios: ThreeScenarios,
  displaySegments: DisplaySegment[],
  anchor: FitPassMetrics,
  cfg: Config,
  meta: PlanJsonMeta,
  outPath: string,
): void {
  const obj = buildPlanJson(scenarios, displaySegments, anchor, cfg, meta);
  writeFileSync(outPath, JSON.stringify(obj, null, 2), 'utf-8');
}
