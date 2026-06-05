/**
 * Pure pipeline module: the full race-plan computation extracted from the web
 * worker so it can be imported and tested in Node/jsdom without worker globals.
 *
 * solve.worker.ts imports runPipeline from here for its message glue; tests
 * import directly from this module.
 */
import {
  applyDefaults,
  ingestGpxString,
  readFitPowerBytes,
  determineAnchorFromPower,
  calmWeather,
  solveForTargetTime,
  solveThreeScenarios,
  segment,
  buildSplitTable,
  applyExposure,
  type Config,
  type ControlPoint,
  type RawConfig,
  type ThreeScenarios,
  type DisplaySegment,
  type SplitRow,
  type FitPassMetrics,
  type PlanResult,
  type EnsembleField,
  type MicroSegment,
  type ExposureRuns,
} from '@stp/core';
// Baked OSM exposure for the built-in Vätternrundan route. Static JSON import
// bundled at build time (resolveJsonModule + Vite JSON support), NOT a fetch:
// the worker stays network-free. Only applied when the user runs the default
// route (is_default_route); uploaded routes fall back to coarse terrain.
import bakedExposure from '../../../../data/vatternrundan-exposure.json';

// ---------------------------------------------------------------------------
// Message contract (re-exported so solve.worker.ts can import from one place)
// ---------------------------------------------------------------------------

export interface PipelineForm {
  target_total_hm: string;
  ftp: number;
  n_riders: number;
  m: number;
  stops: { control: string; km: number; minutes: number }[];
  watch_target: 'pull' | 'avg';
  race_date: string;
  start_time: string;
  styrkort_max_rows?: number;
  /** Coarse openness used when no per-segment exposure data is available. */
  exposure_terrain?: 'open' | 'mixed' | 'sheltered';
  /**
   * Whether to scale the supplied wind from the forecast 10 m height down to
   * rider level. false = the wind is already "felt" wind at the rider.
   */
  apply_wind_height_correction?: boolean;
  /**
   * True when the bundled Vätternrundan route is being solved, so the baked
   * exposure file applies. Uploaded routes leave this false and fall back to
   * coarse terrain.
   */
  is_default_route?: boolean;
}

export interface PipelineInput {
  gpxText: string;
  fitBytes?: Uint8Array | null;
  form: PipelineForm;
  weatherMode: 'calm' | 'fetched' | 'manual';
  field: EnsembleField | null;
}

export interface PipelineResult {
  scenarios: ThreeScenarios;
  displaySegments: DisplaySegment[];
  styrkortSegments: DisplaySegment[];
  splits: SplitRow[];
  anchor: FitPassMetrics;
  npTargetUsed: number;
  // The applied Config and the ingested microsegments are returned so the main
  // thread can call the pure, fast download builders (FIT workout, course GPX,
  // plan JSON, Connect IQ source) on click without re-running the pipeline. Both
  // are plain objects/arrays and so are structured-clone-safe across the worker
  // boundary.
  cfg: Config;
  micro: MicroSegment[];
  controls: ControlPoint[];
  // Convenience copies of the scenario-level honesty fields so the UI does not
  // have to reach into scenarios. time_uncertainty_s is always present (the calm
  // path collapses it to a point); data_quality is present whenever known.
  time_uncertainty_s: ThreeScenarios['time_uncertainty_s'];
  data_quality?: ThreeScenarios['data_quality'];
}

/**
 * Build a ThreeScenarios from a single calm-wind plan: with no wind data the
 * expected / optimistic / pessimistic plans are identical, so we solve once and
 * reuse the result in all three slots (mirrors cli.ts calmThreeScenarios).
 */
function calmThreeScenarios(plan: PlanResult): ThreeScenarios {
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

/**
 * Control points for a generic uploaded route: the start, the user's stops in
 * km order, and the finish at the route end. This is what makes the depot split
 * table meaningful for any route. (The CLI keeps the fixed VATTERN_CONTROLS for
 * the Vatternrundan example; the web tool is route agnostic, so the depots are
 * the legs between the user's own stops.)
 */
function controlsFromStops(cfg: Config, micro: MicroSegment[]): ControlPoint[] {
  const routeEndKm = micro.length > 0 ? micro[micro.length - 1].cum_distance_m / 1000 : 0;
  const ordered = [...cfg.stops].sort((a, b) => a.km - b.km);
  const controls: ControlPoint[] = [{ name: 'Start', km: 0 }];
  for (const s of ordered) {
    if (s.km > 0 && s.km < routeEndKm) controls.push({ name: s.control, km: s.km });
  }
  controls.push({ name: 'Mål', km: routeEndKm });
  return controls;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full race-plan pipeline. The worker performs zero network I/O: the
 * weather field (if any) is built on the main thread and injected via input.field.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { gpxText, fitBytes, form } = input;

  // 1. Config. gpx_path is a dummy because the GPX XML is fed directly as a
  // string; applyDefaults still requires the mandatory fields.
  const raw: RawConfig = {
    gpx_path: 'web.gpx',
    race_date: form.race_date,
    start_time: form.start_time,
    ftp: form.ftp,
    n_riders: form.n_riders,
    target_total_hm: form.target_total_hm,
    stops: form.stops,
    m: form.m,
    watch_target: form.watch_target,
    styrkort_max_rows: form.styrkort_max_rows,
  };
  const cfg = applyDefaults(raw);
  // Wind-model controls from the form (fall back to the core defaults when the
  // caller omits them so older callers / tests keep working).
  if (form.exposure_terrain !== undefined) cfg.exposure_terrain = form.exposure_terrain;
  if (form.apply_wind_height_correction !== undefined) {
    cfg.apply_wind_height_correction = form.apply_wind_height_correction;
  }

  // 2. GPX ingest -> microsegments.
  const micro = ingestGpxString(gpxText, cfg);

  // 2b. Baked per-segment exposure for the built-in route only. Stamps
  // exposure_class + z0_used on each microsegment so the effective-wind engine
  // uses real land cover instead of the coarse terrain fallback. Uploaded routes
  // skip this (no baked file matches) and rely on cfg.exposure_terrain.
  if (form.is_default_route) {
    applyExposure(micro, bakedExposure as ExposureRuns);
  }

  // 3. Anchor. determineAnchorFromPower(null, cfg) already yields the
  // 0.60 x ftp fallback when no FIT is supplied. We surface the chosen anchor as
  // cfg.np_target for parity with the CLI; the solver still bisects np_target to
  // hit the target time, so this is informational (plan.json verification).
  const powerStream = fitBytes ? readFitPowerBytes(fitBytes) : null;
  const anchor = determineAnchorFromPower(powerStream, cfg);
  cfg.np_target = anchor.np_target_candidate;
  const npTargetUsed = anchor.np_target_candidate;

  // 4. Weather + scenarios. The field is built on the main thread (fetched from
  // /api/weather and/or edited, or synthesised for manual mode). A null field
  // means calm wind. The worker performs zero network I/O.
  let scenarios: ThreeScenarios;
  if (input.field && input.field.cells.length > 0) {
    scenarios = solveThreeScenarios(micro, input.field, cfg);
  } else {
    const plan = solveForTargetTime(micro, calmWeather, cfg);
    scenarios = calmThreeScenarios(plan);
  }

  // 5. Segment + split table off the expected plan, using controls derived
  // from the user's stops so the depot legs match the uploaded route.
  const controls = controlsFromStops(cfg, micro);
  const displaySegments = segment(scenarios.expected, cfg, controls);
  const styrkortSegments = segment(scenarios.expected, cfg, controls, {
    compactMode: true,
    maxSegments: cfg.styrkort_max_rows,
  });
  const splits = buildSplitTable(scenarios.expected, cfg, controls);

  return {
    scenarios,
    displaySegments,
    styrkortSegments,
    splits,
    anchor,
    npTargetUsed,
    cfg,
    micro,
    controls,
    time_uncertainty_s: scenarios.time_uncertainty_s,
    data_quality: scenarios.data_quality,
  };
}
