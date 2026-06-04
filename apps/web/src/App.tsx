/**
 * StickToThePlan web app shell.
 *
 * Orchestrates the upload form, the compute worker (via useSolver), and the
 * results: the scenario summary, the split table (the hero), the download
 * buttons, and the full tempokort. All computation runs in the browser; the
 * privacy note spells out the single exception (open-meteo wind lookup).
 */
import { useState } from 'react';
import { useSolver } from './useSolver';
import { UploadForm } from './components/UploadForm';
import { ScenarioSummary } from './components/ScenarioSummary';
import { SplitTable } from './components/SplitTable';
import { Downloads } from './components/Downloads';
import { TempokortTable } from './components/TempokortTable';
import type { PipelineInput } from './worker/solve.worker';

export function App() {
  const solver = useSolver();
  // Remember the inputs the last run used so the results render with the right
  // start time and weather mode even if the form is edited afterwards.
  const [ranInput, setRanInput] = useState<PipelineInput | null>(null);

  const handleRun = (input: PipelineInput) => {
    setRanInput(input);
    solver.run(input);
  };

  const { status, result, error } = solver;
  const startTime = ranInput?.form.start_time ?? '00:00';
  const weatherMode = ranInput?.weatherMode ?? 'calm';

  return (
    <main className="app">
      <header className="app-header">
        <h1>StickToThePlan</h1>
        <p className="tagline">Vatternrundan race-plan calculator</p>
      </header>

      <p className="privacy">
        Uploaded GPX and FIT files are processed entirely in your browser and never uploaded to
        a server. In open-meteo mode, only the route coordinates and the date are sent to the
        Open-Meteo API to fetch wind.
      </p>

      <UploadForm onRun={handleRun} status={status} />

      {status === 'error' && (
        <section className="card error-card">
          <h2>Something went wrong</h2>
          <p>{error}</p>
        </section>
      )}

      {status === 'done' && result && (
        <>
          {result.scenarios.optimistic !== result.scenarios.expected ||
            result.scenarios.pessimistic !== result.scenarios.expected ? (
            <ScenarioSummary scenarios={result.scenarios} />
          ) : null}
          <SplitTable splits={result.splits} startTime={startTime} />
          <Downloads result={result} weatherMode={weatherMode} />
          <TempokortTable
            segments={result.displaySegments}
            compactSegments={result.styrkortSegments}
            startTime={startTime}
          />
        </>
      )}
    </main>
  );
}
