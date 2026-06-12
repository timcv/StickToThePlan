import { describe, it, expect } from 'vitest';
import type { DisplaySegment } from '../src/types.js';
import type { ControlPoint } from '../src/segmentation.js';
import { checkpointsFromStyrkort } from '../src/output/checkpoints.js';

function seg(to_km: number, town?: string): DisplaySegment {
  return {
    from_km: 0,
    to_km,
    town,
    distance_m: to_km * 1000,
    net_height_m: 0,
    avg_grade: 0,
    avg_speed_kmh: 28,
    eta_s: 0,
    wind_label: 'Lugnt',
    pull_w_mean: 150,
    pull_w_low: 145,
    pull_w_high: 155,
    avg_w: 130,
    note: 'JÄMN FART',
    micro_indices: [],
  };
}

const controls: ControlPoint[] = [
  { name: 'Motala', km: 0 },
  { name: 'Gränna', km: 77 },
  { name: 'Hjo', km: 173 },
];

describe('checkpointsFromStyrkort', () => {
  it('prepends a Start checkpoint at km 0 using the km-0 control name', () => {
    const cps = checkpointsFromStyrkort([seg(77, 'Gränna')], controls);
    expect(cps[0]).toEqual({ name: 'Motala', km: 0 });
  });

  it('falls back to "Start" when no control sits at km 0', () => {
    const cps = checkpointsFromStyrkort([seg(40, 'Hästholmen')], [{ name: 'Hästholmen', km: 40 }]);
    expect(cps[0]).toEqual({ name: 'Start', km: 0 });
  });

  it('keeps named-control row names and emits one checkpoint per row', () => {
    const cps = checkpointsFromStyrkort([seg(77, 'Gränna'), seg(173, 'Hjo')], controls);
    expect(cps).toHaveLength(3); // Start + 2 rows
    expect(cps.map((c) => c.name)).toEqual(['Motala', 'Gränna', 'Hjo']);
    expect(cps.map((c) => c.km)).toEqual([0, 77, 173]);
  });

  it('labels split points without a town as "km X"', () => {
    const cps = checkpointsFromStyrkort([seg(77, 'Gränna'), seg(240)], controls);
    expect(cps[2]).toEqual({ name: 'km 240', km: 240 });
  });

  it('checkpoint count tracks the styrkort row count (Max rader)', () => {
    const few = checkpointsFromStyrkort([seg(157), seg(314.9, 'Motala (mål)')], controls);
    const many = checkpointsFromStyrkort(
      [seg(77, 'Gränna'), seg(157), seg(236), seg(314.9, 'Motala (mål)')],
      controls,
    );
    expect(few).toHaveLength(3); // Start + 2
    expect(many).toHaveLength(5); // Start + 4
  });
});
