import { describe, it, expect } from 'vitest';
import { hmToSeconds, clockToSeconds, secondsToClock } from '../src/util/time.js';

describe('hmToSeconds', () => {
  it('converts "11:45" to 42300', () => {
    expect(hmToSeconds('11:45')).toBe(11 * 3600 + 45 * 60);
  });

  it('converts "0:50" to 3000', () => {
    expect(hmToSeconds('0:50')).toBe(50 * 60);
  });

  it('converts "1:00" to 3600', () => {
    expect(hmToSeconds('1:00')).toBe(3600);
  });

  it('converts "10:55" to correct seconds', () => {
    expect(hmToSeconds('10:55')).toBe(10 * 3600 + 55 * 60);
  });
});

describe('clockToSeconds', () => {
  it('converts "04:22" to 15720', () => {
    expect(clockToSeconds('04:22')).toBe(4 * 3600 + 22 * 60);
  });

  it('converts "00:00" to 0', () => {
    expect(clockToSeconds('00:00')).toBe(0);
  });

  it('converts "23:59" to 86340', () => {
    expect(clockToSeconds('23:59')).toBe(23 * 3600 + 59 * 60);
  });
});

describe('secondsToClock', () => {
  it('zero offset returns the start time', () => {
    expect(secondsToClock(0, '04:22')).toBe('04:22');
  });

  it('secondsToClock(42300, "04:22") returns "16:07"', () => {
    // 04:22 = 15720 s, + 42300 = 58020 s = 16*3600 + 7*60 = 57600 + 420 = 58020
    expect(secondsToClock(42300, '04:22')).toBe('16:07');
  });

  it('wraps past midnight correctly', () => {
    // 23:00 = 82800 s, + 7200 (2h) = 90000 mod 86400 = 3600 = 01:00
    expect(secondsToClock(7200, '23:00')).toBe('01:00');
  });

  it('formats single-digit minutes with leading zero', () => {
    // 04:22 + 3*60 = 04:25
    expect(secondsToClock(3 * 60, '04:22')).toBe('04:25');
  });
});
