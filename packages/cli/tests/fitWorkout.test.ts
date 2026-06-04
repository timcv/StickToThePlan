// Tests for the distance-based Garmin FIT workout writer (Task 14).
// Spec sections 12.2 and 15.
//
// The round-trip decode is the source of truth: every assertion writes a real
// FIT file with the Garmin SDK Encoder, reads it back with the Decoder, and
// checks the decoded values. The critical property is the +1000 power offset
// (spec 12.2): absolute watts are stored as watts + 1000, so 250 W -> 1250.

import { describe, it, expect } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Decoder, Stream } from '@garmin/fitsdk';
import { buildSteps, applyDefaults, type Config, type DisplaySegment } from '@stp/core';
import { writeWorkout } from '../src/fileIo.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// Three segments with known pull bands and distances.
// pull bands: 240/260, 200/220, 280/300 W; distances: 10000, 20000, 5000 m.
function makeSegments(): DisplaySegment[] {
  const base = {
    net_height_m: 0,
    avg_grade: 0,
    eta_s: 0,
    wind_label: '',
    avg_speed_kmh: 0, micro_indices: [] as number[],
  };
  return [
    {
      ...base,
      from_km: 0,
      to_km: 10,
      town: 'Gränna',
      distance_m: 10000,
      pull_w_low: 240,
      pull_w_high: 260,
      avg_w: 250,
      note: 'JÄMN FART',
    },
    {
      ...base,
      from_km: 10,
      to_km: 30,
      distance_m: 20000,
      pull_w_low: 200,
      pull_w_high: 220,
      avg_w: 210,
      note: 'TA DET LUGNT',
    },
    {
      ...base,
      from_km: 30,
      to_km: 35,
      town: 'Mål',
      distance_m: 5000,
      pull_w_low: 280,
      pull_w_high: 300,
      avg_w: 290,
      note: 'SISTA UPPFÖR',
    },
  ];
}

function tmpPath(name: string): string {
  return join(tmpdir(), `${name}-${process.pid}-${Math.random().toString(36).slice(2)}.fit`);
}

interface DecodedStep {
  messageIndex?: number;
  wktStepName?: string;
  durationType?: string;
  durationDistance?: number;
  targetType?: string;
  customTargetValueLow?: number;
  customTargetValueHigh?: number;
}

function decode(path: string): {
  steps: DecodedStep[];
  numValidSteps?: number;
  wktName?: string;
  sport?: string;
  fileType?: string;
} {
  const bytes = readFileSync(path);
  const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  const { messages, errors } = decoder.read();
  expect(errors.length).toBe(0);
  const wkt = (messages.workoutMesgs ?? [])[0] ?? {};
  const fileId = (messages.fileIdMesgs ?? [])[0] ?? {};
  return {
    steps: (messages.workoutStepMesgs ?? []) as DecodedStep[],
    numValidSteps: wkt.numValidSteps,
    wktName: wkt.wktName,
    sport: wkt.sport,
    fileType: fileId.type,
  };
}

// ---------------------------------------------------------------------------
// buildSteps
// ---------------------------------------------------------------------------

describe('buildSteps', () => {
  it('maps pull bands to step targets (watch_target = pull)', () => {
    const cfg = makeConfig({ watch_target: 'pull' });
    const steps = buildSteps(makeSegments(), cfg);

    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({
      messageIndex: 0,
      durationMeters: 10000,
      wattsLow: 240,
      wattsHigh: 260,
      name: 'Gränna',
    });
    // Segment with no town uses the note as the step name.
    expect(steps[1]).toMatchObject({
      messageIndex: 1,
      durationMeters: 20000,
      wattsLow: 200,
      wattsHigh: 220,
      name: 'TA DET LUGNT',
    });
    expect(steps[2]).toMatchObject({
      messageIndex: 2,
      durationMeters: 5000,
      wattsLow: 280,
      wattsHigh: 300,
      name: 'Mål',
    });
  });

  it('derives the band from avg_w +/- band_pct (watch_target = avg)', () => {
    const cfg = makeConfig({ watch_target: 'avg' });
    expect(cfg.band_pct).toBeGreaterThan(0);
    const segs = makeSegments();
    const steps = buildSteps(segs, cfg);

    expect(steps).toHaveLength(3);
    for (let i = 0; i < segs.length; i++) {
      const avg = segs[i].avg_w;
      expect(steps[i].wattsLow).toBe(Math.round(avg * (1 - cfg.band_pct)));
      expect(steps[i].wattsHigh).toBe(Math.round(avg * (1 + cfg.band_pct)));
    }
    // Sanity for the first segment: 250 W +/- 5% = 238..263.
    expect(steps[0].wattsLow).toBe(238);
    expect(steps[0].wattsHigh).toBe(263);
  });

  it('skips neutral (zero-watt) segments so every step has a real target', () => {
    const cfg = makeConfig({ watch_target: 'pull' });
    const segs = makeSegments();
    // Prepend a neutral km0-1 segment with no power.
    const neutral: DisplaySegment = {
      from_km: 0,
      to_km: 1,
      distance_m: 1000,
      net_height_m: 0,
      avg_grade: 0,
      eta_s: 0,
      wind_label: '',
      pull_w_low: 0,
      pull_w_high: 0,
      avg_w: 0,
      note: 'NEUTRAL',
      avg_speed_kmh: 0, micro_indices: [],
    };
    const steps = buildSteps([neutral, ...segs], cfg);

    // Neutral segment dropped; remaining three re-indexed from 0.
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.messageIndex)).toEqual([0, 1, 2]);
    expect(steps[0].wattsLow).toBe(240);
  });

  it('throws when more than 50 steps would be produced (upstream cap violated)', () => {
    const cfg = makeConfig({ watch_target: 'pull' });
    const one = makeSegments()[0];
    const tooMany: DisplaySegment[] = Array.from({ length: 51 }, (_, i) => ({
      ...one,
      from_km: i,
      to_km: i + 1,
    }));
    expect(() => buildSteps(tooMany, cfg)).toThrow(/50/);
  });
});

// ---------------------------------------------------------------------------
// writeWorkout  (round-trip decode is the source of truth)
// ---------------------------------------------------------------------------

describe('writeWorkout round-trip', () => {
  it('writes a decodable workout with the +1000 power offset (watch_target = pull)', () => {
    const cfg = makeConfig({ watch_target: 'pull' });
    const segs = makeSegments();
    const out = tmpPath('vr-pull');

    let result: { numSteps: number; bytes: number };
    try {
      result = writeWorkout(segs, cfg, out);

      expect(result.numSteps).toBe(3);
      expect(result.bytes).toBeGreaterThan(0);

      const decoded = decode(out);
      expect(decoded.fileType).toBe('workout');
      expect(decoded.sport).toBe('cycling');
      expect(decoded.wktName).toBe('Vatternrundan');
      expect(decoded.numValidSteps).toBe(3);
      expect(decoded.steps).toHaveLength(3);

      const intended = [
        { idx: 0, m: 10000, lo: 240, hi: 260 },
        { idx: 1, m: 20000, lo: 200, hi: 220 },
        { idx: 2, m: 5000, lo: 280, hi: 300 },
      ];
      decoded.steps.forEach((step, i) => {
        const want = intended[i];
        // messageIndex runs 0,1,2
        expect(step.messageIndex).toBe(want.idx);
        // distance round-trips within 1 m
        expect(step.durationType).toBe('distance');
        expect(Math.abs((step.durationDistance ?? -1) - want.m)).toBeLessThanOrEqual(1);
        // THE 1000-OFFSET PROOF: stored value minus 1000 equals intended watts
        expect(step.targetType).toBe('power');
        expect((step.customTargetValueLow ?? 0) - 1000).toBe(want.lo);
        expect((step.customTargetValueHigh ?? 0) - 1000).toBe(want.hi);
      });
    } finally {
      rmSync(out, { force: true });
    }
  });

  it('writes the avg-derived band with the +1000 offset (watch_target = avg)', () => {
    const cfg = makeConfig({ watch_target: 'avg' });
    const segs = makeSegments();
    const out = tmpPath('vr-avg');

    try {
      const result = writeWorkout(segs, cfg, out);
      expect(result.numSteps).toBe(3);

      const decoded = decode(out);
      expect(decoded.numValidSteps).toBe(3);
      expect(decoded.steps).toHaveLength(3);

      decoded.steps.forEach((step, i) => {
        const avg = segs[i].avg_w;
        const wantLow = Math.round(avg * (1 - cfg.band_pct));
        const wantHigh = Math.round(avg * (1 + cfg.band_pct));
        expect((step.customTargetValueLow ?? 0) - 1000).toBe(wantLow);
        expect((step.customTargetValueHigh ?? 0) - 1000).toBe(wantHigh);
      });
      // First segment: 250 W +/- 5% -> stored 1238 / 1263.
      expect(decoded.steps[0].customTargetValueLow).toBe(1238);
      expect(decoded.steps[0].customTargetValueHigh).toBe(1263);
    } finally {
      rmSync(out, { force: true });
    }
  });
});
