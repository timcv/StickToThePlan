/**
 * THE SPIKE (de-risk gate): proves @garmin/fitsdk runs under Vite/jsdom.
 *
 * Test A round-trips a workout through @stp/core's encodeWorkout (Encoder) and
 * the SDK Decoder + Stream, asserting the +1000 power-offset convention on the
 * decoded workout steps. If this passes in the jsdom environment, the Encoder,
 * Decoder and Stream classes all execute in a browser-like runtime.
 *
 * Test B builds a tiny ACTIVITY FIT with the Encoder (file_id + record mesgs
 * carrying power) and asserts readFitPowerBytes recovers those watts, proving
 * FIT upload parsing works in the browser path too.
 */
import { describe, it, expect } from 'vitest';
import { Decoder, Encoder, Stream, Profile } from '@garmin/fitsdk';
import {
  applyDefaults,
  encodeWorkout,
  readFitPowerBytes,
  type Config,
  type DisplaySegment,
} from '@stp/core';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<Config> = {}): Config {
  return applyDefaults({
    race_date: '2026-06-13',
    start_time: '04:22',
    gpx_path: 'web.gpx',
    ftp: 272,
    n_riders: 12,
    target_total_hm: '11:45',
    stops: [],
    watch_target: 'pull',
    ...overrides,
  });
}

// Two segments with known pull bands and distances.
function makeSegments(): DisplaySegment[] {
  const base = {
    net_height_m: 0,
    avg_grade: 0,
    avg_speed_kmh: 0,
    eta_s: 0,
    wind_label: '',
    micro_indices: [] as number[],
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
      to_km: 35,
      town: 'Mål',
      distance_m: 25000,
      pull_w_low: 200,
      pull_w_high: 220,
      avg_w: 210,
      note: 'TA DET LUGNT',
    },
  ];
}

interface DecodedStep {
  messageIndex?: number;
  targetType?: string;
  customTargetValueLow?: number;
  customTargetValueHigh?: number;
}

// The SDK's writeMesg type (Encodable<Mesg>) under-declares the FIT message
// fields under bundler resolution; widen to the shape the encoder accepts at
// runtime (mesgNum + arbitrary FIT fields) without using `any`. Same rationale
// as packages/core/src/output/fitWorkout.ts.
type FitFieldValue = string | number | boolean | bigint | Date | Array<string | number>;
interface FitMesg {
  mesgNum: number;
  [field: string]: FitFieldValue | undefined;
}

function writeFitMesg(encoder: Encoder, mesg: FitMesg): void {
  encoder.writeMesg(mesg as unknown as Parameters<Encoder['writeMesg']>[0]);
}

// ---------------------------------------------------------------------------
// Test A: encode (core) + decode (SDK) round-trip under jsdom
// ---------------------------------------------------------------------------

describe('fitsdk spike A: encodeWorkout + Decoder/Stream round-trip', () => {
  it('runs the Encoder/Decoder/Stream under jsdom and carries the +1000 power offset', () => {
    const cfg = makeConfig({ watch_target: 'pull' });
    const segs = makeSegments();

    const bytes = encodeWorkout(segs, cfg);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    const stream = Stream.fromByteArray(Array.from(bytes));
    const decoder = new Decoder(stream);
    const { messages, errors } = decoder.read();
    expect(errors.length).toBe(0);

    const steps = (messages.workoutStepMesgs ?? []) as DecodedStep[];
    expect(steps).toHaveLength(2);

    // THE 1000-OFFSET PROOF, mirroring packages/cli/tests/fitWorkout.test.ts:
    // the decoded stored value minus 1000 equals the intended absolute watts.
    const intended = [
      { idx: 0, lo: 240, hi: 260 },
      { idx: 1, lo: 200, hi: 220 },
    ];
    steps.forEach((step, i) => {
      const want = intended[i];
      expect(step.messageIndex).toBe(want.idx);
      expect(step.targetType).toBe('power');
      expect((step.customTargetValueLow ?? 0) - 1000).toBe(want.lo);
      expect((step.customTargetValueHigh ?? 0) - 1000).toBe(want.hi);
    });
  });
});

// ---------------------------------------------------------------------------
// Test B: build an ACTIVITY FIT with the Encoder, read power back
// ---------------------------------------------------------------------------

describe('fitsdk spike B: readFitPowerBytes on an Encoder-built activity', () => {
  it('recovers the record power values written by the SDK Encoder', () => {
    const powers = [210, 250, 230, 195];

    const encoder = new Encoder();
    writeFitMesg(encoder, {
      mesgNum: Profile.MesgNum.FILE_ID,
      type: 'activity',
      manufacturer: 'development',
      product: 0,
      timeCreated: new Date(),
      serialNumber: 99,
    });
    for (const p of powers) {
      writeFitMesg(encoder, { mesgNum: Profile.MesgNum.RECORD, power: p });
    }
    const bytes = encoder.close();
    expect(bytes.length).toBeGreaterThan(0);

    const recovered = readFitPowerBytes(bytes);
    expect(recovered).toEqual(powers);
  });
});
