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
  buildStyrkortHtml,
  encodeWorkout,
  generatePlanDeltaSource,
  type PlanJsonMeta,
} from '@stp/core';
import type { PipelineResult } from '../worker/solve.worker';
import { downloadBlob } from '../lib/download';

interface Props {
  result: PipelineResult;
  /** Weather sources that produced the solved field (e.g. SMHI, MET Norway, Open-Meteo), or ['calm']/['manual']. */
  sources: string[];
  /** True when fewer than 3 sources answered (ensemble reduced). */
  reduced: boolean;
}

export function Downloads({ result, sources, reduced }: Props) {
  const { cfg, micro, scenarios, displaySegments, styrkortSegments, anchor, controls } = result;

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
      reducedEnsemble: reduced,
      weatherSources: sources,
      notes: scenarios.expected.notes,
    };
    const plan = buildPlanJson(scenarios, displaySegments, anchor, cfg, meta);
    downloadBlob('plan.json', JSON.stringify(plan, null, 2), 'application/json');
  };

  const onPlanDelta = () => {
    const source = generatePlanDeltaSource(displaySegments, scenarios.expected, cfg);
    downloadBlob('PlanDelta.mc', source, 'text/plain');
  };

  const onStyrkort = () => {
    const html = buildStyrkortHtml(styrkortSegments, cfg);
    downloadBlob('styrkortet.html', html, 'text/html');
  };

  return (
    <section className="card">
      <h2>Nedladdningar</h2>

      <div className="download-group">
        <h3>Cykeldator</h3>
        <div className="download-row">
          <button type="button" className="download-btn" onClick={onCourse}>
            <span className="download-title">GPX för cykeldator</span>
            <span className="download-desc">Rutt med ankomsttider (course.gpx)</span>
          </button>
          <button type="button" className="download-btn" onClick={onWorkout}>
            <span className="download-title">FIT-träningspass</span>
            <span className="download-desc">Effektmål per sträcka (workout.fit)</span>
          </button>
        </div>
      </div>

      <div className="download-group">
        <h3>Garmin-klocka</h3>
        <div className="download-row">
          <button type="button" className="download-btn" onClick={onPlanDelta}>
            <span className="download-title">Connect IQ-källa</span>
            <span className="download-desc">Datafält att kompilera (PlanDelta.mc)</span>
          </button>
        </div>
      </div>

      <div className="download-group">
        <h3>Utskrift &amp; data</h3>
        <div className="download-row">
          <button type="button" className="download-btn" onClick={onStyrkort}>
            <span className="download-title">Utskrivbart styrkort</span>
            <span className="download-desc">Att skriva ut och tejpa på styret (styrkortet.html)</span>
          </button>
          <button type="button" className="download-btn" onClick={onPlanJson}>
            <span className="download-title">Plan som JSON</span>
            <span className="download-desc">Maskinläsbar fullständig plan (plan.json)</span>
          </button>
        </div>
      </div>

      <p className="note">
        .prg-filen för klockan måste kompileras lokalt med Garmin Connect IQ SDK (monkeyc); se CLI:t.
      </p>
    </section>
  );
}
