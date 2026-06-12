import { describe, it, expect } from 'vitest';
import { parseGpxString, fillElevationGaps, ingestGpxString } from '../src/ingest/gpx.js';
import { applyDefaults } from '../src/config.js';

const pt = (lat: number, ele = 100) => `<trkpt lat="${lat}" lon="15.0"><ele>${ele}</ele></trkpt>`;

const cfg = applyDefaults({
  gpx_path: 'x.gpx',
  race_date: '2026-06-13',
  start_time: '04:22',
  ftp: 272,
  n_riders: 12,
  target_total_hm: '11:45',
  stops: [],
  neutral_distance_km: 0,
});

describe('parseGpxString multi-track handling', () => {
  it('concatenates points across multiple trkseg', () => {
    const xml = `<?xml version="1.0"?><gpx><trk>
      <trkseg>${pt(58.5)}${pt(58.51)}</trkseg>
      <trkseg>${pt(58.52)}${pt(58.53)}</trkseg>
    </trk></gpx>`;
    const pts = parseGpxString(xml);
    expect(pts).toHaveLength(4);
    expect(pts.map((p) => p.lat)).toEqual([58.5, 58.51, 58.52, 58.53]);
  });

  it('concatenates points across multiple trk', () => {
    const xml = `<?xml version="1.0"?><gpx>
      <trk><trkseg>${pt(58.5)}${pt(58.51)}</trkseg></trk>
      <trk><trkseg>${pt(58.52)}</trkseg></trk>
    </gpx>`;
    expect(parseGpxString(xml)).toHaveLength(3);
  });

  it('keeps document order across multiple trk', () => {
    const xml = `<?xml version="1.0"?><gpx>
      <trk><trkseg>${pt(58.5)}${pt(58.51)}</trkseg></trk>
      <trk><trkseg>${pt(58.52)}</trkseg></trk>
    </gpx>`;
    expect(parseGpxString(xml).map((p) => p.lat)).toEqual([58.5, 58.51, 58.52]);
  });

  it('ignores empty trkseg', () => {
    const xml = `<?xml version="1.0"?><gpx><trk>
      <trkseg>${pt(58.5)}</trkseg><trkseg></trkseg><trkseg>${pt(58.51)}</trkseg>
    </trk></gpx>`;
    expect(parseGpxString(xml)).toHaveLength(2);
  });

  it('still parses single trk / single trkseg / single trkpt', () => {
    const xml = `<?xml version="1.0"?><gpx><trk><trkseg>${pt(58.5)}</trkseg></trk></gpx>`;
    const pts = parseGpxString(xml);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toEqual({ lat: 58.5, lon: 15.0, ele: 100 });
  });
});

describe('fillElevationGaps', () => {
  it('interpolates interior gaps linearly', () => {
    expect(fillElevationGaps([100, NaN, NaN, 130])).toEqual([100, 110, 120, 130]);
  });

  it('clamps leading and trailing gaps to nearest finite value', () => {
    expect(fillElevationGaps([NaN, 100, NaN])).toEqual([100, 100, 100]);
  });

  it('throws when no point has finite elevation', () => {
    expect(() => fillElevationGaps([NaN, NaN])).toThrow(/elevation/i);
  });
});

describe('ingestGpxString elevation robustness', () => {
  const bareTrkpt = (lat: number) => `<trkpt lat="${lat}" lon="15.0"></trkpt>`;

  it('throws a descriptive error for a GPX entirely without <ele>', () => {
    const xml = `<?xml version="1.0"?><gpx><trk><trkseg>${bareTrkpt(58.5)}${bareTrkpt(58.51)}</trkseg></trk></gpx>`;
    expect(() => ingestGpxString(xml, cfg)).toThrow(/elevation/i);
  });

  it('produces only finite grades when some points lack <ele>', () => {
    const xml = `<?xml version="1.0"?><gpx><trk><trkseg>
      <trkpt lat="58.5" lon="15.0"><ele>100</ele></trkpt>
      ${bareTrkpt(58.51)}
      <trkpt lat="58.52" lon="15.0"><ele>120</ele></trkpt>
    </trkseg></trk></gpx>`;
    const micros = ingestGpxString(xml, cfg);
    expect(micros.length).toBeGreaterThan(0);
    for (const m of micros) {
      expect(Number.isFinite(m.grade)).toBe(true);
    }
  });
});
