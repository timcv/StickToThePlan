/**
 * Tests for src/cli.ts (Task 16): end-to-end pipeline, offline calm fallback,
 * and missing-GPX error handling.
 *
 * FAST and NO network: the test runs offline with no cache, so runPlan takes
 * the calm-wind fallback and never touches fetch(). The synthetic GPX is tiny
 * (a handful of trackpoints over ~5 km) so the solver finishes instantly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPlan } from '../src/cli.js';

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

// A tiny GPX: 6 trackpoints spanning ~5 km along a line of longitude, with a
// small elevation bump in the middle. Coordinates near Motala, Sweden.
const SYNTHETIC_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>synthetic</name>
    <trkseg>
      <trkpt lat="58.5000" lon="15.0000"><ele>80.0</ele></trkpt>
      <trkpt lat="58.5090" lon="15.0000"><ele>82.0</ele></trkpt>
      <trkpt lat="58.5180" lon="15.0000"><ele>95.0</ele></trkpt>
      <trkpt lat="58.5270" lon="15.0000"><ele>96.0</ele></trkpt>
      <trkpt lat="58.5360" lon="15.0000"><ele>85.0</ele></trkpt>
      <trkpt lat="58.5450" lon="15.0000"><ele>80.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

let workDir: string;
let gpxPath: string;
let outDir: string;
let configPath: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'cli-test-'));
  gpxPath = join(workDir, 'route.gpx');
  outDir = join(workDir, 'out');
  configPath = join(workDir, 'config.json');

  writeFileSync(gpxPath, SYNTHETIC_GPX, 'utf-8');

  // Solo mode (n_riders: 1) -> no FIT needed; offline -> calm fallback.
  // target_total_hm 0:30 is comfortably reachable for a ~5 km route.
  // A synthetic race_date keeps the test hermetic: it never collides with a
  // real .cache/weather-<date>.json the coordinator might have written, so the
  // offline read is guaranteed a cache miss and the calm fallback fires.
  const cfg = {
    race_date: '1999-01-01',
    start_time: '04:22',
    gpx_path: gpxPath,
    n_riders: 1,
    ftp: 272,
    target_total_hm: '0:30',
    stops: [],
  };
  writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runPlan (offline calm fallback, solo)', () => {
  it('produces all five artifacts and a parseable plan.json with no network', async () => {
    const summary = await runPlan({ offline: true, outDir, configPath, noCiqCompile: true });

    // The five documented artifacts.
    const expected = ['tempokort.md', 'tempokort.html', 'workout.fit', 'course.gpx', 'plan.json'];
    for (const name of expected) {
      const p = join(outDir, name);
      expect(existsSync(p), `${name} should exist`).toBe(true);
    }

    // The summary lists the five written paths.
    expect(summary.artifacts).toHaveLength(5);
    for (const name of expected) {
      expect(summary.artifacts.some((a) => a.endsWith(name))).toBe(true);
    }

    // Offline with no cache -> reduced ensemble true, calm fallback.
    expect(summary.reducedEnsemble).toBe(true);
    expect(typeof summary.expectedNp).toBe('number');
    expect(summary.expectedNp).toBeGreaterThan(0);
    expect(summary.expectedTotalS).toBeGreaterThan(0);

    // plan.json parses and carries the expected shape + calm note.
    const planText = readFileSync(join(outDir, 'plan.json'), 'utf-8');
    const plan = JSON.parse(planText) as Record<string, any>;
    expect(plan).toHaveProperty('scenarios');
    expect(plan).toHaveProperty('segments');
    expect(plan).toHaveProperty('meta');
    expect(plan.meta.reducedEnsemble).toBe(true);
    const notesJoined = (plan.meta.notes as string[]).join(' ');
    expect(notesJoined.toLowerCase()).toContain('calm');

    // tempokort.md has no em dash.
    const md = readFileSync(join(outDir, 'tempokort.md'), 'utf-8');
    expect(md).not.toContain(String.fromCharCode(0x2014));
  });

  it('reuses the calm plan for all three scenarios (they are equal)', async () => {
    await runPlan({ offline: true, outDir, configPath, noCiqCompile: true });
    const plan = JSON.parse(readFileSync(join(outDir, 'plan.json'), 'utf-8')) as Record<string, any>;
    const s = plan.scenarios;
    expect(s.expected.total_time_s).toBe(s.optimistic.total_time_s);
    expect(s.expected.total_time_s).toBe(s.pessimistic.total_time_s);
    expect(s.expected.np_target_used).toBe(s.pessimistic.np_target_used);
  });
});

describe('runPlan error handling', () => {
  it('throws a clear error naming the path when the GPX is missing', async () => {
    const badGpx = join(workDir, 'does-not-exist.gpx');
    const badConfigPath = join(workDir, 'bad-config.json');
    const badCfg = {
      race_date: '1999-01-01',
      start_time: '04:22',
      gpx_path: badGpx,
      n_riders: 1,
      ftp: 272,
      target_total_hm: '0:30',
      stops: [],
    };
    writeFileSync(badConfigPath, JSON.stringify(badCfg, null, 2), 'utf-8');

    await expect(
      runPlan({ offline: true, outDir, configPath: badConfigPath }),
    ).rejects.toThrow(badGpx);
  });
});
