/**
 * Tests for src/output/planJson.ts
 * Spec reference: design doc section 12.4 (machine-readable plan JSON).
 *
 * Fast, no network, no filesystem (buildPlanJson is pure; writePlanJson is
 * exercised against a temp dir).
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  MicroSegment,
  PlanResult,
  SegmentPlan,
  Config,
  FitPassMetrics,
  DisplaySegment,
  StopPlan,
  ThreeScenarios,
} from '@stp/core';
import { applyDefaults, buildPlanJson } from '@stp/core';
import { writePlanJson } from '../src/fileIo.js';

// ---------------------------------------------------------------------------
// Hand-built fixtures
// ---------------------------------------------------------------------------

function makeMicro(index: number, cumDist: number): MicroSegment {
  return {
    index,
    distance_m: 1000,
    cum_distance_m: cumDist,
    grade: index === 1 ? 0.04 : 0.0,
    bearing_deg: 90,
    lat: 58.5 - index * 0.01,
    lon: 15.0 + index * 0.01,
    ele_start_m: 80 + index,
    ele_end_m: 80 + index + (index === 1 ? 40 : 0),
    neutral: index === 0,
  };
}

function makeSegmentPlan(micro: MicroSegment, eta_s: number): SegmentPlan {
  return {
    micro,
    v_ms: 8,
    speed_kmh: 28.8,
    p_pull_w: 200,
    p_draft_w: 140,
    p_mean_w: 165,
    rider_np_w: 165,
    time_s: 125,
    eta_s,
    headwind_ms: 2.5,
    crosswind_ms: 1.0,
    rho: 1.2,
    cap_binding: 'none',
    raw_windspeed_ms: 0,
    eff_windspeed_ms: 0,
    z0_used: 0,
  };
}

const micros: MicroSegment[] = [makeMicro(0, 1000), makeMicro(1, 2000), makeMicro(2, 3000)];

const segs: SegmentPlan[] = [
  makeSegmentPlan(micros[0], 180),
  makeSegmentPlan(micros[1], 360),
  makeSegmentPlan(micros[2], 540),
];

const stops: StopPlan[] = [{ control: 'Granna', km: 2, minutes: 10, arrive_s: 360, depart_s: 960 }];

function makePlan(np: number, totalS: number, reachable: boolean): PlanResult {
  return {
    np_target_used: np,
    rider_np_ride_w: np,
    intensity_factor: np / 272,
    total_time_s: totalS,
    rolling_time_s: totalS - 600,
    stop_time_s: 600,
    segments: segs,
    stops,
    reachable,
    notes: reachable ? [] : ['target not reachable'],
  };
}

const scenarios: ThreeScenarios = {
  expected: makePlan(165, 1140, true),
  optimistic: makePlan(150, 1140, true),
  pessimistic: makePlan(182, 1140, true),
  time_uncertainty_s: { expected: 1140, low: 1080, high: 1200, source: 'scenario' },
};

const displaySegments: DisplaySegment[] = [
  {
    from_km: 0,
    to_km: 3,
    town: 'Granna',
    distance_m: 3000,
    net_height_m: 40,
    avg_grade: 0.013,
    eta_s: 540,
    wind_label: 'Mot 3 m/s',
    pull_w_mean: 200,
    pull_w_low: 190,
    pull_w_high: 210,
    avg_w: 165,
    note: 'JÄMN FART',
    stop_minutes: 10,
    depart_s: 1140,
    avg_speed_kmh: 0,
    micro_indices: [0, 1, 2],
  },
];

const anchor: FitPassMetrics = {
  duration_s: 0,
  mean_power_w: 0,
  np_w: 0,
  sample_count: 0,
  classification: 'short_test',
  np_target_candidate: 163,
  note: 'No FIT provided, np_target = 0.60 x ftp fallback (spec 5.2).',
};

const cfg: Config = applyDefaults({
  race_date: '2026-06-13',
  start_time: '04:22',
  gpx_path: 'data/dummy.gpx',
  ftp: 272,
  n_riders: 12,
  target_total_hm: '0:19',
  stops: [{ control: 'Granna', km: 2, minutes: 10 }],
});

const meta = {
  reducedEnsemble: false,
  weatherSources: ['open-meteo-forecast', 'smhi', 'met-norway'],
  notes: ['all good'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPlanJson', () => {
  const obj = buildPlanJson(scenarios, displaySegments, anchor, cfg, meta) as Record<
    string,
    unknown
  >;

  it('has the documented top-level keys', () => {
    for (const key of [
      'config',
      'anchor',
      'scenarios',
      'time_uncertainty_s',
      'assumptions',
      'segments',
      'stops',
      'displaySegments',
      'meta',
    ]) {
      expect(obj).toHaveProperty(key);
    }
  });

  it('embeds the resolved config and the anchor', () => {
    expect(obj.config).toEqual(cfg);
    expect(obj.anchor).toEqual(anchor);
  });

  it('scenarios has the three entries each with a summary shape', () => {
    const s = obj.scenarios as Record<string, Record<string, unknown>>;
    for (const name of ['expected', 'optimistic', 'pessimistic']) {
      expect(s).toHaveProperty(name);
      const e = s[name];
      expect(e).toHaveProperty('np_target_used');
      expect(e).toHaveProperty('total_time_s');
      expect(e).toHaveProperty('rolling_time_s');
      expect(e).toHaveProperty('stop_time_s');
      expect(e).toHaveProperty('reachable');
      expect(e).toHaveProperty('notes');
    }
  });

  it('has time_uncertainty_s with the correct shape', () => {
    const u = obj.time_uncertainty_s as Record<string, unknown>;
    expect(u).toHaveProperty('expected', 1140);
    expect(u).toHaveProperty('low', 1080);
    expect(u).toHaveProperty('high', 1200);
    expect(u).toHaveProperty('source', 'scenario');
  });

  it('has an assumptions block with wind correction fields', () => {
    const a = obj.assumptions as Record<string, unknown>;
    expect(a).toHaveProperty('rider_wind_height_m');
    expect(a).toHaveProperty('forecast_wind_height_m');
    expect(a).toHaveProperty('exposure_terrain');
    expect(a).toHaveProperty('apply_wind_height_correction');
    expect(a).toHaveProperty('aero', 'vector');
  });

  it('the expected scenario summary uses the expected plan values', () => {
    const s = obj.scenarios as Record<string, Record<string, unknown>>;
    expect(s.expected.np_target_used).toBe(165);
    expect(s.expected.total_time_s).toBe(1140);
    expect(s.optimistic.np_target_used).toBe(150);
    expect(s.pessimistic.np_target_used).toBe(182);
  });

  it('segments is the expected scenario full per-segment array with the documented fields', () => {
    const segArr = obj.segments as Array<Record<string, unknown>>;
    expect(Array.isArray(segArr)).toBe(true);
    expect(segArr).toHaveLength(3);
    const first = segArr[0];
    for (const f of [
      'index',
      'cum_distance_m',
      'distance_m',
      'grade',
      'bearing',
      'v_ms',
      'speed_kmh',
      'p_pull_w',
      'p_draft_w',
      'p_mean_w',
      'rider_np_w',
      'headwind_ms',
      'crosswind_ms',
      'rho',
      'eta_s',
      'cap_binding',
    ]) {
      expect(first).toHaveProperty(f);
    }
    // index/grade/bearing pulled from the micro
    expect(first.index).toBe(0);
    expect(segArr[1].grade).toBe(0.04);
    expect(first.bearing).toBe(90);
  });

  it('carries the stops, displaySegments and meta through unchanged', () => {
    expect(obj.stops).toEqual(stops);
    expect(obj.displaySegments).toEqual(displaySegments);
    expect(obj.meta).toEqual(meta);
  });

  it('round-trips through JSON.stringify / JSON.parse', () => {
    const text = JSON.stringify(obj, null, 2);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toEqual(obj);
    expect(parsed.scenarios).toBeDefined();
  });
});

describe('writePlanJson', () => {
  it('writes a pretty-printed JSON file that parses back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'planjson-'));
    try {
      const out = join(dir, 'plan.json');
      writePlanJson(scenarios, displaySegments, anchor, cfg, meta, out);
      const text = readFileSync(out, 'utf-8');
      // Pretty printed -> contains newlines and two-space indent.
      expect(text).toContain('\n  ');
      const parsed = JSON.parse(text) as Record<string, unknown>;
      expect(parsed).toHaveProperty('scenarios');
      expect(parsed).toHaveProperty('segments');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
