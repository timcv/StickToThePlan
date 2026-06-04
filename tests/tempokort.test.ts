import { describe, it, expect } from 'vitest';
import type { DisplaySegment, Config } from '../src/types.js';
import type { ThreeScenarios } from '../src/planner.js';
import type { PlanResult } from '../src/types.js';
import { renderMarkdown, renderHtml } from '../src/output/tempokort.js';

// ---------------------------------------------------------------------------
// Helpers to build minimal test fixtures
// ---------------------------------------------------------------------------

function makePlanResult(total_time_s: number, np_target_used: number): PlanResult {
  return {
    np_target_used,
    total_time_s,
    rolling_time_s: total_time_s,
    stop_time_s: 0,
    segments: [],
    stops: [],
    reachable: true,
    notes: [],
  };
}

// Three scenarios: all ~11:45:00 = 42300 s by design; np values differ
const scenarios: ThreeScenarios = {
  optimistic: makePlanResult(42300, 150),
  expected: makePlanResult(42300, 160),
  pessimistic: makePlanResult(42300, 175),
};

// DisplaySegments: two normal segments + one depot
const seg1: DisplaySegment = {
  from_km: 0,
  to_km: 30,
  town: 'Start',
  distance_m: 30000,
  net_height_m: 50,
  avg_grade: 0.002,
  eta_s: 3600, // 1 hour in: 04:22 + 1h = 05:22
  wind_label: 'Mot 4 m/s',
  pull_w_low: 145,
  pull_w_high: 155,
  avg_w: 130,
  note: 'JÄMN FART',
  micro_indices: [0, 1, 2],
};

const seg2: DisplaySegment = {
  from_km: 30,
  to_km: 60,
  town: 'Motala',
  distance_m: 30000,
  net_height_m: -20,
  avg_grade: -0.001,
  eta_s: 7200, // 2 hours in: 04:22 + 2h = 06:22
  wind_label: 'Med 3 m/s',
  pull_w_low: 140,
  pull_w_high: 150,
  avg_w: 125,
  note: 'TA DET LUGNT',
  micro_indices: [3, 4, 5],
};

// Depot segment with stop_minutes and depart_s
const segDepot: DisplaySegment = {
  from_km: 60,
  to_km: 90,
  town: 'Hjo',
  distance_m: 30000,
  net_height_m: 10,
  avg_grade: 0.0004,
  eta_s: 10800, // 3 hours in: 04:22 + 3h = 07:22
  wind_label: 'Sido 5 m/s',
  pull_w_low: 148,
  pull_w_high: 158,
  avg_w: 133,
  note: 'DEPA',
  stop_minutes: 15,
  depart_s: 11700, // 3h 15m in: 04:22 + 3:15 = 07:37
  micro_indices: [6, 7, 8],
};

const displaySegments: DisplaySegment[] = [seg1, seg2, segDepot];

// Minimal Config
const cfg: Config = {
  race_date: '2026-06-13',
  start_time: '04:22',
  gpx_path: '/tmp/test.gpx',
  ftp: 272,
  n_riders: 12,
  target_total_hm: '11:45',
  stops: [],
  m: 96,
  cda_pull: 0.32,
  cda_draft: 0.21,
  crr: 0.0045,
  eta: 0.97,
  g: 9.81,
  rho_fallback: 1.2,
  pull_seconds: 45,
  pull_cap_hard: 272,
  pull_cap_soft: 250,
  climb_threshold: 0.03,
  climb_discount: true,
  watch_target: 'pull',
  k_yaw: 0.04,
  band_pct: 0.05,
  neutral_speed_kmh: 20,
  neutral_distance_km: 1,
  cache_ttl_h: 3,
  ele_smooth_window: 5,
  max_grade: 0.18,
  solo: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderMarkdown', () => {
  it('contains the race date', () => {
    const md = renderMarkdown(scenarios, displaySegments, cfg);
    expect(md).toContain('2026-06-13');
  });

  it('contains start time and target', () => {
    const md = renderMarkdown(scenarios, displaySegments, cfg);
    expect(md).toContain('04:22');
    expect(md).toContain('11:45');
  });

  it('contains the three scenario NP values', () => {
    const md = renderMarkdown(scenarios, displaySegments, cfg);
    expect(md).toContain('150');
    expect(md).toContain('160');
    expect(md).toContain('175');
  });

  it('contains a markdown table header row with required columns', () => {
    const md = renderMarkdown(scenarios, displaySegments, cfg);
    expect(md).toContain('From-to');
    expect(md).toContain('Town');
    expect(md).toContain('ETA');
    expect(md).toContain('Distance');
    expect(md).toContain('Height');
    expect(md).toContain('Gradient');
    expect(md).toContain('Wind');
    expect(md).toContain('Pull W');
    expect(md).toContain('Avg W');
    expect(md).toContain('Note');
    expect(md).toContain('Stop');
  });

  it('contains a data row with a clock ETA (HH:MM format)', () => {
    const md = renderMarkdown(scenarios, displaySegments, cfg);
    // seg1 eta_s = 3600, start 04:22 -> 05:22
    expect(md).toContain('05:22');
    // seg2 eta_s = 7200, start 04:22 -> 06:22
    expect(md).toContain('06:22');
  });

  it('contains the depot stop annotation with stop minutes and depart time', () => {
    const md = renderMarkdown(scenarios, displaySegments, cfg);
    // depot has 15 min stop, depart_s = 11700 -> 07:37
    expect(md).toContain('15 min');
    expect(md).toContain('07:37');
  });

  it('contains from-to km ranges', () => {
    const md = renderMarkdown(scenarios, displaySegments, cfg);
    expect(md).toContain('0-30');
    expect(md).toContain('30-60');
    expect(md).toContain('60-90');
  });

  it('contains town names', () => {
    const md = renderMarkdown(scenarios, displaySegments, cfg);
    expect(md).toContain('Motala');
    expect(md).toContain('Hjo');
  });

  it('contains the total time H:MM:SS for scenarios', () => {
    const md = renderMarkdown(scenarios, displaySegments, cfg);
    // 42300 s = 11h 45m 0s = 11:45:00
    expect(md).toContain('11:45:00');
  });

  it('does NOT contain an em dash (U+2014)', () => {
    const md = renderMarkdown(scenarios, displaySegments, cfg);
    expect(md).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('renderHtml', () => {
  it('starts with <!DOCTYPE html', () => {
    const html = renderHtml(scenarios, displaySegments, cfg);
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html/i);
  });

  it('contains a <table> element', () => {
    const html = renderHtml(scenarios, displaySegments, cfg);
    expect(html).toContain('<table');
  });

  it('contains the race date', () => {
    const html = renderHtml(scenarios, displaySegments, cfg);
    expect(html).toContain('2026-06-13');
  });

  it('contains the three scenario NP values', () => {
    const html = renderHtml(scenarios, displaySegments, cfg);
    expect(html).toContain('150');
    expect(html).toContain('160');
    expect(html).toContain('175');
  });

  it('contains clock ETA values', () => {
    const html = renderHtml(scenarios, displaySegments, cfg);
    expect(html).toContain('05:22');
    expect(html).toContain('06:22');
  });

  it('contains the depot stop annotation', () => {
    const html = renderHtml(scenarios, displaySegments, cfg);
    expect(html).toContain('15 min');
    expect(html).toContain('07:37');
  });

  it('contains inline CSS with A4 print styles', () => {
    const html = renderHtml(scenarios, displaySegments, cfg);
    expect(html).toContain('@page');
    expect(html).toContain('A4');
  });

  it('contains from-to km ranges', () => {
    const html = renderHtml(scenarios, displaySegments, cfg);
    expect(html).toContain('0-30');
    expect(html).toContain('30-60');
    expect(html).toContain('60-90');
  });

  it('does NOT contain an em dash (U+2014)', () => {
    const html = renderHtml(scenarios, displaySegments, cfg);
    expect(html).not.toContain(String.fromCharCode(0x2014));
  });

  it('contains the total time H:MM:SS for scenarios', () => {
    const html = renderHtml(scenarios, displaySegments, cfg);
    expect(html).toContain('11:45:00');
  });
});
