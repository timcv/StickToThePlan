/**
 * Editable hour-by-hour wind table (direction + strength, route-wide).
 * Rows are derived from the fetched ensemble (summarizeHourly) or the manual
 * entries. Editing a cell bubbles up via onChange; per-row reset via onReset.
 */
import type { HourlyWind } from '@stp/core';

interface Props {
  rows: HourlyWind[];
  edited: Set<number>;
  onChange: (hour: number, patch: Partial<Omit<HourlyWind, 'hour'>>) => void;
  onReset: (hour: number) => void;
}

const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SV', 'V', 'NV'];

function compass(deg: number): string {
  return COMPASS[Math.round(((deg % 360) / 45)) % 8];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function WindHourTable({ rows, edited, onChange, onReset }: Props) {
  return (
    <table className="wind-table">
      <thead>
        <tr><th>Tid</th><th>Riktning</th><th></th><th>Styrka (m/s)</th><th></th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.hour} className={`wind-row${edited.has(r.hour) ? ' edited' : ''}`}>
            <td>{pad2(r.hour)}:00</td>
            <td>
              <input
                type="number" min={0} max={360} aria-label={`riktning ${r.hour}`}
                value={Math.round(r.dir_from_deg)}
                onChange={(e) => onChange(r.hour, { dir_from_deg: Number(e.target.value) })}
              />
            </td>
            <td>
              <span className="wind-arrow" style={{ transform: `rotate(${r.dir_from_deg + 180}deg)` }}>{'↑'}</span>
              <small>{compass(r.dir_from_deg)}</small>
            </td>
            <td>
              <input
                type="number" min={0} step={0.5} aria-label={`styrka ${r.hour}`}
                value={Math.round(r.speed_ms * 10) / 10}
                onChange={(e) => onChange(r.hour, { speed_ms: Number(e.target.value) })}
              />
            </td>
            <td>
              {edited.has(r.hour) && (
                <button type="button" className="link" onClick={() => onReset(r.hour)}>återställ</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
