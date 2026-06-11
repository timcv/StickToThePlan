import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyDefaults } from '../src/config.js';
import { encodeWorkout } from '../src/output/fitWorkout.js';
import type { DisplaySegment } from '../src/types.js';

// The FIT workout encoder must be deterministic: the same plan must encode to
// the same bytes regardless of wall-clock time, so downloads are reproducible
// and golden-master tests are possible (the course encoder already uses a fixed
// BASE_MS; the workout encoder used new Date()).

const cfg = applyDefaults({
  race_date: '2026-06-13',
  start_time: '04:22',
  gpx_path: 'x',
  ftp: 272,
  n_riders: 12,
  target_total_hm: '11:45',
});

function seg(over: Partial<DisplaySegment>): DisplaySegment {
  return {
    from_km: 0,
    to_km: 10,
    distance_m: 10000,
    net_height_m: 0,
    avg_grade: 0,
    avg_speed_kmh: 30,
    eta_s: 1200,
    wind_label: 'Lugnt',
    pull_w_mean: 250,
    pull_w_low: 240,
    pull_w_high: 260,
    avg_w: 200,
    note: 'JÄMN FART',
    micro_indices: [0],
    ...over,
  };
}

const segments: DisplaySegment[] = [
  seg({ from_km: 0, to_km: 10 }),
  seg({ from_km: 10, to_km: 30, distance_m: 20000 }),
];

afterEach(() => {
  vi.useRealTimers();
});

describe('encodeWorkout determinism', () => {
  it('encodes identical bytes regardless of the wall clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T08:00:00Z'));
    const a = encodeWorkout(segments, cfg);
    vi.setSystemTime(new Date('2031-12-24T23:59:59Z'));
    const b = encodeWorkout(segments, cfg);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
