import { describe, it, expect } from 'vitest';
import { raceHours, centroidOf } from '../src/lib/hours';

describe('raceHours', () => {
  it('covers start hour through end hour inclusive', () => {
    expect(raceHours('06:00', '2:30')).toEqual([6, 7, 8]);
  });
  it('wraps past midnight', () => {
    expect(raceHours('23:00', '3:00')).toEqual([23, 0, 1, 2]);
  });
});

describe('centroidOf', () => {
  it('averages lat/lon', () => {
    expect(centroidOf([{ lat: 58, lon: 14 }, { lat: 60, lon: 16 }])).toEqual({ lat: 59, lon: 15 });
  });
});
