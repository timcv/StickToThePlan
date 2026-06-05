/**
 * SummaryCard finish-time rendering.
 *
 * Verifies the honesty interval: the finish time renders as a range
 * ("spann L–H") when the wind/exposure spread is at least 60 s, and as a single
 * point value when the spread is under 60 s. Uses @testing-library/react under
 * jsdom (the vitest web project).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SummaryCard } from '../src/components/SummaryCard';

// globals:false disables @testing-library's automatic afterEach cleanup, so the
// previous test's DOM would otherwise leak into the next render. Clean up by hand.
afterEach(cleanup);
import { secondsToHMM } from '../src/lib/format';
import type { ThreeScenarios, SplitRow, Config, PlanResult } from '@stp/core';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EXPECTED_S = 11 * 3600 + 45 * 60; // 11:45

// Minimal PlanResult: only the fields SummaryCard reads matter; the rest are
// filled with inert values so the object type-checks as PlanResult.
const plan = {
  total_time_s: EXPECTED_S,
  np_target_used: 230,
  reachable: true,
  intensity_factor: 0.78,
  rider_np_ride_w: 215,
  notes: [],
  segments: [],
  stops: [],
} as unknown as PlanResult;

function scenarios(low: number, high: number): ThreeScenarios {
  return {
    expected: plan,
    optimistic: plan,
    pessimistic: plan,
    time_uncertainty_s: { expected: EXPECTED_S, low, high, source: 'scenario' },
  };
}

const splits: SplitRow[] = [
  {
    fromControl: 'Start',
    toControl: 'Mål',
    leg_distance_m: 315_000,
    leg_time_s: EXPECTED_S,
    arrive_s: EXPECTED_S,
    stop_minutes: 0,
    depart_s: EXPECTED_S,
    cumulative_s: EXPECTED_S,
  },
];

const cfg = { ftp: 272 } as unknown as Config;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SummaryCard finish-time interval', () => {
  it('renders a range when the spread is >= 60 s', () => {
    // low = 11:32, high = 12:04 -> spread well over a minute.
    const low = 11 * 3600 + 32 * 60;
    const high = 12 * 3600 + 4 * 60;
    render(<SummaryCard scenarios={scenarios(low, high)} splits={splits} cfg={cfg} />);
    expect(screen.getByText(/spann/)).toBeTruthy();
    expect(screen.getByText(new RegExp(secondsToHMM(low))).textContent).toContain(
      secondsToHMM(high),
    );
  });

  it('renders only the point value when the spread is < 60 s', () => {
    // 30 s spread around the expected time -> below the 60 s threshold.
    const low = EXPECTED_S - 15;
    const high = EXPECTED_S + 15;
    render(<SummaryCard scenarios={scenarios(low, high)} splits={splits} cfg={cfg} />);
    expect(screen.queryByText(/spann/)).toBeNull();
    expect(screen.getByText(secondsToHMM(EXPECTED_S))).toBeTruthy();
  });

  it('renders the point value when showInterval is false even with a spread', () => {
    const low = 11 * 3600 + 32 * 60;
    const high = 12 * 3600 + 4 * 60;
    render(
      <SummaryCard
        scenarios={scenarios(low, high)}
        splits={splits}
        cfg={cfg}
        showInterval={false}
      />,
    );
    expect(screen.queryByText(/spann/)).toBeNull();
    expect(screen.getByText(secondsToHMM(EXPECTED_S))).toBeTruthy();
  });
});
