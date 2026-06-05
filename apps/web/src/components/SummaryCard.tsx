/**
 * At-a-glance summary shown above the detailed tables: estimated finish time,
 * total distance, average speed and the anchor power, so the rider grasps the
 * plan without scanning the splits. Warns when the target time needs power at
 * or above FTP (i.e. is not comfortably sustainable).
 */
import type { ThreeScenarios, SplitRow, Config } from '@stp/core';
import { secondsToHMM, avgSpeedKmh, formatFinishInterval } from '../lib/format';
import { InfoTip } from './InfoTip';
import { TERM_HELP } from '../lib/strings';

interface Props {
  scenarios: ThreeScenarios;
  splits: SplitRow[];
  cfg: Config;
  /** When false the finish time is always shown as a point, never a range. */
  showInterval?: boolean;
}

export function SummaryCard({ scenarios, splits, cfg, showInterval = true }: Props) {
  const expected = scenarios.expected;
  const totalDistanceM = splits.reduce((s, r) => s + r.leg_distance_m, 0);
  const rollingTimeS = splits.reduce((s, r) => s + r.leg_time_s, 0);
  const np = Math.round(expected.np_target_used);
  const overFtp = !expected.reachable || np >= cfg.ftp;

  // Honest finish time: a range when the wind/exposure spread is at least a
  // minute, otherwise the point value. The checkbox can force the point value.
  const unc = scenarios.time_uncertainty_s;
  const hasSpread = unc.high - unc.low >= 60;
  const finishText =
    showInterval && hasSpread
      ? formatFinishInterval(unc.expected, unc.low, unc.high)
      : secondsToHMM(expected.total_time_s);

  return (
    <section className="card summary-card">
      <h2>Din plan</h2>
      <div className="summary-stats">
        <div className="stat">
          <span className="stat-value">{finishText}</span>
          <span className="stat-label">
            Beräknad sluttid
            {showInterval && hasSpread && (
              <>
                {' '}
                <InfoTip label="Spann" text={TERM_HELP.spann.tip} />
              </>
            )}
          </span>
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
          <span className="stat-label">
            Mål-effekt (NP) <InfoTip label="NP" text={TERM_HELP.np.tip} />
          </span>
        </div>
      </div>
      {overFtp && (
        <p className="warn">
          {expected.reachable
            ? `Måltiden kräver effekt nära din FTP (${cfg.ftp} W). Planen är tuff att hålla hela vägen.`
            : 'Måltiden går inte att hålla uthålligt. Planen visar den snabbaste hållbara tiden.'}
        </p>
      )}
      {scenarios.data_quality &&
        (() => {
          const pct = scenarios.data_quality.exposureCoveragePct;
          return pct >= 60 ? (
            <p className="muted">Exponeringsdata: {Math.round(pct)}% av rutten</p>
          ) : (
            <p className="warn">
              Exponeringsdata saknas för {Math.round(100 - pct)}% av rutten, vindintervallet är
              extra osäkert.
            </p>
          );
        })()}
    </section>
  );
}
