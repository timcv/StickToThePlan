/**
 * CLI entry point and end-to-end pipeline (spec sections 5.3, 12.4, 16).
 *
 * runPlan wires the whole calculator together: load config, ingest GPX, derive
 * the np_target anchor, gather weather (with cache + offline + per-source
 * isolation), solve the three time scenarios, segment, then write the six
 * artifacts (tempokort.md, tempokort.html, workout.fit, course.gpx, course.fit,
 * plan.json).
 *
 * Robustness (spec 16):
 *  - Missing GPX -> a clear error naming the path.
 *  - Dead weather source -> isolated try/catch, plan runs on whatever answered.
 *  - No weather at all (offline + no cache, or all sources down) -> calm-wind
 *    fallback, flagged in the notes and meta.
 *  - Target time unreachable -> a WARNING in the tempokort and a note in the
 *    plan JSON; the fastest sustainable plan is still produced.
 *
 * Date.now() / new Date() are allowed in app code.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  calmWeather,
  solveForTargetTime,
  solveThreeScenarios,
  segment,
  VATTERN_CONTROLS,
  buildEnsemble,
  renderMarkdown,
  renderHtml,
  sampleCellPoints,
  type MicroSegment,
  type EnsembleField,
  type ThreeScenarios,
  type ControlPoint,
  type PlanJsonMeta,
} from '@stp/core';
import { loadConfig } from './loadConfig.js';
import {
  ingestGpx,
  determineAnchor,
  writeWorkout,
  writeCourseGpx,
  writeCourseFit,
  writePlanJson,
} from './fileIo.js';
import { gatherWindSamples } from './weatherFetch.js';
import { readCache, writeCache } from './cache.js';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface RunOptions {
  offline?: boolean;
  outDir?: string;
  configPath?: string;
}

export interface RunSummary {
  artifacts: string[];
  reducedEnsemble: boolean;
  reachable: boolean;
  expectedNp: number;
  expectedTotalS: number;
}

// ---------------------------------------------------------------------------
// Solve helper
// ---------------------------------------------------------------------------

/**
 * Build a ThreeScenarios from a single calm-wind plan: with no wind data the
 * expected / optimistic / pessimistic plans are identical, so we solve once
 * and reuse the result in all three slots.
 */
function calmThreeScenarios(
  micro: MicroSegment[],
  cfg: ReturnType<typeof loadConfig>,
): ThreeScenarios {
  const plan = solveForTargetTime(micro, calmWeather, cfg);
  return {
    expected: plan,
    optimistic: plan,
    pessimistic: plan,
    // No wind data: all three scenarios are identical, so the interval collapses
    // to a point (high - low < 60 s) and the UI shows "spann saknas".
    time_uncertainty_s: {
      expected: plan.total_time_s,
      low: plan.total_time_s,
      high: plan.total_time_s,
      source: 'scenario',
    },
  };
}

// ---------------------------------------------------------------------------
// runPlan
// ---------------------------------------------------------------------------

/**
 * Run the full pipeline and write all artifacts to outDir.
 */
export async function runPlan(opts: RunOptions = {}): Promise<RunSummary> {
  // 1. Config + output directory.
  const cfg = loadConfig(opts.configPath ?? 'config.json');
  const outDir = opts.outDir ?? 'output';
  mkdirSync(outDir, { recursive: true });

  // 2. GPX ingest (clear error if the file is missing).
  if (!existsSync(cfg.gpx_path)) {
    throw new Error(`GPX not found: ${cfg.gpx_path}`);
  }
  const micro = ingestGpx(cfg.gpx_path, cfg);

  // 3. Anchor. determineAnchor logs how np_target was derived; the solver still
  // bisects np_target to hit the target time, so the anchor is informational
  // here (it is surfaced in plan.json for verification).
  const anchor = determineAnchor(cfg);
  console.log(`np_target anchor: ${anchor.np_target_candidate} W. ${anchor.note}`);

  // 4. Weather: cache -> fetch -> ensemble, with offline + per-source isolation.
  const notes: string[] = [];
  let weatherSources: string[] = [];
  let reducedEnsemble = true;
  let useCalm = false;

  let field: EnsembleField | null = readCache(cfg.race_date, cfg.cache_ttl_h, !!opts.offline);

  if (field === null && !opts.offline) {
    // Cache miss/stale and online: fetch fresh from all sources.
    const points = sampleCellPoints(micro);
    const samples = await gatherWindSamples(points, cfg.race_date);
    field = buildEnsemble(samples);
    if (samples.length > 0) {
      // At least one source answered: persist for re-runs / offline.
      writeCache(cfg.race_date, field);
    }
  }

  if (field === null || field.cells.length === 0) {
    // Offline with no cache, or every source failed: no usable wind.
    useCalm = true;
    reducedEnsemble = true;
    weatherSources = [];
    notes.push('No weather data available, using calm wind.');
  } else {
    weatherSources = field.sources;
    reducedEnsemble = field.reduced || field.sources.length < 3;
    if (reducedEnsemble) {
      notes.push(
        `Reduced ensemble: ${field.sources.length} weather source(s) (${field.sources.join(', ') || 'none'}).`,
      );
    }
  }

  // 5. Solve the three scenarios.
  const scenarios: ThreeScenarios =
    useCalm || field === null
      ? calmThreeScenarios(micro, cfg)
      : solveThreeScenarios(micro, field, cfg);

  // 6. Segment the expected plan into display segments.
  const controls = soloControls(cfg, micro);
  const displaySegments = segment(scenarios.expected, cfg, controls);

  // 8. Unreachable target -> WARNING prefix in markdown + plan note.
  let markdown = renderMarkdown(scenarios, displaySegments, cfg);
  if (!scenarios.expected.reachable) {
    const warn =
      `WARNING: target time ${cfg.target_total_hm} is not sustainable. ` +
      `This is the fastest sustainable plan (see notes for where the caps bind).`;
    markdown = `> ${warn}\n\n${markdown}`;
    notes.push(warn);
  }

  // 7. Write the six artifacts.
  const meta: PlanJsonMeta = { reducedEnsemble, weatherSources, notes };

  const mdPath = join(outDir, 'tempokort.md');
  const htmlPath = join(outDir, 'tempokort.html');
  const fitPath = join(outDir, 'workout.fit');
  const coursePath = join(outDir, 'course.gpx');
  const courseFitPath = join(outDir, 'course.fit');
  const planPath = join(outDir, 'plan.json');

  writeFileUtf8(mdPath, markdown);
  writeFileUtf8(htmlPath, renderHtml(scenarios, displaySegments, cfg));
  writeWorkout(displaySegments, cfg, fitPath);
  writeCourseGpx(micro, scenarios.expected, cfg, controls, coursePath);
  writeCourseFit(micro, scenarios.expected, cfg, controls, courseFitPath);
  writePlanJson(scenarios, displaySegments, anchor, cfg, meta, planPath);

  // 9. Summary.
  const artifacts = [mdPath, htmlPath, fitPath, coursePath, courseFitPath, planPath];
  const summary: RunSummary = {
    artifacts,
    reducedEnsemble,
    reachable: scenarios.expected.reachable,
    expectedNp: Math.round(scenarios.expected.np_target_used),
    expectedTotalS: scenarios.expected.total_time_s,
  };

  console.log(
    `Plan written to ${outDir}: expected NP ${summary.expectedNp} W, ` +
      `total ${(summary.expectedTotalS / 3600).toFixed(2)} h, ` +
      `reachable=${summary.reachable}, reducedEnsemble=${summary.reducedEnsemble}, ` +
      `sources=[${weatherSources.join(', ') || 'calm'}].`,
  );

  return summary;
}

// ---------------------------------------------------------------------------
// Control points
// ---------------------------------------------------------------------------

/**
 * Controls for segmentation. For the real Vatternrundan route the locked
 * VATTERN_CONTROLS apply. In solo mode the route is arbitrary, so the control
 * km would not line up; instead we use a Start / Mal pair (snapped to the
 * route ends) plus any configured stops as controls.
 */
function soloControls(cfg: ReturnType<typeof loadConfig>, micro: MicroSegment[]): ControlPoint[] {
  if (!cfg.solo) return VATTERN_CONTROLS;
  const routeKm = micro.length > 0 ? micro[micro.length - 1].cum_distance_m / 1000 : 0;
  const controls: ControlPoint[] = [{ name: 'Start', km: 0 }];
  for (const stop of cfg.stops) {
    controls.push({ name: stop.control, km: stop.km });
  }
  controls.push({ name: 'Mal', km: routeKm });
  return controls;
}

// ---------------------------------------------------------------------------
// Small IO helper (kept here so the writers above read cleanly)
// ---------------------------------------------------------------------------

function writeFileUtf8(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// main / argv parsing
// ---------------------------------------------------------------------------

/**
 * Parse argv into RunOptions. Supports the `plan` subcommand and the flags
 * --offline and --config <path>.
 */
export function parseArgs(argv: string[]): { command: string; opts: RunOptions } {
  const opts: RunOptions = {};
  let command = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--offline') {
      opts.offline = true;
    } else if (arg === '--config') {
      opts.configPath = argv[++i];
    } else if (arg === '--out' || arg === '--outDir') {
      opts.outDir = argv[++i];
    } else if (!command && !arg.startsWith('-')) {
      command = arg;
    }
  }
  return { command, opts };
}

/**
 * CLI main: `node cli.js plan [--offline] [--config path]`.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { command, opts } = parseArgs(argv);
  if (command !== 'plan') {
    console.error(`Usage: vattern plan [--offline] [--config <path>]`);
    process.exit(1);
  }
  try {
    await runPlan(opts);
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// Run main only when executed directly (not when imported by tests).
// import.meta.url is the file URL; process.argv[1] is the invoked script path.
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
