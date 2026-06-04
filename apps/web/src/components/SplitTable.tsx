/**
 * The hero: the depot / control split table.
 *
 * One row per leg between consecutive controls. Arrival and departure are
 * rendered as wall-clock times (start_time + offset) via secondsToClock; leg
 * time and the running cumulative are durations rendered as H:MM.
 */
import { secondsToClock, type SplitRow } from '@stp/core';
import { secondsToHMM, metersToKm1 } from '../lib/format';

interface Props {
  splits: SplitRow[];
  startTime: string;
}

export function SplitTable({ splits, startTime }: Props) {
  return (
    <section className="card hero">
      <h2>Split plan</h2>
      <div className="table-scroll">
        <table className="data-table split-table">
          <thead>
            <tr>
              <th>Leg</th>
              <th className="num">Distance (km)</th>
              <th className="num">Leg time</th>
              <th className="num">Arrival</th>
              <th className="num">Stop (min)</th>
              <th className="num">Departure</th>
              <th className="num">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {splits.map((row, i) => (
              <tr key={`${row.fromControl}-${row.toControl}-${i}`}>
                <td>
                  {row.fromControl} to {row.toControl}
                </td>
                <td className="num">{metersToKm1(row.leg_distance_m)}</td>
                <td className="num">{secondsToHMM(row.leg_time_s)}</td>
                <td className="num">{secondsToClock(row.arrive_s, startTime)}</td>
                <td className="num">{row.stop_minutes > 0 ? row.stop_minutes : ''}</td>
                <td className="num">{secondsToClock(row.depart_s, startTime)}</td>
                <td className="num">{secondsToHMM(row.cumulative_s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
