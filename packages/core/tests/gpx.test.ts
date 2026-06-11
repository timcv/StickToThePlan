import { describe, it, expect } from 'vitest';
import { parseGpxString } from '../src/ingest/gpx.js';

const pt = (lat: number, ele = 100) => `<trkpt lat="${lat}" lon="15.0"><ele>${ele}</ele></trkpt>`;

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

  it('still parses single trk / single trkseg / single trkpt', () => {
    const xml = `<?xml version="1.0"?><gpx><trk><trkseg>${pt(58.5)}</trkseg></trk></gpx>`;
    const pts = parseGpxString(xml);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toEqual({ lat: 58.5, lon: 15.0, ele: 100 });
  });
});
