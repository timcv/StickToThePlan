import { describe, it, expect } from 'vitest';
import { sampleCellPoints } from '../src/weather/sample.js';
import type { MicroSegment } from '../src/types.js';

function seg(lat: number, lon: number): MicroSegment {
  return {
    index: 0, distance_m: 100, cum_distance_m: 100, grade: 0, bearing_deg: 0,
    lat, lon, ele_start_m: 0, ele_end_m: 0, neutral: false,
  };
}

describe('sampleCellPoints', () => {
  it('returns [] for empty input', () => {
    expect(sampleCellPoints([])).toEqual([]);
  });

  it('dedupes consecutive points within the same 0.1deg cell', () => {
    const micro = [seg(58.51, 14.61), seg(58.52, 14.62), seg(58.59, 14.69)];
    // first two round to (58.5,14.6); third to (58.6,14.7)
    const pts = sampleCellPoints(micro);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ lat: 58.51, lon: 14.61 });
    expect(pts[1]).toEqual({ lat: 58.59, lon: 14.69 });
  });

  it('preserves first-appearance order and re-emits a revisited bin only once', () => {
    const micro = [seg(58.51, 14.61), seg(58.59, 14.69), seg(58.52, 14.63)];
    const pts = sampleCellPoints(micro); // bin A, bin B, bin A again -> A,B
    expect(pts).toHaveLength(2);
    expect(pts[0].lat).toBe(58.51);
    expect(pts[1].lat).toBe(58.59);
  });
});
