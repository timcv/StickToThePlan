import { describe, it, expect } from 'vitest';
import { parseSmhi, buildSmhiUrl } from '../src/weather/smhi.js';

const FIXTURE = {
  timeSeries: [
    {
      validTime: '2026-06-13T04:00:00Z',
      parameters: [
        { name: 'ws', values: [4.2] },
        { name: 'wd', values: [260] },
        { name: 't', values: [9.1] },
        { name: 'msl', values: [1013.0] },
      ],
    },
  ],
};

const POINT = { lat: 58.535, lon: 15.042 };

describe('parseSmhi', () => {
  it('returns one WindSample from the fixture', () => {
    const samples = parseSmhi(FIXTURE, POINT);
    expect(samples).toHaveLength(1);
  });

  it('maps windspeed_ms from ws parameter', () => {
    const [s] = parseSmhi(FIXTURE, POINT);
    expect(s.windspeed_ms).toBe(4.2);
  });

  it('maps winddir_from_deg from wd parameter', () => {
    const [s] = parseSmhi(FIXTURE, POINT);
    expect(s.winddir_from_deg).toBe(260);
  });

  it('maps temp_c from t parameter', () => {
    const [s] = parseSmhi(FIXTURE, POINT);
    expect(s.temp_c).toBe(9.1);
  });

  it('converts pressure_pa from msl in hPa to Pa', () => {
    const [s] = parseSmhi(FIXTURE, POINT);
    expect(s.pressure_pa).toBe(101300);
  });

  it('sets time_iso from validTime', () => {
    const [s] = parseSmhi(FIXTURE, POINT);
    expect(s.time_iso).toBe('2026-06-13T04:00:00Z');
  });

  it('sets source to smhi', () => {
    const [s] = parseSmhi(FIXTURE, POINT);
    expect(s.source).toBe('smhi');
  });

  it('sets lat and lon from point', () => {
    const [s] = parseSmhi(FIXTURE, POINT);
    expect(s.lat).toBe(POINT.lat);
    expect(s.lon).toBe(POINT.lon);
  });

  it('skips entries missing wind parameters (ws)', () => {
    const noWind = {
      timeSeries: [
        {
          validTime: '2026-06-13T05:00:00Z',
          parameters: [
            { name: 't', values: [8.0] },
            { name: 'msl', values: [1012.0] },
          ],
        },
      ],
    };
    const samples = parseSmhi(noWind, POINT);
    expect(samples).toHaveLength(0);
  });

  it('handles multiple entries', () => {
    const multi = {
      timeSeries: [
        {
          validTime: '2026-06-13T04:00:00Z',
          parameters: [
            { name: 'ws', values: [4.2] },
            { name: 'wd', values: [260] },
            { name: 't', values: [9.1] },
            { name: 'msl', values: [1013.0] },
          ],
        },
        {
          validTime: '2026-06-13T05:00:00Z',
          parameters: [
            { name: 'ws', values: [3.8] },
            { name: 'wd', values: [270] },
            { name: 't', values: [10.0] },
            { name: 'msl', values: [1014.0] },
          ],
        },
      ],
    };
    const samples = parseSmhi(multi, POINT);
    expect(samples).toHaveLength(2);
    expect(samples[1].windspeed_ms).toBe(3.8);
  });
});

describe('buildSmhiUrl', () => {
  it('contains the rounded lon segment', () => {
    const url = buildSmhiUrl(POINT);
    expect(url).toContain('/lon/15.042000/');
  });

  it('contains the rounded lat segment', () => {
    const url = buildSmhiUrl(POINT);
    expect(url).toContain('/lat/58.535000/');
  });

  it('starts with the SMHI base URL', () => {
    const url = buildSmhiUrl(POINT);
    expect(url).toContain('opendata-download-metfcst.smhi.se');
  });

  it('rounds lon and lat to 6 decimal places', () => {
    const p = { lat: 58.5350001234567, lon: 15.0420001234567 };
    const url = buildSmhiUrl(p);
    expect(url).toContain('/lon/15.042000/');
    expect(url).toContain('/lat/58.535000/');
  });
});
