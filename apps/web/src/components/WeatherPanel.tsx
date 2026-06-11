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

/** What the manually entered wind speed represents. */
export type ManualWindRef = 'forecast10m' | 'felt';

interface Props {
  mode: WeatherMode;
  onModeChange: (m: WeatherMode) => void;
  rows: HourlyWind[];
  edited: Set<number>;
  fetchStatus: 'idle' | 'loading' | 'done' | 'error';
  /** Optional error message to show when fetchStatus is 'error'. */
  fetchError?: string;
  sources: string[];
  reduced: boolean;
  /** Manual mode only: whether the entered number is a 10 m forecast or felt wind. */
  windRef: ManualWindRef;
  onFetch: () => void;
  onEdit: (hour: number, patch: Partial<Omit<HourlyWind, 'hour'>>) => void;
  onResetHour: (hour: number) => void;
  onApplyConstant: (dir: number, speed: number) => void;
  onWindRefChange: (ref: ManualWindRef) => void;
}

export function WeatherPanel(props: Props) {
  const { mode, onModeChange, rows, edited, fetchStatus, fetchError, sources, reduced, windRef } =
    props;
  const [constDir, setConstDir] = useState(270);
  const [constSpeed, setConstSpeed] = useState(5);

  return (
    <section className="card weather-panel">
      <h2>Väder</h2>

      <div className="seg-toggle" role="group" aria-label="Väderläge">
        {(['calm', 'fetched', 'manual'] as WeatherMode[]).map((m) => (
          <button
            key={m}
            type="button"
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
          {fetchStatus === 'error' && (
            <span className="hint error">
              Hämtning misslyckades.{fetchError ? ` ${fetchError}` : ''}
            </span>
          )}
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
          <fieldset className="wind-ref" role="radiogroup" aria-label="Vad vinden jag angav är">
            <legend>Vinden jag angav är:</legend>
            <label>
              <input
                type="radio"
                name="wind-ref"
                value="forecast10m"
                checked={windRef === 'forecast10m'}
                onChange={() => props.onWindRefChange('forecast10m')}
              />
              10 m prognosvind
            </label>
            <label>
              <input
                type="radio"
                name="wind-ref"
                value="felt"
                checked={windRef === 'felt'}
                onChange={() => props.onWindRefChange('felt')}
              />
              vinden jag känner på vägen
            </label>
            <small className="hint">
              Väderprognoser anger vind på 10 meters höjd. Vid marken känner du oftast mindre. Välj
              &rsquo;10 m&rsquo; om siffran kommer från en prognos, annars &rsquo;vinden jag
              känner&rsquo;.
            </small>
          </fieldset>
          <label>
            Riktning°
            <input
              type="number"
              min={0}
              max={360}
              value={constDir}
              onChange={(e) => setConstDir(Number(e.target.value))}
            />
          </label>
          <label>
            Styrka m/s
            <input
              type="number"
              min={0}
              step={0.5}
              value={constSpeed}
              onChange={(e) => setConstSpeed(Number(e.target.value))}
            />
          </label>
          <button type="button" onClick={() => props.onApplyConstant(constDir, constSpeed)}>
            Applicera på alla timmar
          </button>
        </div>
      )}

      {mode !== 'calm' && rows.length > 0 && (
        <WindHourTable
          rows={rows}
          edited={edited}
          onChange={props.onEdit}
          onReset={props.onResetHour}
        />
      )}
    </section>
  );
}
