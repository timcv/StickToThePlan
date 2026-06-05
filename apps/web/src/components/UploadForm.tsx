/**
 * Upload + parameter form. Collects a GPX (required) and optional FIT, the
 * target, rider and chaingang parameters, and an editable stops list, then
 * assembles a FormSubmit and hands it to App. App owns the weather mode and
 * builds the final field before solving.
 *
 * Files are read in the browser: GPX as text, FIT as bytes (Uint8Array). Nothing
 * is uploaded to a server (see the privacy note in App).
 */
import { useEffect, useState } from 'react';
import type { PipelineForm } from '../worker/solve.worker';
import type { SolverStatus } from '../useSolver';
import { defaultRouteGpx, DEFAULT_ROUTE_NAME } from '../lib/defaultRoute';
import { VATTERN_CONTROLS } from '@stp/core';
import { InfoTip } from './InfoTip';
import { FIELD_HELP } from '../lib/strings';

type ExposureTerrain = 'open' | 'mixed' | 'sheltered';

/** Label text + ⓘ tooltip for a field, using the shared help copy. */
function FieldLabel({ text, helpKey }: { text: string; helpKey: keyof typeof FIELD_HELP }) {
  return (
    <span>
      {text} <InfoTip text={FIELD_HELP[helpKey].tip} label={text} />
    </span>
  );
}

interface StopRow {
  control: string;
  km: number;
  minutes: number;
}

export interface FormSubmit {
  gpxText: string;
  fitBytes: Uint8Array | null;
  form: PipelineForm;
  /** Whether the user wants the finish time shown as a range (UI-only). */
  showInterval: boolean;
}

interface Props {
  onRun: (input: FormSubmit) => void;
  status: SolverStatus;
}

type WatchTarget = 'pull' | 'avg';

const DEPOT_MINUTES: Record<string, number> = {
  Gränna: 10,
  Fagerhult: 10,
  Boviken: 15,
  Askersund: 15,
};

const DEFAULT_STOPS: StopRow[] = VATTERN_CONTROLS.filter((c) => c.km > 0 && c.km < 315).map(
  (c) => ({
    control: c.name,
    km: c.km,
    minutes: DEPOT_MINUTES[c.name] ?? 0,
  }),
);

const LS_KEY = 'stp_form_v1';

// Single source of truth for the persisted form's defaults: used both to seed
// the initial state (when nothing is saved) and to restore on reset.
const FORM_DEFAULTS: PersistedForm = {
  targetTotalHm: '11:45',
  ftp: 272,
  nRiders: 12,
  m: 96,
  watchTarget: 'pull',
  raceDate: '2026-06-13',
  startTime: '04:22',
  stops: DEFAULT_STOPS,
  styrkortMaxRows: 20,
  exposureTerrain: 'mixed',
  showInterval: true,
};

interface PersistedForm {
  targetTotalHm: string;
  ftp: number;
  nRiders: number;
  m: number;
  watchTarget: WatchTarget;
  raceDate: string;
  startTime: string;
  stops: StopRow[];
  styrkortMaxRows: number;
  exposureTerrain: ExposureTerrain;
  showInterval: boolean;
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

  // Files. The GPX defaults to the bundled Vätternrundan route (prefilled on
  // load); selecting a file overrides it. FIT is not persisted.
  const [gpxText, setGpxText] = useState<string>(defaultRouteGpx);
  const [gpxName, setGpxName] = useState<string>(DEFAULT_ROUTE_NAME);
  const [fitBytes, setFitBytes] = useState<Uint8Array | null>(null);
  const [fitName, setFitName] = useState<string>('');

  // Parameters.
  const [targetTotalHm, setTargetTotalHm] = useState(
    saved.targetTotalHm ?? FORM_DEFAULTS.targetTotalHm,
  );
  const [ftp, setFtp] = useState(saved.ftp ?? FORM_DEFAULTS.ftp);
  const [nRiders, setNRiders] = useState(saved.nRiders ?? FORM_DEFAULTS.nRiders);
  const [m, setM] = useState(saved.m ?? FORM_DEFAULTS.m);
  const [watchTarget, setWatchTarget] = useState<WatchTarget>(
    saved.watchTarget ?? FORM_DEFAULTS.watchTarget,
  );
  const [raceDate, setRaceDate] = useState(saved.raceDate ?? FORM_DEFAULTS.raceDate);
  const [startTime, setStartTime] = useState(saved.startTime ?? FORM_DEFAULTS.startTime);
  const [styrkortMaxRows, setStyrkortMaxRows] = useState(
    saved.styrkortMaxRows ?? FORM_DEFAULTS.styrkortMaxRows,
  );
  const [exposureTerrain, setExposureTerrain] = useState<ExposureTerrain>(
    saved.exposureTerrain ?? FORM_DEFAULTS.exposureTerrain,
  );
  const [showInterval, setShowInterval] = useState(
    saved.showInterval ?? FORM_DEFAULTS.showInterval,
  );

  // Stops.
  const [stops, setStops] = useState<StopRow[]>(saved.stops ?? FORM_DEFAULTS.stops);

  // Progressive disclosure: advanced parameters stay hidden until requested.
  const [showAdvanced, setShowAdvanced] = useState(false);

  const persist = (patch: Partial<PersistedForm>) => {
    saveToStorage({
      targetTotalHm,
      ftp,
      nRiders,
      m,
      watchTarget,
      raceDate,
      startTime,
      stops,
      styrkortMaxRows,
      exposureTerrain,
      showInterval,
      ...patch,
    });
  };

  const running = status === 'running';
  const canRun = !running && gpxText.trim().length > 0;
  // The baked exposure file only covers the bundled route. For an uploaded GPX
  // we would have to fetch exposure (see fetchExposureForRoute), which is not
  // implemented yet, so we surface a disabled affordance instead.
  const isDefaultRoute = gpxText === defaultRouteGpx;

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

  // Build a FormSubmit. Pass an explicit snapshot to build from values other
  // than the current state (used by reset, where setState has not flushed yet);
  // otherwise it reads the live state.
  const buildSubmit = (snapshot?: {
    gpxText: string;
    fitBytes: Uint8Array | null;
    values: PersistedForm;
  }): FormSubmit => {
    const v: PersistedForm = snapshot?.values ?? {
      targetTotalHm,
      ftp,
      nRiders,
      m,
      watchTarget,
      raceDate,
      startTime,
      stops,
      styrkortMaxRows,
      exposureTerrain,
      showInterval,
    };
    const resolvedGpx = snapshot?.gpxText ?? gpxText;
    return {
      gpxText: resolvedGpx,
      fitBytes: snapshot ? snapshot.fitBytes : fitBytes,
      showInterval: v.showInterval,
      form: {
        target_total_hm: v.targetTotalHm,
        ftp: v.ftp,
        n_riders: v.nRiders,
        m: v.m,
        stops: v.stops,
        watch_target: v.watchTarget,
        race_date: v.raceDate,
        start_time: v.startTime,
        styrkort_max_rows: v.styrkortMaxRows,
        exposure_terrain: v.exposureTerrain,
        // The baked exposure file only matches the bundled route; once the user
        // picks their own GPX this is false and we fall back to coarse terrain.
        is_default_route: resolvedGpx === defaultRouteGpx,
      },
    };
  };

  // Wipe the saved settings and restore every field to its default, including
  // the bundled GPX and a cleared FIT. Re-seeds the parent's weather hours from
  // the defaults (built explicitly, since the setState calls above have not yet
  // flushed when onRun runs).
  const handleReset = () => {
    if (!window.confirm('Återställ alla inställningar till standard?')) return;
    localStorage.removeItem(LS_KEY);
    setTargetTotalHm(FORM_DEFAULTS.targetTotalHm);
    setFtp(FORM_DEFAULTS.ftp);
    setNRiders(FORM_DEFAULTS.nRiders);
    setM(FORM_DEFAULTS.m);
    setWatchTarget(FORM_DEFAULTS.watchTarget);
    setRaceDate(FORM_DEFAULTS.raceDate);
    setStartTime(FORM_DEFAULTS.startTime);
    setStyrkortMaxRows(FORM_DEFAULTS.styrkortMaxRows);
    setExposureTerrain(FORM_DEFAULTS.exposureTerrain);
    setShowInterval(FORM_DEFAULTS.showInterval);
    setStops(FORM_DEFAULTS.stops);
    setGpxText(defaultRouteGpx);
    setGpxName(DEFAULT_ROUTE_NAME);
    setFitBytes(null);
    setFitName('');
    onRun(buildSubmit({ gpxText: defaultRouteGpx, fitBytes: null, values: FORM_DEFAULTS }));
  };

  // Seed the parent with the initial/persisted values on mount so the weather
  // panel has a sensible hour range (from start_time + target) before the user
  // clicks the submit button. Edits are pushed up again on submit.

  useEffect(() => {
    onRun(buildSubmit());
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canRun) return;
    onRun(buildSubmit());
  };

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Rutt och parametrar</h2>

      <fieldset className="form-section">
        <legend>Mål &amp; rutt</legend>
        <div className="field-grid">
          <label className="field">
            <FieldLabel text="Måltid (h:mm)" helpKey="target" />
            <input
              type="text"
              value={targetTotalHm}
              onChange={(e) => {
                setTargetTotalHm(e.target.value);
                persist({ targetTotalHm: e.target.value });
              }}
              placeholder="11:45"
            />
            <small className="hint">{FIELD_HELP.target.help}</small>
          </label>

          <label className="field">
            <FieldLabel text="Starttid (HH:MM)" helpKey="startTime" />
            <input
              type="text"
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
                persist({ startTime: e.target.value });
              }}
              placeholder="04:22"
            />
            <small className="hint">{FIELD_HELP.startTime.help}</small>
          </label>

          <label className="field">
            <FieldLabel text="GPX-rutt" helpKey="gpx" />
            <input type="file" accept=".gpx,application/gpx+xml,text/xml" onChange={onGpxChange} />
            {gpxName && <small className="hint">Inläst: {gpxName}</small>}
          </label>
        </div>
      </fieldset>

      <button
        type="button"
        className="link advanced-toggle"
        aria-expanded={showAdvanced}
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? 'Dölj avancerade inställningar' : 'Visa avancerade inställningar'}
      </button>

      {showAdvanced && (
        <>
          <fieldset className="form-section">
            <legend>Kraft &amp; grupp</legend>
            <div className="field-grid">
              <label className="field">
                <FieldLabel text="FTP (W)" helpKey="ftp" />
                <input
                  type="number"
                  value={ftp}
                  min={1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setFtp(v);
                    persist({ ftp: v });
                  }}
                />
                <small className="hint">{FIELD_HELP.ftp.help}</small>
              </label>

              <label className="field">
                <FieldLabel text="Cyklister i gruppen" helpKey="riders" />
                <input
                  type="number"
                  value={nRiders}
                  min={1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setNRiders(v);
                    persist({ nRiders: v });
                  }}
                />
              </label>

              <label className="field">
                <FieldLabel text="Cyklist + cykel (kg)" helpKey="mass" />
                <input
                  type="number"
                  value={m}
                  min={1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setM(v);
                    persist({ m: v });
                  }}
                />
              </label>

              <label className="field">
                <FieldLabel text="Klockmål" helpKey="watchTarget" />
                <select
                  value={watchTarget}
                  onChange={(e) => {
                    const v = e.target.value as WatchTarget;
                    setWatchTarget(v);
                    persist({ watchTarget: v });
                  }}
                >
                  <option value="pull">Dragläge</option>
                  <option value="avg">Gruppsnitt</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend>Övrigt</legend>
            <div className="field-grid">
              <label className="field">
                <FieldLabel text="Tävlingsdatum" helpKey="raceDate" />
                <input
                  type="date"
                  value={raceDate}
                  required
                  onChange={(e) => {
                    setRaceDate(e.target.value);
                    persist({ raceDate: e.target.value });
                  }}
                />
              </label>

              <label className="field">
                <FieldLabel text="Max rader i styrkortet" helpKey="maxRows" />
                <input
                  type="number"
                  value={styrkortMaxRows}
                  min={5}
                  max={50}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setStyrkortMaxRows(v);
                    persist({ styrkortMaxRows: v });
                  }}
                />
                <small className="hint">{FIELD_HELP.maxRows.help}</small>
              </label>

              <label className="field">
                <FieldLabel text="FIT-effektfil (valfri)" helpKey="fit" />
                <input type="file" accept=".fit,application/octet-stream" onChange={onFitChange} />
                {fitName && <small className="hint">Inläst: {fitName}</small>}
              </label>
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend>Vind &amp; terräng</legend>
            <div className="field-grid">
              <label className="field">
                <FieldLabel text="Hur öppen är rutten?" helpKey="terrain" />
                <select
                  value={exposureTerrain}
                  onChange={(e) => {
                    const v = e.target.value as ExposureTerrain;
                    setExposureTerrain(v);
                    persist({ exposureTerrain: v });
                  }}
                >
                  <option value="open">Öppet</option>
                  <option value="mixed">Blandat</option>
                  <option value="sheltered">Skyddat</option>
                </select>
                <small className="hint">{FIELD_HELP.terrain.help}</small>
              </label>

              <label className="field field-check">
                <span>
                  <input
                    type="checkbox"
                    checked={showInterval}
                    onChange={(e) => {
                      setShowInterval(e.target.checked);
                      persist({ showInterval: e.target.checked });
                    }}
                  />{' '}
                  Visa spann
                </span>
                <small className="hint">
                  Visar sluttiden som ett intervall när vindosäkerheten är minst en minut.
                </small>
              </label>

              {!isDefaultRoute && (
                <label className="field">
                  <span>Exponering för rutten</span>
                  <button type="button" className="ghost" disabled title="Inte tillgängligt ännu">
                    Hämta exponering för rutten
                  </button>
                  <small className="hint">
                    Kommer snart. Egna rutter använder tills vidare öppenhetsvalet ovan.
                  </small>
                </label>
              )}
            </div>
          </fieldset>
        </>
      )}

      <fieldset className="form-section stops">
        <legend>Stopp</legend>
        <table className="data-table stops-table">
          <thead>
            <tr>
              <th>Kontroll</th>
              <th className="num">km</th>
              <th className="num">Minuter</th>
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
                    Ta bort
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="ghost" onClick={addStop}>
          Lägg till stopp
        </button>
      </fieldset>

      <div className="actions">
        <button type="submit" className="primary" disabled={!canRun}>
          Använd inställningar
        </button>
        <button type="button" className="ghost" onClick={handleReset} disabled={running}>
          Återställ till standard
        </button>
        {running && <span className="spinner" aria-label="Beräknar" />}
      </div>
    </form>
  );
}
