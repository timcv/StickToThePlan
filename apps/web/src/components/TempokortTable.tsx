/**
 * The full tempokort, rendered from the structured DisplaySegment[] data (not
 * the markdown string). One row per display segment with distance, net climb,
 * average grade, the wind label, the pull watt band, the rider mean watts, the
 * note keyword, and the stop / departure annotation when the segment ends at a
 * control with a stop.
 *
 * When compactSegments is provided a toggle button switches to the compact
 * styrkortsläge view (6 columns, optimised for a handlebar card).
 */
import { useState } from 'react';
import { secondsToClock, type DisplaySegment } from '@stp/core';
import { metersToKm1 } from '../lib/format';
import { InfoTip } from './InfoTip';

interface Props {
  segments: DisplaySegment[];
  compactSegments?: DisplaySegment[];
  startTime: string;
}

export function TempokortTable({ segments, compactSegments, startTime }: Props) {
  // Default to the compact styrkortsläge: it is the handlebar-friendly view most
  // riders want. The toggle reveals the full terrain + wind detail.
  const [compact, setCompact] = useState(true);

  const activeSegs = compact && compactSegments ? compactSegments : segments;

  return (
    <section className="card">
      <div className="tempokort-head">
        <h2 style={{ margin: 0 }}>Tempokort</h2>
        {compactSegments && (
          <>
            <button
              type="button"
              className="ghost"
              onClick={() => setCompact(v => !v)}
            >
              {compact ? 'Visa fullständigt' : 'Visa styrkortsläge'}
            </button>
            <InfoTip
              label="Tempokortets vyer"
              text="Styrkortsläge visar en kompakt vy för styret. Fullständigt visar mer terräng- och vindinformation."
            />
          </>
        )}
      </div>
      <div className="table-scroll">
        {compact ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Km</th>
                <th>Ort</th>
                <th className="num">km/h</th>
                <th className="num">Ankomst</th>
                <th className="num">Avgång</th>
                <th className="num">W</th>
              </tr>
            </thead>
            <tbody>
              {activeSegs.map((seg, i) => (
                <tr
                  key={`${seg.from_km}-${seg.to_km}-${i}`}
                  className={seg.stop_minutes ? 'stop-row' : undefined}
                >
                  <td>{seg.from_km}-{seg.to_km}</td>
                  <td>{seg.stop_minutes ? '☕ ' : ''}{seg.town ?? ''}</td>
                  <td className="num">{seg.avg_speed_kmh > 0 ? Math.round(seg.avg_speed_kmh) : ''}</td>
                  <td className="num">{secondsToClock(seg.eta_s, startTime)}</td>
                  <td className="num">
                    {seg.depart_s !== undefined
                      ? secondsToClock(seg.depart_s, startTime)
                      : ''}
                  </td>
                  <td className="num">{seg.avg_w > 0 ? seg.avg_w : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Sektion (km)</th>
                <th>Ort</th>
                <th className="num">Distans (km)</th>
                <th className="num col-secondary">Höjd (m)</th>
                <th className="num col-secondary">Lutning</th>
                <th>Vind</th>
                <th className="num col-secondary">Drageffekt (W)</th>
                <th className="num">Snitt (W)</th>
                <th className="col-secondary">Not</th>
                <th>Stopp</th>
              </tr>
            </thead>
            <tbody>
              {activeSegs.map((seg, i) => (
                <tr
                  key={`${seg.from_km}-${seg.to_km}-${i}`}
                  className={seg.stop_minutes ? 'stop-row' : undefined}
                >
                  <td>
                    {seg.from_km}–{seg.to_km}
                  </td>
                  <td>{seg.stop_minutes ? '☕ ' : ''}{seg.town ?? ''}</td>
                  <td className="num">{metersToKm1(seg.distance_m)}</td>
                  <td className="num col-secondary">{Math.round(seg.net_height_m)}</td>
                  <td className="num col-secondary">{(seg.avg_grade * 100).toFixed(1)}%</td>
                  <td>{seg.wind_label}</td>
                  <td className="num col-secondary">
                    {seg.pull_w_low === 0 && seg.pull_w_high === 0
                      ? ''
                      : `${seg.pull_w_low}–${seg.pull_w_high}`}
                  </td>
                  <td className="num">{seg.avg_w > 0 ? seg.avg_w : ''}</td>
                  <td className="col-secondary">{seg.note}</td>
                  <td>
                    {seg.stop_minutes !== undefined && seg.stop_minutes > 0
                      ? `${seg.stop_minutes} min${
                          seg.depart_s !== undefined
                            ? `, avg ${secondsToClock(seg.depart_s, startTime)}`
                            : ''
                        }`
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
