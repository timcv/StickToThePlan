// 1 Hz resampling of timestamped FIT power records (math review M9).

import { describe, it, expect } from 'vitest';
import { resamplePowerTo1Hz, type PowerRecord } from '../src/ingest/fit.js';
import { normalizedPower } from '../src/physics.js';

function rec(t_s: number, power: number): PowerRecord {
  return { t_s, power };
}

describe('resamplePowerTo1Hz', () => {
  it('returns [] for no records', () => {
    expect(resamplePowerTo1Hz([])).toEqual([]);
  });

  it('passes a contiguous 1 Hz series through unchanged', () => {
    const records = [rec(100, 200), rec(101, 210), rec(102, 220)];
    expect(resamplePowerTo1Hz(records)).toEqual([200, 210, 220]);
  });

  it('forward-fills smart-recording gaps up to 3 s', () => {
    // Records at t=0 and t=3: the 3 s gap holds the previous power.
    const records = [rec(0, 200), rec(3, 240)];
    expect(resamplePowerTo1Hz(records)).toEqual([200, 200, 200, 240]);
  });

  it('zero-fills pauses longer than 3 s', () => {
    // 10 s gap: 3 s hold, then zeros until the next record.
    const records = [rec(0, 200), rec(10, 240)];
    const out = resamplePowerTo1Hz(records);
    expect(out).toHaveLength(11);
    expect(out.slice(0, 4)).toEqual([200, 200, 200, 200]); // t0 + 3 s hold
    expect(out.slice(4, 10)).toEqual([0, 0, 0, 0, 0, 0]); // pause
    expect(out[10]).toBe(240);
  });

  it('restores the true duration so NP windows cover wall time', () => {
    // 100 records, one every 4 s: raw stream is 100 samples, wall time 397 s.
    const records: PowerRecord[] = [];
    for (let i = 0; i < 100; i++) records.push(rec(i * 4, 250));
    const out = resamplePowerTo1Hz(records);
    expect(out).toHaveLength(397);
  });

  it('sorts out-of-order records', () => {
    const records = [rec(2, 220), rec(0, 200), rec(1, 210)];
    expect(resamplePowerTo1Hz(records)).toEqual([200, 210, 220]);
  });
});

describe('normalizedPower full-window semantics', () => {
  it('equals the constant for a constant series', () => {
    expect(normalizedPower(Array(120).fill(200))).toBeCloseTo(200, 6);
  });

  it('falls back to the mean for arrays shorter than 30 samples', () => {
    expect(normalizedPower([100, 200, 300])).toBeCloseTo(200, 6);
  });

  it('uses only full 30 s windows (a leading spike does not get a short-window boost)', () => {
    // 1 spike sample then 89 steady: with prefix windows the spike used to
    // contribute a full-strength rolling value of its own.
    const samples = [1000, ...Array(89).fill(200)];
    const np = normalizedPower(samples);
    // First full window mean = (1000 + 29*200)/30 = 226.7; later windows 200.
    // NP must sit between 200 and 226.7, nowhere near the prefix-window result.
    expect(np).toBeGreaterThan(200);
    expect(np).toBeLessThan(227);
  });
});
