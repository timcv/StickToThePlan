// Tests for FIT ingest and anchor determination (Task 6).
// Spec sections 8, 8.1, 18.2.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { analyzePass, applyDefaults, type Config } from '@stp/core';
import { determineAnchor, readFitPower } from '../src/fileIo.js';

// Minimal config used for synthetic tests.
function makeConfig(overrides: Partial<Config> = {}): Config {
  return applyDefaults({
    race_date: '2026-06-13',
    start_time: '04:22',
    gpx_path: 'data/vatternrundan-315km.gpx',
    ftp: 272,
    n_riders: 12,
    target_total_hm: '11:45',
    stops: [],
    ...overrides,
  });
}

describe('analyzePass - synthetic', () => {
  it('classifies a 3600-sample stream as short_test and near-200 W', () => {
    const cfg = makeConfig();
    const stream = Array<number>(3600).fill(200);
    const metrics = analyzePass(stream, cfg);

    expect(metrics.sample_count).toBe(3600);
    expect(metrics.duration_s).toBe(3600);
    expect(Math.abs(metrics.mean_power_w - 200)).toBeLessThan(1);
    expect(Math.abs(metrics.np_w - 200)).toBeLessThan(1);
    expect(metrics.classification).toBe('short_test');
    // FTP-fallback path: 0.60 * 272 = 163
    expect(metrics.np_target_candidate).toBe(Math.round(0.60 * 272));
    expect(metrics.np_target_candidate).toBe(163);
  });

  it('classifies an 8000-sample stream as long_representative', () => {
    const cfg = makeConfig();
    // 8000 seconds > 7200 (2h) -- should be long_representative
    const stream = Array<number>(8000).fill(200);
    const metrics = analyzePass(stream, cfg);

    expect(metrics.duration_s).toBe(8000);
    expect(metrics.classification).toBe('long_representative');
    // For long pass, np_target_candidate is rounded np_w
    expect(Math.abs(metrics.np_w - 200)).toBeLessThan(1);
    expect(metrics.np_target_candidate).toBe(Math.round(metrics.np_w));
    // Note references the long path
    expect(metrics.note).toMatch(/long representative/i);
    expect(metrics.note).toMatch(/spec 8\.1/i);
  });

  it('produces correct mean and NP for a uniform stream', () => {
    const cfg = makeConfig();
    const stream = Array<number>(3601).fill(300);
    // Constant power: NP == mean == 300
    const metrics = analyzePass(stream, cfg);
    expect(Math.abs(metrics.mean_power_w - 300)).toBeLessThan(1);
    expect(Math.abs(metrics.np_w - 300)).toBeLessThan(1);
  });
});

describe('determineAnchor - no FIT path', () => {
  it('returns short_test fallback when fit_path is undefined', () => {
    const cfg = makeConfig({ fit_path: undefined });
    const anchor = determineAnchor(cfg);

    expect(anchor.classification).toBe('short_test');
    expect(anchor.np_target_candidate).toBe(Math.round(0.60 * 272));
    expect(anchor.np_target_candidate).toBe(163);
    expect(anchor.duration_s).toBe(0);
    expect(anchor.note).toMatch(/0\.60 x ftp fallback/i);
    expect(anchor.note).toMatch(/spec 5\.2/i);
  });

  it('returns short_test fallback when fit_path points to a non-existent file', () => {
    const cfg = makeConfig({ fit_path: 'data/does-not-exist.fit' });
    const anchor = determineAnchor(cfg);

    expect(anchor.classification).toBe('short_test');
    expect(anchor.np_target_candidate).toBe(163);
    expect(anchor.duration_s).toBe(0);
  });
});

// Real-file tests: only run when the reference FIT is present on disk.
const REAL_FIT = 'data/23066238193_ACTIVITY.fit';

describe.skipIf(!existsSync(REAL_FIT))('readFitPower + analyzePass - real FIT file', () => {
  const cfg = makeConfig({ fit_path: REAL_FIT });

  it('readFitPower returns a non-empty power stream', () => {
    const stream = readFitPower(REAL_FIT);
    // Reference ride is ~3.98h at 1 Hz; expect several thousand samples
    expect(stream.length).toBeGreaterThan(5000);
    // All values should be non-negative numbers
    for (const p of stream) {
      expect(typeof p).toBe('number');
      expect(p).toBeGreaterThanOrEqual(0);
    }
  });

  it('analyzePass produces expected metrics: np near 165, long_representative, correct np_target_candidate', () => {
    const stream = readFitPower(REAL_FIT);
    const metrics = analyzePass(stream, cfg);

    // NP should be within +/-8 W of 165 (spec 18.2: 165 W = 0.61 x FTP)
    expect(Math.abs(metrics.np_w - 165)).toBeLessThan(8);

    // Duration should be within 6% of 14300 s (spec says ~3.98h = 14328s; filtered
    // power records give ~13547 because some records lack power data)
    const expectedDuration = 14300;
    const tolerance = 0.06 * expectedDuration; // 6% = 858 s
    expect(Math.abs(metrics.duration_s - expectedDuration)).toBeLessThan(tolerance);

    // Long enough to be classified as representative
    expect(metrics.classification).toBe('long_representative');

    // np_target_candidate should equal rounded np_w for long pass
    expect(metrics.np_target_candidate).toBe(Math.round(metrics.np_w));

    // Note should mention the long path and spec 8.1
    expect(metrics.note).toMatch(/long representative/i);
    expect(metrics.note).toMatch(/spec 8\.1/i);
  });

  it('determineAnchor with real FIT path returns long_representative anchor', () => {
    const anchor = determineAnchor(cfg);
    expect(anchor.classification).toBe('long_representative');
    expect(Math.abs(anchor.np_w - 165)).toBeLessThan(8);
    expect(anchor.np_target_candidate).toBe(Math.round(anchor.np_w));
    // sample_count should match what readFitPower returns
    const stream = readFitPower(REAL_FIT);
    expect(anchor.sample_count).toBe(stream.length);
  });
});
