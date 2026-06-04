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

const DEFAULT_STOPS: StopRow[] = [
  { control: 'Hästholmen', km: 40, minutes: 5 },
  { control: 'Jönköping', km: 105, minutes: 10 },
];

export function UploadForm({ onRun, status }: Props) {
  // Files.
  const [gpxText, setGpxText] = useState<string>('');
  const [gpxName, setGpxName] = useState<string>('');
  const [fitBytes, setFitBytes] = useState<Uint8Array | null>(null);
  const [fitName, setFitName] = useState<string>('');

  // Parameters.
  const [targetTotalHm, setTargetTotalHm] = useState('11:45');
  const [ftp, setFtp] = useState(272);
  const [nRiders, setNRiders] = useState(12);
  const [m, setM] = useState(96);
  const [watchTarget, setWatchTarget] = useState<WatchTarget>('pull');
  const [weatherMode, setWeatherMode] = useState<WeatherMode>('calm');
  const [raceDate, setRaceDate] = useState('2026-06-13');
  const [startTime, setStartTime] = useState('04:22');

  // Stops.
  const [stops, setStops] = useState<StopRow[]>(DEFAULT_STOPS);

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
    // Defaults that suit the ~76 km synthetic loop.
    setTargetTotalHm('2:30');
    setFtp(250);
    setNRiders(6);
    setM(90);
    setStartTime('06:00');
    setWeatherMode('calm');
    setStops([
      { control: 'Depå 1', km: 18, minutes: 5 },
      { control: 'Krönet', km: 38, minutes: 0 },
      { control: 'Depå 2', km: 58, minutes: 5 },
    ]);
  };

  const updateStop = (index: number, patch: Partial<StopRow>) => {
    setStops((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const addStop = () => {
    setStops((prev) => [...prev, { control: '', km: 0, minutes: 0 }]);
  };

  const removeStop = (index: number) => {
    setStops((prev) => prev.filter((_, i) => i !== index));
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
            onChange={(e) => setTargetTotalHm(e.target.value)}
            placeholder="2:30"
          />
        </label>

        <label className="field">
          <span>FTP (W)</span>
          <input
            type="number"
            value={ftp}
            min={1}
            onChange={(e) => setFtp(Number(e.target.value))}
          />
        </label>

        <label className="field">
          <span>Riders in group</span>
          <input
            type="number"
            value={nRiders}
            min={1}
            onChange={(e) => setNRiders(Number(e.target.value))}
          />
        </label>

        <label className="field">
          <span>Rider + bike mass (kg)</span>
          <input
            type="number"
            value={m}
            min={1}
            onChange={(e) => setM(Number(e.target.value))}
          />
        </label>

        <label className="field">
          <span>Watch target</span>
          <select
            value={watchTarget}
            onChange={(e) => setWatchTarget(e.target.value as WatchTarget)}
          >
            <option value="pull">pull</option>
            <option value="avg">avg</option>
          </select>
        </label>

        <label className="field">
          <span>Weather mode</span>
          <select
            value={weatherMode}
            onChange={(e) => setWeatherMode(e.target.value as WeatherMode)}
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
              onChange={(e) => setRaceDate(e.target.value)}
            />
          </label>
        )}

        <label className="field">
          <span>Start time (HH:MM)</span>
          <input
            type="text"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
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
