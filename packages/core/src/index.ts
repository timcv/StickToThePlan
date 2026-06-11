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
  ExposureClass,
  ExposureTerrain,
} from './types.js';

// Physics, chaingang, planner, segmentation.
export * from './physics.js';
export * from './chaingang.js';
export * from './planner.js';
export {
  segment,
  VATTERN_CONTROLS,
  type ControlPoint,
  type SegmentOptions,
} from './segmentation.js';

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
export {
  analyzePass,
  readFitPowerBytes,
  readFitPowerRecords,
  readFitPower1Hz,
  resamplePowerTo1Hz,
  determineAnchorFromPower,
  type PowerRecord,
} from './ingest/fit.js';

// Output builders.
export { renderMarkdown, renderHtml, buildStyrkortHtml } from './output/tempokort.js';
export { buildCourseGpx } from './output/course.js';
export { buildCourseFit } from './output/fitCourse.js';
export { buildSteps, encodeWorkout, type WorkoutStepTarget } from './output/fitWorkout.js';
export { buildPlanJson, type PlanJsonMeta } from './output/planJson.js';
export { buildSplitTable, type SplitRow } from './output/splits.js';

// Weather: url builders + parsers (pure), batched fetch, and multi-source orchestration.
export * from './weather/openMeteo.js';
export { buildSmhiUrl, parseSmhi } from './weather/smhi.js';
export { buildMetNorwayUrl, metNorwayHeaders, parseMetNorway } from './weather/metNorway.js';
export { gatherWindSamples, fetchSmhi, fetchMetNorway, mapLimit } from './weather/fetchAll.js';
export {
  buildEnsemble,
  makeWeatherFn,
  type EnsembleCell,
  type EnsembleField,
} from './weather/ensemble.js';
export { sampleCellPoints } from './weather/sample.js';
export {
  summarizeHourly,
  applyHourlyOverrides,
  buildManualField,
  type HourlyWind,
} from './weather/hourly.js';
export {
  heightFactor,
  adjustWindForHeight,
  terrainToZ0,
  exposureClassToZ0,
} from './weather/effective.js';
export {
  applyExposure,
  exposureCoveragePct,
  type ExposureRun,
  type ExposureRuns,
} from './weather/exposure.js';
