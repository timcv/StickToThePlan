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
} from '@stp/core';

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
}

/**
 * Build a ThreeScenarios from a single calm-wind plan: with no wind data the
 * expected / optimistic / pessimistic plans are identical, so we solve once and
 * reuse the result in all three slots (mirrors cli.ts calmThreeScenarios).
 */
function calmThreeScenarios(plan: PlanResult): ThreeScenarios {
  return { expected: plan, optimistic: plan, pessimistic: plan };
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

  // 2. GPX ingest -> microsegments.
  const micro = ingestGpxString(gpxText, cfg);

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

  return { scenarios, displaySegments, styrkortSegments, splits, anchor, npTargetUsed, cfg, micro, controls };
}
