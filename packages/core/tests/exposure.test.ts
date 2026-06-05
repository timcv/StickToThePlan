import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyExposure, exposureCoveragePct, type ExposureRuns } from '../src/weather/exposure.js';
import { exposureClassToZ0 } from '../src/weather/effective.js';
import type { MicroSegment } from '../src/types.js';

function micros(n: number, segKm = 0.5): MicroSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    distance_m: segKm * 1000,
    cum_distance_m: (i + 1) * segKm * 1000,
    grade: 0,
    bearing_deg: 0,
    lat: 59,
    lon: 16,
    ele_start_m: 0,
    ele_end_m: 0,
    neutral: false,
  }));
}

const runs: ExposureRuns = JSON.parse(
  readFileSync(new URL('./fixtures/exposure-sample.json', import.meta.url), 'utf8'),
);

describe('applyExposure', () => {
  it('stamps class and z0 from the runs', () => {
    const m = micros(8); // 8 * 0.5 km = 4 km, matches the fixture
    applyExposure(m, runs);
    // midpoint of segment 0 is at 0.25 km -> "open"
    expect(m[0].exposure_class).toBe('open');
    expect(m[0].z0_used).toBeCloseTo(exposureClassToZ0('open'), 9);
    const bridgeSeg = m.find((s) => s.exposure_class === 'bridge');
    expect(bridgeSeg).toBeDefined();
  });

  it('full coverage when runs span the route', () => {
    const m = micros(8);
    applyExposure(m, runs);
    expect(exposureCoveragePct(m)).toBeCloseTo(100, 3);
  });

  it('empty runs are a no-op', () => {
    const m = micros(4);
    applyExposure(m, { route_id: 'x', total_km: 0, runs: [] });
    expect(m[0].exposure_class).toBeUndefined();
    expect(exposureCoveragePct(m)).toBe(0);
  });

  it('reports partial coverage when runs cover only part of the route', () => {
    const m = micros(16); // 16 * 0.5 km = 8 km; fixture only covers 0..4 km
    applyExposure(m, runs);
    expect(exposureCoveragePct(m)).toBeCloseTo(50, 1);
    expect(m[0].exposure_class).toBeDefined(); // first half stamped
    expect(m[15].exposure_class).toBeUndefined(); // second half beyond the runs
  });
});
