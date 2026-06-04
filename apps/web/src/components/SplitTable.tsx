/**
 * The hero: the depot / control split table.
 *
 * One row per leg between consecutive controls. Arrival and departure are
 * rendered as wall-clock times (start_time + offset) via secondsToClock; leg
 * time and the running cumulative are durations rendered as H:MM.
 */
import { secondsToClock, type SplitRow } from '@stp/core';
import { secondsToHMM, metersToKm1, avgSpeedKmh } from '../lib/format';

interface Props {
  splits: SplitRow[];
  startTime: string;
}

export function SplitTable({ splits, startTime }: Props) {
  return (
    <section className="card hero">
      <h2>Splitplan</h2>
      <div className="table-scroll">
        <table className="data-table split-table">
          <thead>
            <tr>
              <th>Sträcka</th>
              <th className="num">Distans (km)</th>
              <th className="num">Tid</th>
              <th className="num">Snitt (km/h)</th>
              <th className="num">Ankomst</th>
              <th className="num col-secondary">Stopp (min)</th>
              <th className="num col-secondary">Avgång</th>
              <th className="num col-secondary">Ackumulerat</th>
            </tr>
          </thead>
          <tbody>
            {splits.map((row, i) => (
              <tr key={`${row.fromControl}-${row.toControl}-${i}`}>
                <td>
                  {row.fromControl}–{row.toControl}
                </td>
                <td className="num">{metersToKm1(row.leg_distance_m)}</td>
                <td className="num">{secondsToHMM(row.leg_time_s)}</td>
                <td className="num">{avgSpeedKmh(row.leg_distance_m, row.leg_time_s)}</td>
                <td className="num">{secondsToClock(row.arrive_s, startTime)}</td>
                <td className="num col-secondary">{row.stop_minutes > 0 ? row.stop_minutes : ''}</td>
                <td className="num col-secondary">{secondsToClock(row.depart_s, startTime)}</td>
                <td className="num col-secondary">{secondsToHMM(row.cumulative_s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
