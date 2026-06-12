/**
 * StickToThePlan web app shell.
 *
 * Orchestrates the form, the weather panel (server fetch + hour-by-hour
 * edit + manual entry), the compute worker, and the results. All heavy compute
 * runs in the worker; weather is fetched on the main thread so the user can see
 * and edit it before solving. The only network egress is the rounded route
 * coordinates + date sent to /api/weather in fetched mode.
 */
import { useEffect, useState } from 'react';
import {
  applyDefaults,
  ingestGpxString,
  sampleCellPoints,
  summarizeHourly,
  applyHourlyOverrides,
  buildManualField,
  localUtcOffsetHours,
  type EnsembleField,
  type HourlyWind,
} from '@stp/core';
import { useSolver } from './useSolver';
import { UploadForm, type FormSubmit } from './components/UploadForm';
import { WeatherPanel, type WeatherMode, type ManualWindRef } from './components/WeatherPanel';
import { ScenarioSummary } from './components/ScenarioSummary';
import { SummaryCard } from './components/SummaryCard';
import { SplitTable } from './components/SplitTable';
import { Downloads } from './components/Downloads';
import { TempokortTable } from './components/TempokortTable';
import { HowItWorks } from './components/HowItWorks';
import { raceHours, centroidOf } from './lib/hours';
import { fetchEnsemble } from './lib/weatherClient';
import type { PipelineInput } from './worker/solve.worker';

const HOWTO_HASH = '#sa-funkar-det';

export function App() {
  const solver = useSolver();
  const [ranInput, setRanInput] = useState<PipelineInput | null>(null);
  const [lastForm, setLastForm] = useState<FormSubmit | null>(null);

  // Which view is showing. Seeded from the URL hash so a shared
  // …/#sa-funkar-det link lands directly on the infographic.
  const [view, setView] = useState<'calculator' | 'how'>(() =>
    typeof window !== 'undefined' && window.location.hash === HOWTO_HASH ? 'how' : 'calculator',
  );

  // Keep the view in sync with browser back/forward and manual hash edits.
  useEffect(() => {
    const onHash = () => setView(window.location.hash === HOWTO_HASH ? 'how' : 'calculator');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const goHowItWorks = () => {
    window.location.hash = HOWTO_HASH.slice(1);
    setView('how');
    window.scrollTo(0, 0);
  };

  const goCalculator = () => {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    setView('calculator');
    window.scrollTo(0, 0);
  };

  // Weather state.
  const [mode, setMode] = useState<WeatherMode>('calm');
  // Manual mode only: whether the entered wind is a 10 m forecast or felt wind.
  // Default 'felt' so a hand-entered number is taken at face value (no height
  // scaling) unless the user says it came from a forecast.
  const [windRef, setWindRef] = useState<ManualWindRef>('felt');
  // Mirrors the form's "Visa spann" checkbox so the SummaryCard can suppress the
  // range. Seeded from the form's submit (defaults true).
  const [showInterval, setShowInterval] = useState(true);
  const [field, setField] = useState<EnsembleField | null>(null);
  const [baseRows, setBaseRows] = useState<HourlyWind[]>([]);
  const [overrides, setOverrides] = useState<Map<number, HourlyWind>>(new Map());
  const [centroid, setCentroid] = useState({ lat: 0, lon: 0 });
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [fetchError, setFetchError] = useState<string | undefined>(undefined);
  const [sources, setSources] = useState<string[]>([]);
  const [reduced, setReduced] = useState(false);

  const hoursFor = (f: FormSubmit | null) =>
    f ? raceHours(f.form.start_time, f.form.target_total_hm) : raceHours('06:00', '0:00');

  // The hour table and all UI state run in LOCAL race hours; weather cells are
  // binned on UTC hours. Convert at the two boundaries (summarize + solve).
  const offsetFor = (f: FormSubmit | null): number =>
    localUtcOffsetHours(
      f?.form.race_date ?? '2026-06-13',
      f?.form.start_time ?? '06:00',
      'Europe/Stockholm',
    );
  const toUtcHour = (h: number, off: number) => (((h - off) % 24) + 24) % 24;
  const toLocalHour = (h: number, off: number) => (h + off) % 24;

  // Rows shown = base summary with overrides applied on top.
  const displayedRows: HourlyWind[] = baseRows.map((r) => overrides.get(r.hour) ?? r);
  const editedHours = new Set(overrides.keys());

  const doFetch = async (form: FormSubmit) => {
    if (!form.gpxText.trim()) return;
    setFetchStatus('loading');
    setFetchError(undefined);
    try {
      const cfg = applyDefaults({
        gpx_path: 'web.gpx',
        race_date: form.form.race_date,
        start_time: form.form.start_time,
        ftp: form.form.ftp,
        n_riders: form.form.n_riders,
        target_total_hm: form.form.target_total_hm,
        stops: form.form.stops,
        m: form.form.m,
        watch_target: form.form.watch_target,
      });
      const micro = ingestGpxString(form.gpxText, cfg);
      const points = sampleCellPoints(micro);
      setCentroid(centroidOf(points));
      const f = await fetchEnsemble(form.form.race_date, points);
      setField(f);
      setSources(f.sources);
      setReduced(f.reduced || f.sources.length < 3);
      const off = offsetFor(form);
      const utcRows = summarizeHourly(
        f,
        hoursFor(form).map((h) => toUtcHour(h, off)),
      );
      setBaseRows(utcRows.map((r) => ({ ...r, hour: toLocalHour(r.hour, off) })));
      setOverrides(new Map());
      setFetchStatus('done');
    } catch (err) {
      setFetchStatus('error');
      setFetchError(err instanceof Error ? err.message : undefined);
    }
  };

  const editHour = (hour: number, patch: Partial<Omit<HourlyWind, 'hour'>>) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const current = next.get(hour) ??
        baseRows.find((r) => r.hour === hour) ?? { hour, dir_from_deg: 0, speed_ms: 0 };
      next.set(hour, { ...current, ...patch, hour });
      return next;
    });
  };

  const resetHour = (hour: number) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.delete(hour);
      return next;
    });
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
    const off = offsetFor(lastForm);
    if (mode === 'manual') {
      // Cells are stamped as UTC hours; rows are edited in local hours.
      const utcRows = displayedRows.map((r) => ({ ...r, hour: toUtcHour(r.hour, off) }));
      return buildManualField(utcRows, lastForm?.form.race_date ?? '2026-06-13', centroid);
    }
    // fetched
    if (!field) return null;
    const utcOverrides = [...overrides.values()].map((r) => ({
      ...r,
      hour: toUtcHour(r.hour, off),
    }));
    return applyHourlyOverrides(field, utcOverrides);
  };

  const handleRun = (form: FormSubmit) => {
    // Height correction: a fetched ensemble is a 10 m forecast, so always scale
    // it down to rider level. In manual mode the user tells us via windRef
    // whether their number is a 10 m forecast (scale) or felt wind (take as-is).
    // Calm mode has no wind, so the flag is inert.
    const applyHeight = mode === 'manual' ? windRef === 'forecast10m' : true;
    const input: PipelineInput = {
      gpxText: form.gpxText,
      fitBytes: form.fitBytes,
      form: { ...form.form, apply_wind_height_correction: applyHeight },
      weatherMode: mode,
      field: buildFinalField(),
    };
    setShowInterval(form.showInterval);
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
      <a
        className="github-ribbon"
        href="https://github.com/timcv/StickToThePlan"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Forka projektet på GitHub"
      >
        <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
            0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01
            1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
            0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18
            1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16
            1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54
            1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
        <span>Forka på GitHub</span>
      </a>

      {view === 'how' ? (
        <HowItWorks onBack={goCalculator} />
      ) : (
        <>
          <header className="app-header">
            <h1>StickToThePlan</h1>
            <p className="tagline">Körschema för Vätternrundan</p>
            <button type="button" className="howto-nav" onClick={goHowItWorks}>
              Så funkar det →
            </button>
          </header>

          <p className="intro">
            Ställ in ditt mål och få ett detaljerat körschema för Vätternrundan. Rutten är redan
            inläst, så du kan börja direkt: justera måltid och starttid, kör planen och ladda ner
            ditt styrkort.
          </p>

          <p className="privacy">
            Uppladdade GPX- och FIT-filer behandlas helt i din webbläsare och laddas aldrig upp. I
            läget <strong>Hämta</strong> skickas endast ruttens avrundade punkter och datumet till
            vår väderfunktion, som frågar SMHI, MET Norway och Open-Meteo. Lugnt och manuellt läge
            skickar ingenting.
          </p>

          <UploadForm
            onRun={(f) => {
              setLastForm(f);
            }}
            status={status}
          />

          <WeatherPanel
            mode={mode}
            onModeChange={onModeChange}
            rows={mode === 'calm' ? [] : displayedRows}
            edited={editedHours}
            fetchStatus={fetchStatus}
            fetchError={fetchError}
            sources={sources}
            reduced={reduced}
            windRef={windRef}
            onFetch={() => lastForm && doFetch(lastForm)}
            onEdit={editHour}
            onResetHour={resetHour}
            onApplyConstant={applyConstant}
            onWindRefChange={setWindRef}
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
              <h2>Något gick fel</h2>
              <p>{error}</p>
            </section>
          )}

          {status === 'done' && result && (
            <>
              <p className="done-banner">Planen är klar! Se sammanfattningen nedan.</p>
              <SummaryCard
                scenarios={result.scenarios}
                splits={result.splits}
                cfg={result.cfg}
                showInterval={showInterval}
              />
              <SplitTable splits={result.splits} startTime={startTime} />
              <TempokortTable
                segments={result.displaySegments}
                compactSegments={result.styrkortSegments}
                startTime={startTime}
                segmentPlans={result.scenarios.expected.segments}
              />
              {result.scenarios.optimistic !== result.scenarios.expected ||
              result.scenarios.pessimistic !== result.scenarios.expected ? (
                <ScenarioSummary scenarios={result.scenarios} />
              ) : null}
              <Downloads result={result} sources={ranSources} reduced={ranReduced} />
            </>
          )}
        </>
      )}
    </main>
  );
}
