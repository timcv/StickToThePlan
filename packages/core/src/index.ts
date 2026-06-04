/**
 * Public surface of @stp/core: the pure, browser-safe race-plan math and
 * output builders. The cli and web app consume the calculator only through
 * these re-exports. NodeNext ESM: relative specifiers keep the .js extension.
 */

// Types.
export type {
  Stop,
  Config,
  PhysicsParams,
  WindCond,
  RoutePoint,
  MicroSegment,
  FitPassMetrics,
  SegmentPlan,
  StopPlan,
  PlanResult,
  WindSample,
  Scenario,
  WeatherFn,
  DisplaySegment,
} from './types.js';

// Physics, chaingang, planner, segmentation.
export * from './physics.js';
export * from './chaingang.js';
export * from './planner.js';
export { segment, VATTERN_CONTROLS, type ControlPoint } from './segmentation.js';

// Config: pure defaults.
export { applyDefaults, type RawConfig } from './config.js';

// Geo + time helpers.
export * from './util/geo.js';
export * from './util/time.js';

// Ingest: GPX (string-based) and FIT (bytes-based) pure entry points.
export {
  dedupePoints,
  smoothElevation,
  buildMicroSegments,
  parseGpxString,
  ingestGpxString,
} from './ingest/gpx.js';
export { analyzePass, readFitPowerBytes, determineAnchorFromPower } from './ingest/fit.js';

// Output builders.
export { renderMarkdown, renderHtml } from './output/tempokort.js';
export { buildCourseGpx } from './output/course.js';
export {
  buildSteps,
  encodeWorkout,
  type WorkoutStepTarget,
} from './output/fitWorkout.js';
export { buildPlanJson, type PlanJsonMeta } from './output/planJson.js';

// Weather: url builders + parsers (pure) and the browser-safe Open-Meteo fetch.
export * from './weather/openMeteo.js';
export { buildSmhiUrl, parseSmhi } from './weather/smhi.js';
export { buildMetNorwayUrl, metNorwayHeaders, parseMetNorway } from './weather/metNorway.js';
export {
  buildEnsemble,
  makeWeatherFn,
  type EnsembleCell,
  type EnsembleField,
} from './weather/ensemble.js';

// Connect IQ data-field source generation (pure).
export { buildLookupTable, generatePlanDeltaSource, type LookupEntry } from './ciq/generate.js';
