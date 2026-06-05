import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dedupePoints, smoothElevation, buildMicroSegments, applyDefaults } from '@stp/core';
import { parseGpx, ingestGpx } from '../src/fileIo.js';

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

const SYNTHETIC_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <trkseg>
      <trkpt lat="58.0000" lon="14.0000"><ele>100.0</ele></trkpt>
      <trkpt lat="58.0090" lon="14.0000"><ele>110.0</ele></trkpt>
      <trkpt lat="58.0180" lon="14.0000"><ele>105.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

// 4 points where the 3rd is a duplicate of the 2nd (zero-length step)
const SYNTHETIC_GPX_DEDUP = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <trkseg>
      <trkpt lat="58.0000" lon="14.0000"><ele>100.0</ele></trkpt>
      <trkpt lat="58.0090" lon="14.0000"><ele>110.0</ele></trkpt>
      <trkpt lat="58.0090" lon="14.0000"><ele>110.0</ele></trkpt>
      <trkpt lat="58.0180" lon="14.0000"><ele>105.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

function writeTmp(content: string): string {
  const path = join(tmpdir(), `gpx-test-${Date.now()}-${Math.random().toString(36).slice(2)}.gpx`);
  writeFileSync(path, content, 'utf8');
  return path;
}

function makeConfig() {
  return applyDefaults({
    race_date: 'x',
    start_time: '04:22',
    gpx_path: 'data/vatternrundan-315km.gpx',
    ftp: 272,
    n_riders: 12,
    target_total_hm: '11:45',
    stops: [],
  });
}

// -------------------------------------------------------------------------
// parseGpx
// -------------------------------------------------------------------------

describe('parseGpx', () => {
  it('parses a synthetic 3-point GPX and returns 3 RoutePoints', () => {
    const path = writeTmp(SYNTHETIC_GPX);
    const pts = parseGpx(path);
    expect(pts).toHaveLength(3);
    expect(pts[0].lat).toBeCloseTo(58.0, 4);
    expect(pts[0].lon).toBeCloseTo(14.0, 4);
    expect(pts[0].ele).toBeCloseTo(100.0, 1);
    expect(pts[1].ele).toBeCloseTo(110.0, 1);
    expect(pts[2].ele).toBeCloseTo(105.0, 1);
  });
});

// -------------------------------------------------------------------------
// dedupePoints
// -------------------------------------------------------------------------

describe('dedupePoints', () => {
  it('removes a zero-length duplicate from a 4-point sequence', () => {
    const path = writeTmp(SYNTHETIC_GPX_DEDUP);
    const pts = parseGpx(path);
    expect(pts).toHaveLength(4);
    const deduped = dedupePoints(pts);
    expect(deduped).toHaveLength(3);
    // First and last should survive
    expect(deduped[0].lat).toBeCloseTo(58.0, 4);
    expect(deduped[2].lat).toBeCloseTo(58.018, 3);
  });

  it('keeps all points when none are duplicates', () => {
    const path = writeTmp(SYNTHETIC_GPX);
    const pts = parseGpx(path);
    const deduped = dedupePoints(pts);
    expect(deduped).toHaveLength(3);
  });
});

// -------------------------------------------------------------------------
// smoothElevation
// -------------------------------------------------------------------------

describe('smoothElevation', () => {
  it('smooths [0,10,0,10,0] with window 3 pulling middle values toward neighbors', () => {
    const input = [0, 10, 0, 10, 0];
    const smoothed = smoothElevation(input, 3);
    expect(smoothed).toHaveLength(5);
    // Endpoints stay unchanged (clamped window)
    expect(smoothed[0]).toBeCloseTo(0, 5);
    expect(smoothed[4]).toBeCloseTo(0, 5);
    // Middle values are averages of their 3-point windows
    // smoothed[1] = (0+10+0)/3 = 10/3 ≈ 3.33
    expect(smoothed[1]).toBeCloseTo(10 / 3, 4);
    // smoothed[2] = (10+0+10)/3 = 20/3 ≈ 6.67
    expect(smoothed[2]).toBeCloseTo(20 / 3, 4);
    // smoothed[3] = (0+10+0)/3 ≈ 3.33
    expect(smoothed[3]).toBeCloseTo(10 / 3, 4);
  });

  it('returns array of same length as input', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7];
    expect(smoothElevation(arr, 3)).toHaveLength(7);
    expect(smoothElevation(arr, 5)).toHaveLength(7);
  });

  it('returns a copy when window is 1', () => {
    const arr = [1, 2, 3];
    const result = smoothElevation(arr, 1);
    expect(result).toEqual([1, 2, 3]);
  });
});

// -------------------------------------------------------------------------
// buildMicroSegments
// -------------------------------------------------------------------------

describe('buildMicroSegments', () => {
  it('returns 2 microsegments for 3 synthetic points', () => {
    const path = writeTmp(SYNTHETIC_GPX);
    const pts = parseGpx(path);
    const deduped = dedupePoints(pts);
    const cfg = makeConfig();
    const smoothed = smoothElevation(
      deduped.map((p) => p.ele),
      cfg.ele_smooth_window,
    );
    const segs = buildMicroSegments(deduped, smoothed, cfg);
    expect(segs).toHaveLength(2);
  });

  it('microsegments have plausible distances (~1 km apart)', () => {
    const path = writeTmp(SYNTHETIC_GPX);
    const pts = parseGpx(path);
    const deduped = dedupePoints(pts);
    const cfg = makeConfig();
    const smoothed = smoothElevation(
      deduped.map((p) => p.ele),
      cfg.ele_smooth_window,
    );
    const segs = buildMicroSegments(deduped, smoothed, cfg);
    // Each segment should be roughly 1 km (0.009 degrees latitude ~ 1 km)
    for (const seg of segs) {
      expect(seg.distance_m).toBeGreaterThan(500);
      expect(seg.distance_m).toBeLessThan(2000);
    }
  });

  it('cumulative distance accumulates correctly', () => {
    const path = writeTmp(SYNTHETIC_GPX);
    const pts = parseGpx(path);
    const deduped = dedupePoints(pts);
    const cfg = makeConfig();
    const smoothed = smoothElevation(
      deduped.map((p) => p.ele),
      cfg.ele_smooth_window,
    );
    const segs = buildMicroSegments(deduped, smoothed, cfg);
    // cum_distance at end of seg[0] equals seg[0].distance_m
    expect(segs[0].cum_distance_m).toBeCloseTo(segs[0].distance_m, 3);
    // cum_distance at end of seg[1] = seg[0].distance + seg[1].distance
    expect(segs[1].cum_distance_m).toBeCloseTo(segs[0].distance_m + segs[1].distance_m, 3);
  });

  it('grade is clamped within [-max_grade, max_grade]', () => {
    const path = writeTmp(SYNTHETIC_GPX);
    const pts = parseGpx(path);
    const deduped = dedupePoints(pts);
    const cfg = makeConfig();
    const smoothed = smoothElevation(
      deduped.map((p) => p.ele),
      cfg.ele_smooth_window,
    );
    const segs = buildMicroSegments(deduped, smoothed, cfg);
    for (const seg of segs) {
      expect(seg.grade).toBeGreaterThanOrEqual(-cfg.max_grade);
      expect(seg.grade).toBeLessThanOrEqual(cfg.max_grade);
    }
  });

  it('bearing is in [0, 360)', () => {
    const path = writeTmp(SYNTHETIC_GPX);
    const pts = parseGpx(path);
    const deduped = dedupePoints(pts);
    const cfg = makeConfig();
    const smoothed = smoothElevation(
      deduped.map((p) => p.ele),
      cfg.ele_smooth_window,
    );
    const segs = buildMicroSegments(deduped, smoothed, cfg);
    for (const seg of segs) {
      expect(seg.bearing_deg).toBeGreaterThanOrEqual(0);
      expect(seg.bearing_deg).toBeLessThan(360);
    }
  });

  it('neutral flag is true when cum_distance_m at START < neutral_distance_km*1000', () => {
    const path = writeTmp(SYNTHETIC_GPX);
    const pts = parseGpx(path);
    const deduped = dedupePoints(pts);
    // Use a cfg where neutral_distance_km is larger than the synthetic route
    const cfg = { ...makeConfig(), neutral_distance_km: 10 };
    const smoothed = smoothElevation(
      deduped.map((p) => p.ele),
      cfg.ele_smooth_window,
    );
    const segs = buildMicroSegments(deduped, smoothed, cfg);
    for (const seg of segs) {
      expect(seg.neutral).toBe(true);
    }
  });

  it('neutral flag is false after neutral zone ends', () => {
    const path = writeTmp(SYNTHETIC_GPX);
    const pts = parseGpx(path);
    const deduped = dedupePoints(pts);
    // neutral_distance_km = 0 so nothing is neutral
    const cfg = { ...makeConfig(), neutral_distance_km: 0 };
    const smoothed = smoothElevation(
      deduped.map((p) => p.ele),
      cfg.ele_smooth_window,
    );
    const segs = buildMicroSegments(deduped, smoothed, cfg);
    for (const seg of segs) {
      expect(seg.neutral).toBe(false);
    }
  });

  it('index is sequential from 0', () => {
    const path = writeTmp(SYNTHETIC_GPX);
    const pts = parseGpx(path);
    const deduped = dedupePoints(pts);
    const cfg = makeConfig();
    const smoothed = smoothElevation(
      deduped.map((p) => p.ele),
      cfg.ele_smooth_window,
    );
    const segs = buildMicroSegments(deduped, smoothed, cfg);
    segs.forEach((seg, i) => expect(seg.index).toBe(i));
  });
});

// -------------------------------------------------------------------------
// ingestGpx
// -------------------------------------------------------------------------

describe('ingestGpx', () => {
  it('ties parse->dedup->smooth->build into a full pipeline for synthetic data', () => {
    const path = writeTmp(SYNTHETIC_GPX);
    const cfg = makeConfig();
    const segs = ingestGpx(path, cfg);
    expect(segs).toHaveLength(2);
    segs.forEach((seg, i) => {
      expect(seg.index).toBe(i);
      expect(Number.isFinite(seg.grade)).toBe(true);
      expect(Number.isFinite(seg.bearing_deg)).toBe(true);
    });
  });
});

// -------------------------------------------------------------------------
// REAL FILE TESTS
// -------------------------------------------------------------------------

describe('real file: vatternrundan-315km.gpx', () => {
  const GPX_PATH = 'data/vatternrundan-315km.gpx';

  it.skipIf(!existsSync(GPX_PATH))('parseGpx returns 4820 points', () => {
    const pts = parseGpx(GPX_PATH);
    expect(pts).toHaveLength(4820);
  });

  it.skipIf(!existsSync(GPX_PATH))('dedup removes 55 points (4820 -> 4765)', () => {
    const pts = parseGpx(GPX_PATH);
    const deduped = dedupePoints(pts);
    expect(pts).toHaveLength(4820);
    expect(deduped).toHaveLength(4765);
  });

  it.skipIf(!existsSync(GPX_PATH))('ingestGpx total distance is within [314.0, 315.5] km', () => {
    const cfg = makeConfig();
    const segs = ingestGpx(GPX_PATH, cfg);
    const totalKm = segs.reduce((acc, s) => acc + s.distance_m, 0) / 1000;
    expect(totalKm).toBeGreaterThan(314.0);
    expect(totalKm).toBeLessThan(315.5);
  });

  it.skipIf(!existsSync(GPX_PATH))(
    'every microsegment has finite grade within [-max_grade, max_grade] and bearing in [0, 360)',
    () => {
      const cfg = makeConfig();
      const segs = ingestGpx(GPX_PATH, cfg);
      for (const seg of segs) {
        expect(Number.isFinite(seg.grade)).toBe(true);
        expect(seg.grade).toBeGreaterThanOrEqual(-cfg.max_grade);
        expect(seg.grade).toBeLessThanOrEqual(cfg.max_grade);
        expect(Number.isFinite(seg.bearing_deg)).toBe(true);
        expect(seg.bearing_deg).toBeGreaterThanOrEqual(0);
        expect(seg.bearing_deg).toBeLessThan(360);
      }
    },
  );
});
