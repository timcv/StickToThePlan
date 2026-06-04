/**
 * StickToThePlan web app shell.
 *
 * Orchestrates the form, the weather panel (server fetch + hour-by-hour
 * edit + manual entry), the compute worker, and the results. All heavy compute
 * runs in the worker; weather is fetched on the main thread so the user can see
 * and edit it before solving. The only network egress is the rounded route
 * coordinates + date sent to /api/weather in fetched mode.
 */
import { useState } from 'react';
import {
  applyDefaults, ingestGpxString, sampleCellPoints,
  summarizeHourly, applyHourlyOverrides, buildManualField,
  type EnsembleField, type HourlyWind,
} from '@stp/core';
import { useSolver } from './useSolver';
import { UploadForm, type FormSubmit } from './components/UploadForm';
import { WeatherPanel, type WeatherMode } from './components/WeatherPanel';
import { ScenarioSummary } from './components/ScenarioSummary';
import { SplitTable } from './components/SplitTable';
import { Downloads } from './components/Downloads';
import { TempokortTable } from './components/TempokortTable';
import { raceHours, centroidOf } from './lib/hours';
import { fetchEnsemble } from './lib/weatherClient';
import type { PipelineInput } from './worker/solve.worker';

export function App() {
  const solver = useSolver();
  const [ranInput, setRanInput] = useState<PipelineInput | null>(null);
  const [lastForm, setLastForm] = useState<FormSubmit | null>(null);

  // Weather state.
  const [mode, setMode] = useState<WeatherMode>('calm');
  const [field, setField] = useState<EnsembleField | null>(null);
  const [baseRows, setBaseRows] = useState<HourlyWind[]>([]);
  const [overrides, setOverrides] = useState<Map<number, HourlyWind>>(new Map());
  const [centroid, setCentroid] = useState({ lat: 0, lon: 0 });
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [sources, setSources] = useState<string[]>([]);
  const [reduced, setReduced] = useState(false);

  const hoursFor = (f: FormSubmit | null) =>
    f ? raceHours(f.form.start_time, f.form.target_total_hm) : raceHours('06:00', '0:00');

  // Rows shown = base summary with overrides applied on top.
  const displayedRows: HourlyWind[] = baseRows.map((r) => overrides.get(r.hour) ?? r);
  const editedHours = new Set(overrides.keys());

  const doFetch = async (form: FormSubmit) => {
    if (!form.gpxText.trim()) return;
    setFetchStatus('loading');
    try {
      const cfg = applyDefaults({
        gpx_path: 'web.gpx', race_date: form.form.race_date, start_time: form.form.start_time,
        ftp: form.form.ftp, n_riders: form.form.n_riders, target_total_hm: form.form.target_total_hm,
        stops: form.form.stops, m: form.form.m, watch_target: form.form.watch_target,
      });
      const micro = ingestGpxString(form.gpxText, cfg);
      const points = sampleCellPoints(micro);
      setCentroid(centroidOf(points));
      const f = await fetchEnsemble(form.form.race_date, points);
      setField(f);
      setSources(f.sources);
      setReduced(f.reduced || f.sources.length < 3);
      setBaseRows(summarizeHourly(f, hoursFor(form)));
      setOverrides(new Map());
      setFetchStatus('done');
    } catch {
      setFetchStatus('error');
    }
  };

  const editHour = (hour: number, patch: Partial<Omit<HourlyWind, 'hour'>>) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const current = next.get(hour) ?? baseRows.find((r) => r.hour === hour) ?? { hour, dir_from_deg: 0, speed_ms: 0 };
      next.set(hour, { ...current, ...patch, hour });
      return next;
    });
  };

  const resetHour = (hour: number) => {
    setOverrides((prev) => { const next = new Map(prev); next.delete(hour); return next; });
  };

  const applyConstant = (dir: number, speed: number) => {
    const hrs = hoursFor(lastForm);
    const rows = hrs.map((hour) => ({ hour, dir_from_deg: dir, speed_ms: speed }));
    setBaseRows(rows);
    setOverrides(new Map());
  };

  const onModeChange = (m: WeatherMode) => {
    setMode(m);
    if (m === 'manual' && baseRows.length === 0) {
      const hrs = hoursFor(lastForm);
      setBaseRows(hrs.map((hour) => ({ hour, dir_from_deg: 270, speed_ms: 5 })));
    }
  };

  const buildFinalField = (): EnsembleField | null => {
    if (mode === 'calm') return null;
    if (mode === 'manual') {
      return buildManualField(displayedRows, lastForm?.form.race_date ?? '2026-06-13', centroid);
    }
    // fetched
    if (!field) return null;
    return applyHourlyOverrides(field, [...overrides.values()]);
  };

  const handleRun = (form: FormSubmit) => {
    const input: PipelineInput = {
      gpxText: form.gpxText, fitBytes: form.fitBytes, form: form.form,
      weatherMode: mode, field: buildFinalField(),
    };
    setRanInput(input);
    solver.run(input);
  };

  const { status, result, error } = solver;
  const startTime = ranInput?.form.start_time ?? '00:00';
  // Weather metadata for the exported plan.json reflects the field actually
  // solved: the fetched/manual ensemble's own sources + reduced flag, or calm.
  const ranField = ranInput?.field ?? null;
  const ranSources = ranField ? ranField.sources : ['calm'];
  const ranReduced = ranField ? ranField.reduced : false;

  return (
    <main className="app">
      <header className="app-header">
        <h1>StickToThePlan</h1>
        <p className="tagline">Vatternrundan race-plan calculator</p>
      </header>

      <p className="privacy">
        Uploaded GPX and FIT files are processed entirely in your browser and never uploaded.
        In <strong>Hämta</strong> (server) mode, only the route's rounded sample coordinates and the
        date are sent to our weather function, which queries SMHI, MET Norway and Open-Meteo.
        Calm and manual modes send nothing.
      </p>

      <UploadForm onRun={(f) => { setLastForm(f); }} status={status} />

      <WeatherPanel
        mode={mode}
        onModeChange={onModeChange}
        rows={mode === 'calm' ? [] : displayedRows}
        edited={editedHours}
        fetchStatus={fetchStatus}
        sources={sources}
        reduced={reduced}
        onFetch={() => lastForm && doFetch(lastForm)}
        onEdit={editHour}
        onResetHour={resetHour}
        onApplyConstant={applyConstant}
      />

      <div className="run-row">
        <button
          type="button"
          className="run-button"
          disabled={status === 'running' || !lastForm?.gpxText.trim()}
          onClick={() => lastForm && handleRun(lastForm)}
        >
          {status === 'running' ? 'Beräknar…' : 'Beräkna plan'}
        </button>
      </div>

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
          <Downloads result={result} sources={ranSources} reduced={ranReduced} />
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
