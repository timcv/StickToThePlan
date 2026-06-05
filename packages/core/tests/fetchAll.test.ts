import { describe, it, expect, vi, afterEach } from 'vitest';
import { gatherWindSamples, mapLimit } from '../src/weather/fetchAll.js';
import { parseOpenMeteoBatch, buildForecastUrlMulti } from '../src/weather/openMeteo.js';
import type { GeoPoint } from '../src/weather/openMeteo.js';

const points: GeoPoint[] = [
  { lat: 58.5, lon: 14.6 },
  { lat: 58.6, lon: 14.7 },
];

afterEach(() => vi.restoreAllMocks());

describe('buildForecastUrlMulti', () => {
  it('packs all coordinates into comma lists', () => {
    const url = buildForecastUrlMulti(points, '2026-06-13');
    expect(url).toContain('latitude=58.5,58.6');
    expect(url).toContain('longitude=14.6,14.7');
  });
});

describe('parseOpenMeteoBatch', () => {
  it('maps an array response element to each point', () => {
    const json = [
      {
        hourly: {
          time: ['2026-06-13T04:00'],
          windspeed_10m: [3],
          winddirection_10m: [270],
          temperature_2m: [9],
          surface_pressure: [1013],
        },
      },
      {
        hourly: {
          time: ['2026-06-13T04:00'],
          windspeed_10m: [5],
          winddirection_10m: [180],
          temperature_2m: [8],
          surface_pressure: [1012],
        },
      },
    ];
    const samples = parseOpenMeteoBatch(json, points, 'open-meteo-forecast');
    expect(samples).toHaveLength(2);
    expect(samples[0].lat).toBe(58.5);
    expect(samples[1].winddir_from_deg).toBe(180);
  });

  it('accepts a single-object response for one point', () => {
    const json = {
      hourly: {
        time: ['2026-06-13T04:00'],
        windspeed_10m: [3],
        winddirection_10m: [270],
        temperature_2m: [9],
        surface_pressure: [1013],
      },
    };
    const samples = parseOpenMeteoBatch(json, [points[0]], 'open-meteo-forecast');
    expect(samples).toHaveLength(1);
  });
});

describe('mapLimit', () => {
  it('never runs more than `limit` tasks at once', async () => {
    let active = 0,
      peak = 0;
    const work = Array.from({ length: 12 }, (_, i) => i);
    const results = await mapLimit(work, 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    // mapLimit is a map: results stay in input order regardless of completion order.
    expect(results).toEqual(work.map((n) => n * 2));
  });
});

describe('gatherWindSamples', () => {
  it('isolates a dead source (all fetches reject -> empty array, no throw)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const out = await gatherWindSamples(points, '2026-06-13');
    expect(out).toEqual([]);
  });

  it('merges samples from sources that answer', async () => {
    const omForecast = [
      {
        hourly: {
          time: ['2026-06-13T04:00'],
          windspeed_10m: [3],
          winddirection_10m: [270],
          temperature_2m: [9],
          surface_pressure: [1013],
        },
      },
      {
        hourly: {
          time: ['2026-06-13T04:00'],
          windspeed_10m: [3],
          winddirection_10m: [270],
          temperature_2m: [9],
          surface_pressure: [1013],
        },
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        // Only the forecast host answers. Match it exactly so the ensemble host
        // (ensemble-api.open-meteo.com) falls through to the "down" branch.
        if (url.startsWith('https://api.open-meteo.com'))
          return { ok: true, json: async () => omForecast } as Response;
        return { ok: false, json: async () => ({}) } as Response; // ensemble/smhi/met.no down
      }),
    );
    const out = await gatherWindSamples(points, '2026-06-13');
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.source === 'open-meteo-forecast')).toBe(true);
  });
});
