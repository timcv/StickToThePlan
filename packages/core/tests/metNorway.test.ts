import { describe, it, expect } from 'vitest';
import { parseMetNorway, buildMetNorwayUrl, metNorwayHeaders } from '../src/weather/metNorway.js';

const FIXTURE = {
  properties: {
    timeseries: [
      {
        time: '2026-06-13T04:00:00Z',
        data: {
          instant: {
            details: {
              wind_speed: 5.0,
              wind_from_direction: 250,
              air_temperature: 8.5,
              air_pressure_at_sea_level: 1012.5,
            },
          },
        },
      },
    ],
  },
};

const POINT = { lat: 58.535, lon: 15.042 };

describe('parseMetNorway', () => {
  it('returns one WindSample from the fixture', () => {
    const samples = parseMetNorway(FIXTURE, POINT);
    expect(samples).toHaveLength(1);
  });

  it('maps windspeed_ms from wind_speed', () => {
    const [s] = parseMetNorway(FIXTURE, POINT);
    expect(s.windspeed_ms).toBe(5.0);
  });

  it('maps winddir_from_deg from wind_from_direction', () => {
    const [s] = parseMetNorway(FIXTURE, POINT);
    expect(s.winddir_from_deg).toBe(250);
  });

  it('maps temp_c from air_temperature', () => {
    const [s] = parseMetNorway(FIXTURE, POINT);
    expect(s.temp_c).toBe(8.5);
  });

  it('converts pressure_pa from hPa to Pa', () => {
    const [s] = parseMetNorway(FIXTURE, POINT);
    expect(s.pressure_pa).toBe(101250);
  });

  it('sets time_iso from time field', () => {
    const [s] = parseMetNorway(FIXTURE, POINT);
    expect(s.time_iso).toBe('2026-06-13T04:00:00Z');
  });

  it('sets source to met-norway', () => {
    const [s] = parseMetNorway(FIXTURE, POINT);
    expect(s.source).toBe('met-norway');
  });

  it('sets lat and lon from point', () => {
    const [s] = parseMetNorway(FIXTURE, POINT);
    expect(s.lat).toBe(POINT.lat);
    expect(s.lon).toBe(POINT.lon);
  });

  it('handles multiple entries', () => {
    const multi = {
      properties: {
        timeseries: [
          {
            time: '2026-06-13T04:00:00Z',
            data: {
              instant: {
                details: {
                  wind_speed: 5.0,
                  wind_from_direction: 250,
                  air_temperature: 8.5,
                  air_pressure_at_sea_level: 1012.5,
                },
              },
            },
          },
          {
            time: '2026-06-13T05:00:00Z',
            data: {
              instant: {
                details: {
                  wind_speed: 6.1,
                  wind_from_direction: 240,
                  air_temperature: 9.0,
                  air_pressure_at_sea_level: 1011.0,
                },
              },
            },
          },
        ],
      },
    };
    const samples = parseMetNorway(multi, POINT);
    expect(samples).toHaveLength(2);
    expect(samples[1].windspeed_ms).toBe(6.1);
  });

  it('skips entries with missing details', () => {
    const broken = {
      properties: {
        timeseries: [
          {
            time: '2026-06-13T06:00:00Z',
            data: {
              instant: {
                details: null,
              },
            },
          },
        ],
      },
    };
    const samples = parseMetNorway(broken, POINT);
    expect(samples).toHaveLength(0);
  });
});

describe('buildMetNorwayUrl', () => {
  it('contains the lat parameter', () => {
    const url = buildMetNorwayUrl(POINT);
    expect(url).toContain('lat=58.535');
  });

  it('contains the lon parameter', () => {
    const url = buildMetNorwayUrl(POINT);
    expect(url).toContain('lon=15.042');
  });

  it('uses the MET Norway API base URL', () => {
    const url = buildMetNorwayUrl(POINT);
    expect(url).toContain('api.met.no/weatherapi/locationforecast/2.0/compact');
  });
});

describe('metNorwayHeaders', () => {
  it('returns User-Agent containing StickToThePlan', () => {
    const headers = metNorwayHeaders();
    expect(headers['User-Agent']).toContain('StickToThePlan');
  });

  it('includes the default project contact in User-Agent', () => {
    const headers = metNorwayHeaders();
    expect(headers['User-Agent']).toContain('github.com/timcv/StickToThePlan');
  });

  it('honors a custom contact override', () => {
    const headers = metNorwayHeaders('https://example.org/contact');
    expect(headers['User-Agent']).toContain('https://example.org/contact');
    expect(headers['User-Agent']).not.toContain('github.com');
  });
});
