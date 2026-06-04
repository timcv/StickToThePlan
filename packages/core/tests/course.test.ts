/**
 * Tests for src/output/course.ts
 * Spec reference: design doc section 12.3
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import type { MicroSegment, PlanResult, Config, SegmentPlan } from '../src/types.js';
import type { ControlPoint } from '../src/segmentation.js';
import { applyDefaults } from '../src/config.js';
import { buildCourseGpx } from '../src/output/course.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMicro(index: number, cumDist: number, lat: number, lon: number, ele: number): MicroSegment {
  return {
    index,
    distance_m: index === 0 ? cumDist : 1000,
    cum_distance_m: cumDist,
    grade: 0,
    bearing_deg: 0,
    lat,
    lon,
    ele_start_m: ele,
    ele_end_m: ele,
    neutral: false,
  };
}

function makeSegmentPlan(micro: MicroSegment, eta_s: number): SegmentPlan {
  return {
    micro,
    v_ms: 8,
    speed_kmh: 28.8,
    p_pull_w: 160,
    p_draft_w: 110,
    p_mean_w: 130,
    rider_np_w: 160,
    time_s: 120,
    eta_s,
    headwind_ms: 0,
    crosswind_ms: 0,
    rho: 1.2,
    cap_binding: 'none',
  };
}

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

// 5 microsegments at 0,1000,2000,3000,4000 m
const microsegments: MicroSegment[] = [
  makeMicro(0, 1000, 58.5327, 15.0444, 82.0),
  makeMicro(1, 2000, 58.5200, 15.0600, 85.5),
  makeMicro(2, 3000, 58.5100, 15.0750, 88.0),
  makeMicro(3, 4000, 58.5000, 15.0900, 90.0),
  makeMicro(4, 5000, 58.4900, 15.1050, 87.0),
];

// Matching SegmentPlan entries with increasing eta_s
const segmentPlans: SegmentPlan[] = [
  makeSegmentPlan(microsegments[0], 120),
  makeSegmentPlan(microsegments[1], 360),  // at 2 km = control 'Granna' (km:2)
  makeSegmentPlan(microsegments[2], 600),
  makeSegmentPlan(microsegments[3], 840),
  makeSegmentPlan(microsegments[4], 1080),
];

const plan: PlanResult = {
  np_target_used: 163,
  total_time_s: 1080,
  rolling_time_s: 1080,
  stop_time_s: 0,
  segments: segmentPlans,
  stops: [],
  reachable: true,
  notes: [],
};

// Controls: 'Start' at km 0, 'Gränna' at km 2 (matches cumDist 2000 m)
const controls: ControlPoint[] = [
  { name: 'Start', km: 0 },
  { name: 'Gränna', km: 2 },
];

// Config: start 04:22, stop at Gränna (km 2) for 10 min
const cfg: Config = applyDefaults({
  race_date: '2026-06-13',
  start_time: '04:22',
  gpx_path: 'data/dummy.gpx',
  ftp: 272,
  n_riders: 12,
  target_total_hm: '0:18',
  stops: [{ control: 'Gränna', km: 2, minutes: 10 }],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildCourseGpx (synthetic)', () => {
  const gpx = buildCourseGpx(microsegments, plan, cfg, controls);

  it('starts with XML declaration', () => {
    expect(gpx).toContain('<?xml');
  });

  it('contains GPX 1.1 header with correct attributes', () => {
    expect(gpx).toContain('version="1.1"');
    expect(gpx).toContain('creator="StickToThePlan"');
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
  });

  it('contains a trkseg with 5 trkpt elements', () => {
    expect(gpx).toContain('<trkseg>');
    const trkptMatches = gpx.match(/<trkpt /g) ?? [];
    expect(trkptMatches).toHaveLength(5);
  });

  it('contains exactly 2 wpt elements', () => {
    const wptMatches = gpx.match(/<wpt /g) ?? [];
    expect(wptMatches).toHaveLength(2);
  });

  it('wpt elements appear before trk element (GPX convention)', () => {
    const wptPos = gpx.indexOf('<wpt ');
    const trkPos = gpx.indexOf('<trk>');
    expect(wptPos).toBeGreaterThanOrEqual(0);
    expect(trkPos).toBeGreaterThanOrEqual(0);
    expect(wptPos).toBeLessThan(trkPos);
  });

  it('waypoint name contains a HH:MM clock pattern', () => {
    // At least one <name> inside a wpt block should match HH:MM
    const clockPattern = /\d{2}:\d{2}/;
    // Extract wpt section
    const wptSection = gpx.match(/<wpt[\s\S]*?<\/wpt>/g) ?? [];
    const allNames = wptSection.map(w => {
      const m = w.match(/<name>([\s\S]*?)<\/name>/);
      return m ? m[1] : '';
    });
    expect(allNames.some(n => clockPattern.test(n))).toBe(true);
  });

  it('Gränna depot waypoint name contains stop duration annotation', () => {
    const granna = gpx.match(/<wpt[\s\S]*?<\/wpt>/g)?.find(w => w.includes('nn'));
    expect(granna).toBeDefined();
    expect(granna).toContain('(10 min)');
  });

  it('preserves Swedish diacritic: Gränna appears with ä intact', () => {
    expect(gpx).toContain('Gränna');
  });

  it('parses correctly with fast-xml-parser and yields 2 waypoints', () => {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (tagName) => ['wpt', 'trkpt'].includes(tagName),
    });
    let parsed: Record<string, unknown>;
    expect(() => {
      parsed = parser.parse(gpx) as Record<string, unknown>;
    }).not.toThrow();

    // Access waypoints
    const gpxDoc = parsed!['gpx'] as Record<string, unknown>;
    const wptArray = gpxDoc['wpt'] as unknown[];
    expect(Array.isArray(wptArray)).toBe(true);
    expect(wptArray).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Real-GPX optional block (skipped if course file absent)
// ---------------------------------------------------------------------------

describe.skipIf(!existsSync('data/vatternrundan-315km.gpx'))(
  'buildCourseGpx (real course, light smoke test)',
  () => {
    it('smoke: builds GPX without throwing for real data', async () => {
      // Dynamic import to avoid parsing the GPX unless the file exists
      const { ingestGpxString } = await import('../src/ingest/gpx.js');
      const { readFileSync } = await import('node:fs');
      const { applyDefaults: ad } = await import('../src/config.js');
      const realCfg = ad({
        race_date: '2026-06-13',
        start_time: '04:22',
        gpx_path: 'data/vatternrundan-315km.gpx',
        ftp: 272,
        n_riders: 12,
        target_total_hm: '11:45',
        stops: [],
      });
      const micros = ingestGpxString(readFileSync('data/vatternrundan-315km.gpx', 'utf8'), realCfg);

      // Build a minimal plan with one segment per micro (eta_s = index * 10)
      const segs: SegmentPlan[] = micros.map((m, i) => makeSegmentPlan(m, (i + 1) * 10));
      const realPlan: PlanResult = {
        np_target_used: 163,
        total_time_s: segs[segs.length - 1]?.eta_s ?? 0,
        rolling_time_s: segs[segs.length - 1]?.eta_s ?? 0,
        stop_time_s: 0,
        segments: segs,
        stops: [],
        reachable: true,
        notes: [],
      };

      const { VATTERN_CONTROLS } = await import('../src/segmentation.js');
      const gpxStr = buildCourseGpx(micros, realPlan, realCfg, VATTERN_CONTROLS);
      expect(gpxStr).toContain('<?xml');
      expect(gpxStr).toContain('<trkseg>');
    });
  },
);
