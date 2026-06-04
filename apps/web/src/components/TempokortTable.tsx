/**
 * The full tempokort, rendered from the structured DisplaySegment[] data (not
 * the markdown string). One row per display segment with distance, net climb,
 * average grade, the wind label, the pull watt band, the rider mean watts, the
 * note keyword, and the stop / departure annotation when the segment ends at a
 * control with a stop.
 */
import { secondsToClock, type DisplaySegment } from '@stp/core';
import { metersToKm1 } from '../lib/format';

interface Props {
  segments: DisplaySegment[];
  startTime: string;
}

export function TempokortTable({ segments, startTime }: Props) {
  return (
    <section className="card">
      <h2>Tempokort</h2>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Section (km)</th>
              <th>Town</th>
              <th className="num">Distance (km)</th>
              <th className="num">Net height (m)</th>
              <th className="num">Avg grade</th>
              <th>Wind</th>
              <th className="num">Pull band (W)</th>
              <th className="num">Avg (W)</th>
              <th>Note</th>
              <th>Stop</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((seg, i) => (
              <tr key={`${seg.from_km}-${seg.to_km}-${i}`}>
                <td>
                  {seg.from_km} to {seg.to_km}
                </td>
                <td>{seg.town ?? ''}</td>
                <td className="num">{metersToKm1(seg.distance_m)}</td>
                <td className="num">{Math.round(seg.net_height_m)}</td>
                <td className="num">{(seg.avg_grade * 100).toFixed(1)}%</td>
                <td>{seg.wind_label}</td>
                <td className="num">
                  {seg.pull_w_low === 0 && seg.pull_w_high === 0
                    ? ''
                    : `${seg.pull_w_low} to ${seg.pull_w_high}`}
                </td>
                <td className="num">{seg.avg_w > 0 ? seg.avg_w : ''}</td>
                <td>{seg.note}</td>
                <td>
                  {seg.stop_minutes !== undefined && seg.stop_minutes > 0
                    ? `${seg.stop_minutes} min${
                        seg.depart_s !== undefined
                          ? `, dep ${secondsToClock(seg.depart_s, startTime)}`
                          : ''
                      }`
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
