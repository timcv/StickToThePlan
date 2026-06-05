import { describe, it, expect } from 'vitest';
import { runPipeline, type PipelineInput } from '../src/lib/pipeline';
import { sampleRouteGpx } from '../src/lib/sampleRoute';
import { buildManualField } from '@stp/core';

const baseForm: PipelineInput['form'] = {
  target_total_hm: '2:30',
  ftp: 250,
  n_riders: 6,
  m: 90,
  stops: [],
  watch_target: 'pull',
  race_date: '2026-06-13',
  start_time: '06:00',
};

describe('runPipeline weather injection', () => {
  it('calm when field is null (no network)', async () => {
    const input: PipelineInput = {
      gpxText: sampleRouteGpx,
      fitBytes: null,
      form: baseForm,
      weatherMode: 'calm',
      field: null,
    };
    const out = await runPipeline(input);
    expect(out.scenarios.expected).toBe(out.scenarios.optimistic);
  });

  it('uses an injected manual field', async () => {
    const field = buildManualField(
      [6, 7, 8].map((hour) => ({ hour, dir_from_deg: 0, speed_ms: 8 })),
      '2026-06-13',
      { lat: 58.5, lon: 14.6 },
    );
    const input: PipelineInput = {
      gpxText: sampleRouteGpx,
      fitBytes: null,
      form: baseForm,
      weatherMode: 'manual',
      field,
    };
    const out = await runPipeline(input);
    expect(out.scenarios.expected.segments.length).toBeGreaterThan(0);
  });
});
