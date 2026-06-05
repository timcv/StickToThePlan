import { describe, it, expect } from 'vitest';
import type { WindSample } from '../src/types.js';
import { buildEnsemble, makeWeatherFn } from '../src/weather/ensemble.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSample(
  overrides: Partial<WindSample> & { windspeed_ms: number; winddir_from_deg: number },
): WindSample {
  return {
    time_iso: '2026-06-13T06:00:00Z',
    lat: 58.0,
    lon: 15.0,
    temp_c: 10,
    pressure_pa: 101_325,
    source: 'test-source-A',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildEnsemble: vector mean direction
// ---------------------------------------------------------------------------

describe('buildEnsemble vector mean', () => {
  it('averages 350 deg and 10 deg to ~0 deg (not 180), speed between 4.8 and 5.0', () => {
    const samples: WindSample[] = [
      makeSample({ windspeed_ms: 5, winddir_from_deg: 350, source: 'src-A' }),
      makeSample({ windspeed_ms: 5, winddir_from_deg: 10, source: 'src-B' }),
    ];

    const field = buildEnsemble(samples);
    expect(field.cells).toHaveLength(1);

    const cell = field.cells[0];

    // Wind speed: vector mean of two symmetric vectors should be close to 5*cos(10deg) ~ 4.92
    expect(cell.windspeed_mean_ms).toBeGreaterThan(4.8);
    expect(cell.windspeed_mean_ms).toBeLessThan(5.0);

    // Direction: 0 degrees (north), NOT 180. Handle 360-wrap: both 0 and 360 are acceptable.
    const dir = cell.winddir_from_deg;
    const isNearZero = dir < 5 || dir > 355;
    expect(isNearZero).toBe(true);

    // n_sources counts distinct sources
    expect(cell.n_sources).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildEnsemble: percentiles
// ---------------------------------------------------------------------------

describe('buildEnsemble percentiles', () => {
  it('computes p10 near 2 and p90 near 10 for speeds [2,4,6,8,10]', () => {
    const speeds = [2, 4, 6, 8, 10];
    const samples: WindSample[] = speeds.map((s, i) =>
      makeSample({ windspeed_ms: s, winddir_from_deg: 270, source: `src-${i}` }),
    );

    const field = buildEnsemble(samples);
    const cell = field.cells[0];

    expect(cell.windspeed_p10_ms).toBeGreaterThanOrEqual(2);
    expect(cell.windspeed_p10_ms).toBeLessThanOrEqual(3);

    expect(cell.windspeed_p90_ms).toBeGreaterThanOrEqual(9);
    expect(cell.windspeed_p90_ms).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// buildEnsemble: reduced flag
// ---------------------------------------------------------------------------

describe('buildEnsemble reduced flag', () => {
  it('reduced=true when fewer than 3 distinct sources', () => {
    const samples: WindSample[] = [
      makeSample({ windspeed_ms: 5, winddir_from_deg: 180, source: 'src-A' }),
      makeSample({ windspeed_ms: 5, winddir_from_deg: 180, source: 'src-B' }),
    ];
    const field = buildEnsemble(samples);
    expect(field.reduced).toBe(true);
  });

  it('reduced=false when 3 or more distinct sources', () => {
    const samples: WindSample[] = [
      makeSample({ windspeed_ms: 5, winddir_from_deg: 180, source: 'src-A' }),
      makeSample({ windspeed_ms: 5, winddir_from_deg: 180, source: 'src-B' }),
      makeSample({ windspeed_ms: 5, winddir_from_deg: 180, source: 'src-C' }),
    ];
    const field = buildEnsemble(samples);
    expect(field.reduced).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makeWeatherFn: scenario selection
// ---------------------------------------------------------------------------

describe('makeWeatherFn scenario selection', () => {
  it('returns p10 for optimistic, p90 for pessimistic, mean for expected', () => {
    const speeds = [2, 4, 6, 8, 10];
    // Put them all at same location/time but different sources so we get a real cell
    const samples: WindSample[] = speeds.map((s, i) =>
      makeSample({ windspeed_ms: s, winddir_from_deg: 90, source: `src-${i}` }),
    );

    const field = buildEnsemble(samples);
    expect(field.cells).toHaveLength(1);
    const cell = field.cells[0];

    const lat = 58.0;
    const lon = 15.0;
    const startClockS = 0; // doesn't affect single-cell field

    const fnExpected = makeWeatherFn(field, 'expected', startClockS);
    const fnOptimistic = makeWeatherFn(field, 'optimistic', startClockS);
    const fnPessimistic = makeWeatherFn(field, 'pessimistic', startClockS);

    const condExpected = fnExpected(lat, lon, 0);
    const condOptimistic = fnOptimistic(lat, lon, 0);
    const condPessimistic = fnPessimistic(lat, lon, 0);

    expect(condExpected.windspeed_ms).toBeCloseTo(cell.windspeed_mean_ms, 6);
    expect(condOptimistic.windspeed_ms).toBeCloseTo(cell.windspeed_p10_ms, 6);
    expect(condPessimistic.windspeed_ms).toBeCloseTo(cell.windspeed_p90_ms, 6);

    // direction, temp, pressure come from the cell regardless of scenario
    expect(condExpected.winddir_from_deg).toBeCloseTo(cell.winddir_from_deg, 3);
    expect(condExpected.temp_c).toBeCloseTo(cell.temp_c, 3);
    expect(condExpected.pressure_pa).toBeCloseTo(cell.pressure_pa, 1);
  });
});
