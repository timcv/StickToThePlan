/**
 * Upload + parameter form. Collects a GPX (required) and optional FIT, the
 * target, rider and chaingang parameters, the weather mode, and an editable
 * stops list, then assembles a PipelineInput and hands it to the solver.
 *
 * Files are read in the browser: GPX as text, FIT as bytes (Uint8Array). Nothing
 * is uploaded to a server (see the privacy note in App).
 */
import { useRef, useState } from 'react';
import type { PipelineInput } from '../worker/solve.worker';
import type { SolverStatus } from '../useSolver';
import { sampleRouteGpx } from '../lib/sampleRoute';
import { VATTERN_CONTROLS } from '@stp/core';

interface StopRow {
  control: string;
  km: number;
  minutes: number;
}

interface Props {
  onRun: (input: PipelineInput) => void;
  status: SolverStatus;
}

type WatchTarget = 'pull' | 'avg';
type WeatherMode = 'calm' | 'open-meteo';

const DEPOT_MINUTES: Record<string, number> = {
  Hästholmen: 5,
  Jönköping: 10,
};

const DEFAULT_STOPS: StopRow[] = VATTERN_CONTROLS.filter(
  (c) => c.km > 0 && c.km < 315,
).map((c) => ({
  control: c.name,
  km: c.km,
  minutes: DEPOT_MINUTES[c.name] ?? 0,
}));

const LS_KEY = 'stp_form_v1';

interface PersistedForm {
  targetTotalHm: string;
  ftp: number;
  nRiders: number;
  m: number;
  watchTarget: WatchTarget;
  weatherMode: WeatherMode;
  raceDate: string;
  startTime: string;
  stops: StopRow[];
}

function loadFromStorage(): Partial<PersistedForm> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedForm>;
  } catch {
    return {};
  }
}

function saveToStorage(data: PersistedForm) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

function sortedByKm(stops: StopRow[]): StopRow[] {
  return [...stops].sort((a, b) => a.km - b.km);
}

export function UploadForm({ onRun, status }: Props) {
  const saved = loadFromStorage();

  // Files (not persisted — user must re-select after reload).
  const [gpxText, setGpxText] = useState<string>('');
  const [gpxName, setGpxName] = useState<string>('');
  const [fitBytes, setFitBytes] = useState<Uint8Array | null>(null);
  const [fitName, setFitName] = useState<string>('');

  // Parameters.
  const [targetTotalHm, setTargetTotalHm] = useState(saved.targetTotalHm ?? '11:45');
  const [ftp, setFtp] = useState(saved.ftp ?? 272);
  const [nRiders, setNRiders] = useState(saved.nRiders ?? 12);
  const [m, setM] = useState(saved.m ?? 96);
  const [watchTarget, setWatchTarget] = useState<WatchTarget>(saved.watchTarget ?? 'pull');
  const [weatherMode, setWeatherMode] = useState<WeatherMode>(saved.weatherMode ?? 'calm');
  const [raceDate, setRaceDate] = useState(saved.raceDate ?? '2026-06-13');
  const [startTime, setStartTime] = useState(saved.startTime ?? '04:22');

  // Stops.
  const [stops, setStops] = useState<StopRow[]>(saved.stops ?? DEFAULT_STOPS);

  const persist = (patch: Partial<PersistedForm>) => {
    saveToStorage({
      targetTotalHm,
      ftp,
      nRiders,
      m,
      watchTarget,
      weatherMode,
      raceDate,
      startTime,
      stops,
      ...patch,
    });
  };

  // Reset the GPX <input> after "Load sample route" so the same file can be
  // re-selected later if the user wants to override the sample.
  const gpxInputRef = useRef<HTMLInputElement>(null);

  const running = status === 'running';
  const canRun = !running && gpxText.trim().length > 0;

  const onGpxChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setGpxText(text);
    setGpxName(file.name);
  };

  const onFitChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFitBytes(null);
      setFitName('');
      return;
    }
    const buffer = await file.arrayBuffer();
    setFitBytes(new Uint8Array(buffer));
    setFitName(file.name);
  };

  const onLoadSample = () => {
    setGpxText(sampleRouteGpx);
    setGpxName('sample-route.gpx');
    if (gpxInputRef.current) gpxInputRef.current.value = '';
    const sampleStops = [
      { control: 'Depå 1', km: 18, minutes: 5 },
      { control: 'Krönet', km: 38, minutes: 0 },
      { control: 'Depå 2', km: 58, minutes: 5 },
    ];
    setTargetTotalHm('2:30');
    setFtp(250);
    setNRiders(6);
    setM(90);
    setStartTime('06:00');
    setWeatherMode('calm');
    setStops(sampleStops);
    persist({ targetTotalHm: '2:30', ftp: 250, nRiders: 6, m: 90, startTime: '06:00', weatherMode: 'calm', stops: sampleStops });
  };

  const updateStop = (index: number, patch: Partial<StopRow>) => {
    setStops((prev) => {
      const updated = sortedByKm(prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
      persist({ stops: updated });
      return updated;
    });
  };

  const addStop = () => {
    setStops((prev) => {
      const updated = sortedByKm([...prev, { control: '', km: 0, minutes: 0 }]);
      persist({ stops: updated });
      return updated;
    });
  };

  const removeStop = (index: number) => {
    setStops((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      persist({ stops: updated });
      return updated;
    });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canRun) return;
    const input: PipelineInput = {
      gpxText,
      fitBytes,
      weatherMode,
      form: {
        target_total_hm: targetTotalHm,
        ftp,
        n_riders: nRiders,
        m,
        stops,
        watch_target: watchTarget,
        race_date: raceDate,
        start_time: startTime,
      },
    };
    onRun(input);
  };

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Route and parameters</h2>

      <div className="field-grid">
        <label className="field">
          <span>GPX route (required)</span>
          <input
            ref={gpxInputRef}
            type="file"
            accept=".gpx,application/gpx+xml,text/xml"
            onChange={onGpxChange}
          />
          {gpxName && <small className="hint">Loaded: {gpxName}</small>}
        </label>

        <label className="field">
          <span>FIT power file (optional)</span>
          <input type="file" accept=".fit,application/octet-stream" onChange={onFitChange} />
          {fitName && <small className="hint">Loaded: {fitName}</small>}
        </label>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Target total time (h:mm)</span>
          <input
            type="text"
            value={targetTotalHm}
            onChange={(e) => { setTargetTotalHm(e.target.value); persist({ targetTotalHm: e.target.value }); }}
            placeholder="2:30"
          />
        </label>

        <label className="field">
          <span>FTP (W)</span>
          <input
            type="number"
            value={ftp}
            min={1}
            onChange={(e) => { const v = Number(e.target.value); setFtp(v); persist({ ftp: v }); }}
          />
        </label>

        <label className="field">
          <span>Riders in group</span>
          <input
            type="number"
            value={nRiders}
            min={1}
            onChange={(e) => { const v = Number(e.target.value); setNRiders(v); persist({ nRiders: v }); }}
          />
        </label>

        <label className="field">
          <span>Rider + bike mass (kg)</span>
          <input
            type="number"
            value={m}
            min={1}
            onChange={(e) => { const v = Number(e.target.value); setM(v); persist({ m: v }); }}
          />
        </label>

        <label className="field">
          <span>Watch target</span>
          <select
            value={watchTarget}
            onChange={(e) => { const v = e.target.value as WatchTarget; setWatchTarget(v); persist({ watchTarget: v }); }}
          >
            <option value="pull">pull</option>
            <option value="avg">avg</option>
          </select>
        </label>

        <label className="field">
          <span>Weather mode</span>
          <select
            value={weatherMode}
            onChange={(e) => { const v = e.target.value as WeatherMode; setWeatherMode(v); persist({ weatherMode: v }); }}
          >
            <option value="calm">calm</option>
            <option value="open-meteo">open-meteo</option>
          </select>
        </label>

        {weatherMode === 'open-meteo' && (
          <label className="field">
            <span>Race date</span>
            <input
              type="date"
              value={raceDate}
              required
              onChange={(e) => { setRaceDate(e.target.value); persist({ raceDate: e.target.value }); }}
            />
          </label>
        )}

        <label className="field">
          <span>Start time (HH:MM)</span>
          <input
            type="text"
            value={startTime}
            onChange={(e) => { setStartTime(e.target.value); persist({ startTime: e.target.value }); }}
            placeholder="06:00"
          />
        </label>
      </div>

      <fieldset className="stops">
        <legend>Stops</legend>
        <table className="data-table stops-table">
          <thead>
            <tr>
              <th>Control</th>
              <th className="num">km</th>
              <th className="num">Minutes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {stops.map((stop, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="text"
                    value={stop.control}
                    onChange={(e) => updateStop(i, { control: e.target.value })}
                  />
                </td>
                <td className="num">
                  <input
                    type="number"
                    value={stop.km}
                    min={0}
                    onChange={(e) => updateStop(i, { km: Number(e.target.value) })}
                  />
                </td>
                <td className="num">
                  <input
                    type="number"
                    value={stop.minutes}
                    min={0}
                    onChange={(e) => updateStop(i, { minutes: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <button type="button" className="ghost" onClick={() => removeStop(i)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="ghost" onClick={addStop}>
          Add stop
        </button>
      </fieldset>

      <div className="actions">
        <button type="button" className="ghost" onClick={onLoadSample}>
          Load sample route
        </button>
        <button type="submit" className="primary" disabled={!canRun}>
          {running ? 'Solving...' : 'Run'}
        </button>
        {running && <span className="spinner" aria-label="Solving" />}
      </div>
    </form>
  );
}
