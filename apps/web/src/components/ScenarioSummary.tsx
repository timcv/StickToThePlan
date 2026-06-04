/**
 * Compact three-row summary of the optimistic / expected / pessimistic plans.
 *
 * All three scenarios hit the SAME target total time, so they differ in the
 * anchor normalized power (np_target_used) each required: less headwind needs
 * less NP, more headwind needs more. We show each scenario's total time and the
 * required NP side by side.
 */
import type { ThreeScenarios } from '@stp/core';
import { secondsToHMM } from '../lib/format';

interface Props {
  scenarios: ThreeScenarios;
}

const ROWS = [
  { key: 'optimistic', label: 'Optimistic' },
  { key: 'expected', label: 'Expected' },
  { key: 'pessimistic', label: 'Pessimistic' },
] as const;

export function ScenarioSummary({ scenarios }: Props) {
  return (
    <section className="card">
      <h2>Scenario summary</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Total time</th>
            <th>Required NP (W)</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(({ key, label }) => {
            const plan = scenarios[key];
            return (
              <tr key={key}>
                <td>{label}</td>
                <td>{secondsToHMM(plan.total_time_s)}</td>
                <td>{Math.round(plan.np_target_used)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!scenarios.expected.reachable && (
        <p className="warn">
          Target time not reachable sustainably. Showing the fastest sustainable plan.
        </p>
      )}
    </section>
  );
}
