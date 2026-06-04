import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseWeatherQuery, handleWeather } from '../handler.js';

afterEach(() => vi.restoreAllMocks());

describe('parseWeatherQuery', () => {
  it('parses date + pipe-separated points', () => {
    const r = parseWeatherQuery({ date: '2026-06-13', pts: '58.5,14.6|58.6,14.7' });
    expect(r).toEqual({ date: '2026-06-13', points: [{ lat: 58.5, lon: 14.6 }, { lat: 58.6, lon: 14.7 }] });
  });
  it('returns null on missing date', () => {
    expect(parseWeatherQuery({ pts: '58.5,14.6' })).toBeNull();
  });
  it('returns null on malformed pts', () => {
    expect(parseWeatherQuery({ date: '2026-06-13', pts: 'garbage' })).toBeNull();
  });
  it('returns null on an empty pair half (Number("") is 0)', () => {
    expect(parseWeatherQuery({ date: '2026-06-13', pts: '58.5,' })).toBeNull();
    expect(parseWeatherQuery({ date: '2026-06-13', pts: '58.5,14.6|' })).toBeNull();
  });
  it('returns null on out-of-range coordinates', () => {
    expect(parseWeatherQuery({ date: '2026-06-13', pts: '100,14.6' })).toBeNull();
    expect(parseWeatherQuery({ date: '2026-06-13', pts: '58.5,200' })).toBeNull();
  });
  it('returns null above the point cap (64)', () => {
    const many = Array.from({ length: 65 }, () => '58.5,14.6').join('|');
    expect(parseWeatherQuery({ date: '2026-06-13', pts: many })).toBeNull();
  });
  it('accepts exactly the point cap (64)', () => {
    const cap = Array.from({ length: 64 }, () => '58.5,14.6').join('|');
    expect(parseWeatherQuery({ date: '2026-06-13', pts: cap })?.points).toHaveLength(64);
  });
});

describe('handleWeather', () => {
  it('400 on bad query', async () => {
    const res = await handleWeather({ date: '', pts: '' });
    expect(res.status).toBe(400);
    expect(res.headers['Cache-Control']).toBeUndefined();
  });

  it('200 + empty field + cache header when all sources fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const res = await handleWeather({ date: '2026-06-13', pts: '58.5,14.6' });
    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toContain('s-maxage=10800');
    expect(res.body).toEqual({ cells: [], sources: [], reduced: true });
  });

  it('200 + ensemble when a source answers', async () => {
    const om = [{ hourly: { time: ['2026-06-13T04:00'], windspeed_10m: [3], winddirection_10m: [270], temperature_2m: [9], surface_pressure: [1013] } }];
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.startsWith('https://api.open-meteo.com')
        ? ({ ok: true, json: async () => om } as Response)
        : ({ ok: false, json: async () => ({}) } as Response)));
    const res = await handleWeather({ date: '2026-06-13', pts: '58.5,14.6' });
    expect(res.status).toBe(200);
    expect((res.body as any).cells.length).toBeGreaterThan(0);
    expect((res.body as any).sources).toContain('open-meteo-forecast');
  });
});
