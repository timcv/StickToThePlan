/**
 * At-a-glance summary shown above the detailed tables: estimated finish time,
 * total distance, average speed and the anchor power, so the rider grasps the
 * plan without scanning the splits. Warns when the target time needs power at
 * or above FTP (i.e. is not comfortably sustainable).
 */
import type { ThreeScenarios, SplitRow, Config } from '@stp/core';
import { secondsToHMM, avgSpeedKmh } from '../lib/format';

interface Props {
  scenarios: ThreeScenarios;
  splits: SplitRow[];
  cfg: Config;
}

export function SummaryCard({ scenarios, splits, cfg }: Props) {
  const expected = scenarios.expected;
  const totalDistanceM = splits.reduce((s, r) => s + r.leg_distance_m, 0);
  const rollingTimeS = splits.reduce((s, r) => s + r.leg_time_s, 0);
  const np = Math.round(expected.np_target_used);
  const overFtp = !expected.reachable || np >= cfg.ftp;

  return (
    <section className="card summary-card">
      <h2>Din plan</h2>
      <div className="summary-stats">
        <div className="stat">
          <span className="stat-value">{secondsToHMM(expected.total_time_s)}</span>
          <span className="stat-label">Beräknad sluttid</span>
        </div>
        <div className="stat">
          <span className="stat-value">{(totalDistanceM / 1000).toFixed(0)} km</span>
          <span className="stat-label">Total sträcka</span>
        </div>
        <div className="stat">
          <span className="stat-value">{avgSpeedKmh(totalDistanceM, rollingTimeS)}</span>
          <span className="stat-label">Snittfart (km/h)</span>
        </div>
        <div className="stat">
          <span className="stat-value">{np} W</span>
          <span className="stat-label">Mål-effekt (NP)</span>
        </div>
      </div>
      {overFtp && (
        <p className="warn">
          {expected.reachable
            ? `Måltiden kräver effekt nära din FTP (${cfg.ftp} W). Planen är tuff att hålla hela vägen.`
            : 'Måltiden går inte att hålla uthålligt. Planen visar den snabbaste hållbara tiden.'}
        </p>
      )}
    </section>
  );
}
