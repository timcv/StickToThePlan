import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseOpenMeteo,
  buildForecastUrl,
  buildEnsembleUrl,
  fetchOpenMeteo,
  type GeoPoint,
} from '../src/weather/openMeteo.js';
import type { WindSample } from '../src/types.js';

// ---------------------------------------------------------------------------
// Fixture: two hours of Open-Meteo hourly data
// ---------------------------------------------------------------------------
const fixture = {
  hourly: {
    time: ['2026-06-13T04:00', '2026-06-13T05:00'],
    windspeed_10m: [3.2, 4.1],
    winddirection_10m: [270, 280],
    temperature_2m: [9.5, 10.2],
    surface_pressure: [1013.2, 1012.8],
  },
};

const point: GeoPoint = { lat: 58.5, lon: 14.6 };

// ---------------------------------------------------------------------------
// parseOpenMeteo
// ---------------------------------------------------------------------------
describe('parseOpenMeteo', () => {
  it('returns one WindSample per hourly entry', () => {
    const samples = parseOpenMeteo(fixture, point);
    expect(samples).toHaveLength(2);
  });

  it('sets lat and lon from the supplied point', () => {
    const samples = parseOpenMeteo(fixture, point);
    expect(samples[0].lat).toBe(58.5);
    expect(samples[0].lon).toBe(14.6);
  });

  it('preserves time_iso from hourly.time', () => {
    const samples = parseOpenMeteo(fixture, point);
    expect(samples[0].time_iso).toBe('2026-06-13T04:00');
    expect(samples[1].time_iso).toBe('2026-06-13T05:00');
  });

  it('copies windspeed_ms as-is (no conversion, API returns m/s)', () => {
    const samples = parseOpenMeteo(fixture, point);
    expect(samples[0].windspeed_ms).toBe(3.2);
    expect(samples[1].windspeed_ms).toBe(4.1);
  });

  it('copies winddir_from_deg as-is (meteorological from-direction)', () => {
    const samples = parseOpenMeteo(fixture, point);
    expect(samples[0].winddir_from_deg).toBe(270);
    expect(samples[1].winddir_from_deg).toBe(280);
  });

  it('copies temperature_2m to temp_c', () => {
    const samples = parseOpenMeteo(fixture, point);
    expect(samples[0].temp_c).toBe(9.5);
    expect(samples[1].temp_c).toBe(10.2);
  });

  it('converts surface_pressure hPa -> pascal (* 100)', () => {
    const samples = parseOpenMeteo(fixture, point);
    // 1013.2 hPa * 100 = 101320 Pa
    expect(samples[0].pressure_pa).toBeCloseTo(101320, 0);
    expect(samples[1].pressure_pa).toBeCloseTo(101280, 0);
  });

  it('uses default source open-meteo-forecast when none supplied', () => {
    const samples = parseOpenMeteo(fixture, point);
    expect(samples[0].source).toBe('open-meteo-forecast');
    expect(samples[1].source).toBe('open-meteo-forecast');
  });

  it('uses the supplied source string', () => {
    const samples = parseOpenMeteo(fixture, point, 'open-meteo-ensemble');
    expect(samples[0].source).toBe('open-meteo-ensemble');
    expect(samples[1].source).toBe('open-meteo-ensemble');
  });

  it('returns an empty array when hourly arrays are empty', () => {
    const empty = {
      hourly: {
        time: [],
        windspeed_10m: [],
        winddirection_10m: [],
        temperature_2m: [],
        surface_pressure: [],
      },
    };
    expect(parseOpenMeteo(empty, point)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildForecastUrl
// ---------------------------------------------------------------------------
describe('buildForecastUrl', () => {
  const url = buildForecastUrl({ lat: 58.5, lon: 14.6 }, '2026-06-13');

  it('uses the forecast hostname', () => {
    expect(url).toContain('api.open-meteo.com/v1/forecast');
  });

  it('includes latitude and longitude', () => {
    expect(url).toContain('latitude=58.5');
    expect(url).toContain('longitude=14.6');
  });

  it('requests wind speed in m/s', () => {
    expect(url).toContain('windspeed_unit=ms');
  });

  it('requests the expected hourly fields', () => {
    expect(url).toContain('hourly=windspeed_10m,winddirection_10m,temperature_2m,surface_pressure');
  });

  it('includes start_date and end_date equal to the supplied date', () => {
    expect(url).toContain('start_date=2026-06-13');
    expect(url).toContain('end_date=2026-06-13');
  });

  it('uses UTC timezone', () => {
    expect(url).toContain('timezone=UTC');
  });
});

// ---------------------------------------------------------------------------
// buildEnsembleUrl
// ---------------------------------------------------------------------------
describe('buildEnsembleUrl', () => {
  const url = buildEnsembleUrl({ lat: 58.5, lon: 14.6 }, '2026-06-13');

  it('uses the ensemble hostname', () => {
    expect(url).toContain('ensemble-api.open-meteo.com/v1/ensemble');
  });

  it('includes latitude and longitude', () => {
    expect(url).toContain('latitude=58.5');
    expect(url).toContain('longitude=14.6');
  });

  it('requests wind speed in m/s', () => {
    expect(url).toContain('windspeed_unit=ms');
  });

  it('requests the expected hourly fields', () => {
    expect(url).toContain('hourly=windspeed_10m,winddirection_10m,temperature_2m,surface_pressure');
  });

  it('specifies icon_seamless model', () => {
    expect(url).toContain('models=icon_seamless');
  });

  it('includes start_date and end_date equal to the supplied date', () => {
    expect(url).toContain('start_date=2026-06-13');
    expect(url).toContain('end_date=2026-06-13');
  });

  it('uses UTC timezone', () => {
    expect(url).toContain('timezone=UTC');
  });
});

// ---------------------------------------------------------------------------
// fetchOpenMeteo (mocked fetch - no live network)
// ---------------------------------------------------------------------------
describe('fetchOpenMeteo', () => {
  beforeEach(() => {
    // Provide a global fetch mock returning the fixture for any call
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => fixture,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns WindSamples for each point (forecast + ensemble)', async () => {
    const samples = await fetchOpenMeteo([point], '2026-06-13');
    // 2 points (forecast + ensemble) * 2 hourly entries = 4
    expect(samples).toHaveLength(4);
  });

  it('labels forecast samples with open-meteo-forecast', async () => {
    const samples = await fetchOpenMeteo([point], '2026-06-13');
    const forecast = samples.filter(s => s.source === 'open-meteo-forecast');
    expect(forecast.length).toBeGreaterThan(0);
  });

  it('labels ensemble samples with open-meteo-ensemble', async () => {
    const samples = await fetchOpenMeteo([point], '2026-06-13');
    const ensemble = samples.filter(s => s.source === 'open-meteo-ensemble');
    expect(ensemble.length).toBeGreaterThan(0);
  });

  it('calls fetch twice per point (forecast + ensemble)', async () => {
    await fetchOpenMeteo([point], '2026-06-13');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('calls fetch four times for two points', async () => {
    const p2: GeoPoint = { lat: 57.9, lon: 14.2 };
    await fetchOpenMeteo([point, p2], '2026-06-13');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
  });

  it('returns empty array when fetch rejects (graceful failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const samples = await fetchOpenMeteo([point], '2026-06-13');
    expect(samples).toEqual([]);
  });

  it('still returns successful fetches when one of two rejects', async () => {
    // First call (forecast) resolves, second call (ensemble) rejects
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ json: async () => fixture })
      .mockRejectedValueOnce(new Error('ensemble unavailable'))
    );
    const samples = await fetchOpenMeteo([point], '2026-06-13');
    // Only forecast samples should come through
    expect(samples).toHaveLength(2);
    expect(samples.every(s => s.source === 'open-meteo-forecast')).toBe(true);
  });
});
