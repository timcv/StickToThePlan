/**
 * Download buttons for the four plan outputs.
 *
 * The builders are pure and fast, so we run them on the main thread on click
 * using the data the worker returned (cfg, micro, scenarios, displaySegments,
 * anchor) and save each result through downloadBlob.
 *
 *   workout.fit   distance-based structured FIT workout (encodeWorkout).
 *   course.gpx    route track + ETA waypoints (buildCourseGpx).
 *   plan.json     full machine-readable plan (buildPlanJson).
 *   PlanDelta.mc  Connect IQ data-field source (generatePlanDeltaSource). The
 *                 .prg watch file is compiled locally with the Garmin Connect IQ
 *                 SDK (monkeyc); this button only emits the source.
 */
import {
  buildCourseGpx,
  buildPlanJson,
  encodeWorkout,
  generatePlanDeltaSource,
  type PlanJsonMeta,
} from '@stp/core';
import type { PipelineResult } from '../worker/solve.worker';
import { downloadBlob } from '../lib/download';

interface Props {
  result: PipelineResult;
  weatherMode: 'calm' | 'open-meteo';
}

export function Downloads({ result, weatherMode }: Props) {
  const { cfg, micro, scenarios, displaySegments, anchor, controls } = result;

  const onWorkout = () => {
    const bytes = encodeWorkout(displaySegments, cfg);
    downloadBlob('workout.fit', bytes, 'application/octet-stream');
  };

  const onCourse = () => {
    const gpx = buildCourseGpx(micro, scenarios.expected, cfg, controls);
    downloadBlob('course.gpx', gpx, 'application/gpx+xml');
  };

  const onPlanJson = () => {
    const meta: PlanJsonMeta = {
      reducedEnsemble: false,
      weatherSources: weatherMode === 'open-meteo' ? ['open-meteo'] : ['calm'],
      notes: scenarios.expected.notes,
    };
    const plan = buildPlanJson(scenarios, displaySegments, anchor, cfg, meta);
    downloadBlob('plan.json', JSON.stringify(plan, null, 2), 'application/json');
  };

  const onPlanDelta = () => {
    const source = generatePlanDeltaSource(displaySegments, scenarios.expected, cfg);
    downloadBlob('PlanDelta.mc', source, 'text/plain');
  };

  return (
    <section className="card">
      <h2>Downloads</h2>
      <div className="download-row">
        <button type="button" onClick={onWorkout}>
          workout.fit
        </button>
        <button type="button" onClick={onCourse}>
          course.gpx
        </button>
        <button type="button" onClick={onPlanJson}>
          plan.json
        </button>
        <button type="button" onClick={onPlanDelta}>
          PlanDelta.mc
        </button>
      </div>
      <p className="note">
        The .prg watch file must be compiled locally with the Garmin Connect IQ SDK (monkeyc);
        see the CLI.
      </p>
    </section>
  );
}
