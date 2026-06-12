import { describe, it, expect } from 'vitest';
import { utcStartClockSeconds, raceStartEpochMs } from '../src/util/time.js';

describe('raceStartEpochMs', () => {
  it('returns the absolute UTC instant of a CEST summer start', () => {
    // 06:00 Europe/Stockholm in June = 04:00 UTC same day.
    expect(raceStartEpochMs('2026-06-13', '06:00', 'Europe/Stockholm')).toBe(
      Date.UTC(2026, 5, 13, 4, 0, 0),
    );
  });

  it('crosses to the previous UTC day for an after-midnight local start', () => {
    // 00:30 Stockholm = 22:30 UTC the previous day.
    expect(raceStartEpochMs('2026-06-13', '00:30', 'Europe/Stockholm')).toBe(
      Date.UTC(2026, 5, 12, 22, 30, 0),
    );
  });

  it('throws on malformed input', () => {
    expect(() => raceStartEpochMs('not-a-date', '06:00', 'Europe/Stockholm')).toThrow();
  });
});

describe('utcStartClockSeconds', () => {
  it('converts a CEST summer start to UTC (06:00 Stockholm -> 04:00 UTC)', () => {
    expect(utcStartClockSeconds('2026-06-13', '06:00', 'Europe/Stockholm')).toBe(4 * 3600);
  });

  it('converts a CET winter start to UTC (06:00 Stockholm -> 05:00 UTC)', () => {
    expect(utcStartClockSeconds('2026-01-13', '06:00', 'Europe/Stockholm')).toBe(5 * 3600);
  });

  it('is identity for UTC', () => {
    expect(utcStartClockSeconds('2026-06-13', '04:22', 'UTC')).toBe(4 * 3600 + 22 * 60);
  });

  it('wraps past midnight (00:30 CEST -> 22:30 UTC previous day)', () => {
    expect(utcStartClockSeconds('2026-06-13', '00:30', 'Europe/Stockholm')).toBe(
      22 * 3600 + 30 * 60,
    );
  });

  it('handles west-of-Greenwich zones (06:00 New York -> 10:00 UTC in June)', () => {
    expect(utcStartClockSeconds('2026-06-13', '06:00', 'America/New_York')).toBe(10 * 3600);
  });

  it('throws on malformed input', () => {
    expect(() => utcStartClockSeconds('not-a-date', '06:00', 'Europe/Stockholm')).toThrow();
  });
});
