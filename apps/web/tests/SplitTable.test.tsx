/**
 * Render test for the SplitTable component.
 *
 * Uses @testing-library/react under jsdom (configured by the vitest web
 * project). Verifies that the table renders one row per SplitRow in the
 * fixture and that control names and formatted clock strings appear in the
 * output.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SplitTable } from '../src/components/SplitTable';
import { avgSpeedKmh } from '../src/lib/format';
import type { SplitRow } from '@stp/core';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

// Three realistic split rows for a 300 km ride starting at 06:00.
// arrive_s / depart_s are seconds elapsed since the race start (06:00).
// cumulative_s matches depart_s as buildSplitTable defines it.
const fixture: SplitRow[] = [
  {
    fromControl: 'Motala',
    toControl: 'Hästholmen',
    leg_distance_m: 40_200,
    leg_time_s: 4200, // 1:10 riding
    arrive_s: 4200, // 06:00 + 4200 s = 07:10
    stop_minutes: 5,
    depart_s: 4500, // 06:00 + 4500 s = 07:15
    cumulative_s: 4500,
  },
  {
    fromControl: 'Hästholmen',
    toControl: 'Gränna',
    leg_distance_m: 37_000,
    leg_time_s: 3900,
    arrive_s: 8400, // 06:00 + 8400 s = 08:20
    stop_minutes: 0,
    depart_s: 8400,
    cumulative_s: 8400,
  },
  {
    fromControl: 'Gränna',
    toControl: 'Jönköping',
    leg_distance_m: 28_000,
    leg_time_s: 2940,
    arrive_s: 11_340, // 06:00 + 11340 s = 09:09
    stop_minutes: 0,
    depart_s: 11_340,
    cumulative_s: 11_340,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SplitTable', () => {
  it('renders one tbody row per SplitRow', () => {
    const { container } = render(<SplitTable splits={fixture} startTime="06:00" />);
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3);
  });

  it('displays the control name "Motala" in the first row', () => {
    const { container } = render(<SplitTable splits={fixture} startTime="06:00" />);
    const firstRow = container.querySelector('tbody tr:first-child');
    expect(firstRow?.textContent).toContain('Motala');
  });

  it('displays a formatted arrival clock string in the first row', () => {
    // arrive_s = 4200, startTime = "06:00"
    // secondsToClock(4200, "06:00") -> 06:00 + 1h10m = "07:10"
    const { container } = render(<SplitTable splits={fixture} startTime="06:00" />);
    const firstRow = container.querySelector('tbody tr:first-child');
    expect(firstRow?.textContent).toContain('07:10');
  });

  it('displays avg speed in km/h for the first leg', () => {
    // leg: 40_200 m in 4200 s -> 40.2 km / 1.1667 h ~= 34.5 km/h
    const { container } = render(<SplitTable splits={fixture} startTime="06:00" />);
    const firstRow = container.querySelector('tbody tr:first-child');
    expect(firstRow?.textContent).toContain('34.5');
  });

  it('avgSpeedKmh returns 0.0 for zero time', () => {
    expect(avgSpeedKmh(1000, 0)).toBe('0.0');
  });

  it('avgSpeedKmh computes correctly', () => {
    // 40200 m / 4200 s = 9.571 m/s = 34.457 km/h -> "34.5"
    expect(avgSpeedKmh(40_200, 4200)).toBe('34.5');
  });
});
