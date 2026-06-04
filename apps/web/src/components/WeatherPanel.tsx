/**
 * Weather controls: pick a mode (calm / server fetch / manual), fetch the
 * server ensemble, view + edit the hour-by-hour wind, or enter it manually.
 * Owns the hourly rows + the edited-hours set, and reports the resolved
 * weatherMode + HourlyWind rows up to App, which builds the final field.
 */
import { useState } from 'react';
import type { HourlyWind } from '@stp/core';
import { WindHourTable } from './WindHourTable';

export type WeatherMode = 'calm' | 'fetched' | 'manual';

interface Props {
  hours: number[];
  mode: WeatherMode;
  onModeChange: (m: WeatherMode) => void;
  rows: HourlyWind[];
  edited: Set<number>;
  fetchStatus: 'idle' | 'loading' | 'done' | 'error';
  sources: string[];
  reduced: boolean;
  onFetch: () => void;
  onEdit: (hour: number, patch: Partial<Omit<HourlyWind, 'hour'>>) => void;
  onResetHour: (hour: number) => void;
  onApplyConstant: (dir: number, speed: number) => void;
}

export function WeatherPanel(props: Props) {
  const { mode, onModeChange, rows, edited, fetchStatus, sources, reduced } = props;
  const [constDir, setConstDir] = useState(270);
  const [constSpeed, setConstSpeed] = useState(5);

  return (
    <section className="card weather-panel">
      <h2>Väder</h2>

      <div className="seg-toggle" role="group" aria-label="Väderläge">
        {(['calm', 'fetched', 'manual'] as WeatherMode[]).map((m) => (
          <button
            key={m} type="button"
            className={mode === m ? 'active' : ''}
            onClick={() => onModeChange(m)}
          >
            {m === 'calm' ? 'Lugnt' : m === 'fetched' ? 'Hämta' : 'Manuell'}
          </button>
        ))}
      </div>

      {mode === 'fetched' && (
        <div className="weather-fetch">
          <button type="button" onClick={props.onFetch} disabled={fetchStatus === 'loading'}>
            {fetchStatus === 'loading' ? 'Hämtar…' : 'Hämta väder'}
          </button>
          {fetchStatus === 'error' && <span className="hint error">Hämtning misslyckades.</span>}
          {fetchStatus === 'done' && (
            <span className="hint">
              Källor: {sources.join(', ') || 'inga'}
              {reduced && <span className="badge">reducerad</span>}
            </span>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <div className="weather-manual">
          <label>Riktning°
            <input type="number" min={0} max={360} value={constDir}
              onChange={(e) => setConstDir(Number(e.target.value))} />
          </label>
          <label>Styrka m/s
            <input type="number" min={0} step={0.5} value={constSpeed}
              onChange={(e) => setConstSpeed(Number(e.target.value))} />
          </label>
          <button type="button" onClick={() => props.onApplyConstant(constDir, constSpeed)}>
            Applicera på alla timmar
          </button>
        </div>
      )}

      {mode !== 'calm' && rows.length > 0 && (
        <WindHourTable rows={rows} edited={edited} onChange={props.onEdit} onReset={props.onResetHour} />
      )}
    </section>
  );
}
