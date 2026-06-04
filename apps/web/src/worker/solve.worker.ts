/**
 * Compute Web Worker: runs the full @stp/core race-plan pipeline off the main
 * thread so the UI stays responsive while solving.
 *
 * The pipeline body is the plain async `runPipeline` function, exported so it can
 * be unit-tested without spinning up a real Worker. The worker glue at the bottom
 * just forwards `self.onmessage` payloads into it and posts the result back.
 *
 * Determinism: calm mode does zero network I/O, so it is fully reproducible.
 * Network access happens only in open-meteo mode (fetchOpenMeteo).
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
  buildEnsemble,
  fetchOpenMeteo,
  VATTERN_CONTROLS,
  type RawConfig,
  type ThreeScenarios,
  type DisplaySegment,
  type SplitRow,
  type FitPassMetrics,
  type PlanResult,
  type GeoPoint,
  type MicroSegment,
  type WindSample,
} from '@stp/core';

// ---------------------------------------------------------------------------
// Message contract
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
}

export interface PipelineInput {
  gpxText: string;
  fitBytes?: Uint8Array | null;
  form: PipelineForm;
  weatherMode: 'calm' | 'open-meteo';
}

export interface PipelineResult {
  scenarios: ThreeScenarios;
  displaySegments: DisplaySegment[];
  splits: SplitRow[];
  anchor: FitPassMetrics;
  npTargetUsed: number;
}

// ---------------------------------------------------------------------------
// Weather sampling (mirrors packages/cli/src/cli.ts sampleWeatherPoints)
// ---------------------------------------------------------------------------

/**
 * Reduce the microsegments to ~10 representative sample points (every
 * ceil(n/10) segments, plus the final segment) to bound the number of weather
 * API calls. Each point is the segment START coordinate.
 */
function sampleWeatherPoints(micro: MicroSegment[]): GeoPoint[] {
  if (micro.length === 0) return [];
  const step = Math.max(1, Math.ceil(micro.length / 10));
  const points: GeoPoint[] = [];
  for (let i = 0; i < micro.length; i += step) {
    points.push({ lat: micro[i].lat, lon: micro[i].lon });
  }
  const last = micro[micro.length - 1];
  const lastPoint = points[points.length - 1];
  if (!lastPoint || lastPoint.lat !== last.lat || lastPoint.lon !== last.lon) {
    points.push({ lat: last.lat, lon: last.lon });
  }
  return points;
}

/**
 * Build a ThreeScenarios from a single calm-wind plan: with no wind data the
 * expected / optimistic / pessimistic plans are identical, so we solve once and
 * reuse the result in all three slots (mirrors cli.ts calmThreeScenarios).
 */
function calmThreeScenarios(plan: PlanResult): ThreeScenarios {
  return { expected: plan, optimistic: plan, pessimistic: plan };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full race-plan pipeline. Pure for weatherMode 'calm'; performs network
 * fetches only for 'open-meteo'.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { gpxText, fitBytes, form, weatherMode } = input;

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

  // 4. Weather + scenarios.
  let scenarios: ThreeScenarios;
  if (weatherMode === 'calm') {
    const plan = solveForTargetTime(micro, calmWeather, cfg);
    scenarios = calmThreeScenarios(plan);
  } else {
    const points = sampleWeatherPoints(micro);
    const samples: WindSample[] = await fetchOpenMeteo(points, form.race_date);
    const field = buildEnsemble(samples);
    scenarios = solveThreeScenarios(micro, field, cfg);
  }

  // 5. Segment + split table off the expected plan.
  const displaySegments = segment(scenarios.expected, cfg, VATTERN_CONTROLS);
  const splits = buildSplitTable(scenarios.expected, cfg, VATTERN_CONTROLS);

  return { scenarios, displaySegments, splits, anchor, npTargetUsed };
}

// ---------------------------------------------------------------------------
// Worker glue
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<PipelineInput>) => {
  runPipeline(event.data).then(
    (result) => {
      (self as DedicatedWorkerGlobalScope).postMessage({ ok: true, result });
    },
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      (self as DedicatedWorkerGlobalScope).postMessage({ ok: false, error: message });
    },
  );
};
