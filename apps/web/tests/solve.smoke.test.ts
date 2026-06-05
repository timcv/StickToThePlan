/**
 * Smoke test for the race-plan pipeline.
 *
 * Imports runPipeline from the pure lib/pipeline module (not solve.worker.ts)
 * to avoid triggering the self.onmessage worker glue which relies on
 * DedicatedWorkerGlobalScope. The pipeline itself is pure (calm mode = no
 * network I/O), so results are fully deterministic.
 *
 * The sample GPX is read via node:fs so the test does not depend on Vite's
 * `?raw` import plugin which is not active in vitest.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runPipeline, type PipelineInput } from '../src/lib/pipeline';

// Resolve the sample GPX from the repo root. process.cwd() is the repo root
// when vitest runs from the monorepo root (as the workspace config requires).
const sampleGpxText = readFileSync(resolve(process.cwd(), 'examples/sample-route.gpx'), 'utf-8');

describe('runPipeline smoke test (calm mode)', () => {
  it('returns a non-empty split table and valid scenarios for the sample route', async () => {
    const input: PipelineInput = {
      gpxText: sampleGpxText,
      fitBytes: null,
      weatherMode: 'calm',
      field: null,
      form: {
        target_total_hm: '2:30',
        ftp: 250,
        n_riders: 6,
        m: 90,
        start_time: '06:00',
        race_date: '2026-06-13',
        watch_target: 'avg',
        stops: [{ control: 'Hästholmen', km: 38, minutes: 5 }],
      },
    };

    const result = await runPipeline(input);

    // splits: non-empty array of SplitRow
    expect(Array.isArray(result.splits)).toBe(true);
    expect(result.splits.length).toBeGreaterThanOrEqual(1);

    for (const row of result.splits) {
      expect(row.leg_distance_m).toBeGreaterThanOrEqual(0);
      expect(row.leg_time_s).toBeGreaterThanOrEqual(0);
      // arrive_s must be <= depart_s (stop time is non-negative)
      expect(row.arrive_s).toBeLessThanOrEqual(row.depart_s);
    }

    // displaySegments: non-empty
    expect(Array.isArray(result.displaySegments)).toBe(true);
    expect(result.displaySegments.length).toBeGreaterThan(0);

    // scenarios: expected total time is positive
    expect(result.scenarios.expected.total_time_s).toBeGreaterThan(0);
  });
});
