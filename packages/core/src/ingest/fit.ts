// FIT ingest and anchor determination for the Vatternrundan race-plan calculator.
// Reads a Garmin FIT power file and derives the np_target anchor.
// Spec sections 8, 8.1, 18.2.

import { Decoder, Stream } from '@garmin/fitsdk';
import type { FitPassMetrics, Config } from '../types.js';
import { normalizedPower } from '../physics.js';

/** Plausible-power guard: finite and inside [0, MAX_POWER_W]. */
const MAX_POWER_W = 2000;
function isPlausiblePower(p: unknown): p is number {
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= MAX_POWER_W;
}

/**
 * Read raw power values (watts) from the bytes of a FIT activity file.
 * Returns one value per record message that carries a plausible (finite,
 * 0..2000 W) power field. Ignores record timing; prefer readFitPower1Hz for
 * NP, which respects timestamps and recording gaps.
 */
export function readFitPowerBytes(bytes: Uint8Array | number[]): number[] {
  const stream = Stream.fromByteArray(Array.from(bytes));
  const decoder = new Decoder(stream);
  const { messages } = decoder.read();
  const records: Array<{ power?: unknown }> = messages.recordMesgs ?? [];
  return records.map((r) => r.power).filter(isPlausiblePower);
}

export interface PowerRecord {
  t_s: number; // seconds (any epoch; only differences matter)
  power: number; // W
}

/**
 * Read timestamped power records from a FIT activity file. Records without a
 * usable timestamp or a plausible power value are dropped. The FIT SDK
 * surfaces timestamps as JS Dates; numeric timestamps are accepted as seconds.
 */
export function readFitPowerRecords(bytes: Uint8Array | number[]): PowerRecord[] {
  const stream = Stream.fromByteArray(Array.from(bytes));
  const decoder = new Decoder(stream);
  const { messages } = decoder.read();
  const records: Array<{ power?: unknown; timestamp?: unknown }> = messages.recordMesgs ?? [];
  const out: PowerRecord[] = [];
  for (const r of records) {
    if (!isPlausiblePower(r.power)) continue;
    let t_s: number | undefined;
    if (r.timestamp instanceof Date) t_s = r.timestamp.getTime() / 1000;
    else if (typeof r.timestamp === 'number' && Number.isFinite(r.timestamp)) t_s = r.timestamp;
    if (t_s === undefined) continue;
    out.push({ t_s, power: r.power });
  }
  return out;
}

/**
 * Resample timestamped power records to a contiguous 1 Hz series.
 *
 * NP's 30 s rolling window assumes 1 Hz contiguous samples; Garmin smart
 * recording emits records every few seconds, and dropping the gaps both
 * shortens the apparent duration (mis-classifying >2 h rides as short tests)
 * and distorts the rolling window. Rules:
 *   - records are sorted by time and snapped to a 1 s grid (last value wins
 *     within a second)
 *   - gaps of <= 3 s are forward-filled (smart recording holds steady power)
 *   - longer gaps are zero-filled (auto-pause / stop: no pedaling credit)
 */
export function resamplePowerTo1Hz(records: PowerRecord[]): number[] {
  if (records.length === 0) return [];
  const sorted = [...records].sort((a, b) => a.t_s - b.t_s);
  const t0 = sorted[0].t_s;
  const lastSec = Math.round(sorted[sorted.length - 1].t_s - t0);

  const HOLD_MAX_S = 3;
  const out = new Array<number>(lastSec + 1).fill(0);
  const filled = new Array<boolean>(lastSec + 1).fill(false);

  for (const r of sorted) {
    const sec = Math.round(r.t_s - t0);
    out[sec] = r.power;
    filled[sec] = true;
  }

  let lastFilledIdx = 0;
  for (let i = 1; i <= lastSec; i++) {
    if (filled[i]) {
      lastFilledIdx = i;
    } else if (i - lastFilledIdx <= HOLD_MAX_S) {
      out[i] = out[lastFilledIdx];
    }
    // else: leave 0 (pause)
  }

  return out;
}

/**
 * Power stream for NP/anchor analysis: timestamped records resampled to 1 Hz.
 * Falls back to the raw per-record stream when no records carry timestamps
 * (synthetic or stripped files).
 */
export function readFitPower1Hz(bytes: Uint8Array | number[]): number[] {
  const records = readFitPowerRecords(bytes);
  if (records.length > 0) return resamplePowerTo1Hz(records);
  return readFitPowerBytes(bytes);
}

/**
 * Analyze a power stream from a representative pass and produce FitPassMetrics.
 *
 * Classification:
 *   long_representative  -> duration_s > 7200 (more than 2 hours of steady effort)
 *   short_test           -> duration_s <= 7200
 *
 * np_target_candidate:
 *   long  -> np_w (the pass NP is used directly as the physiological anchor)
 *   short -> Math.round(0.60 * cfg.ftp) (FTP-fallback path, spec 5.2)
 *
 * The note explains how the anchor was determined so Tim can verify it.
 */
export function analyzePass(powerStream: number[], cfg: Config): FitPassMetrics {
  const sample_count = powerStream.length;
  const duration_s = sample_count;
  const mean_power_w = sample_count > 0 ? powerStream.reduce((a, b) => a + b, 0) / sample_count : 0;
  const np_w = normalizedPower(powerStream);

  const isLong = duration_s > 7200;
  const classification: FitPassMetrics['classification'] = isLong
    ? 'long_representative'
    : 'short_test';

  const np_target_candidate = isLong ? Math.round(np_w) : Math.round(0.6 * cfg.ftp);

  const durationHStr = (duration_s / 3600).toFixed(2) + 'h';
  const note = isLong
    ? `Long representative ride (${durationHStr}), rolling NP ${Math.round(np_w)} W used directly as np_target. ` +
      `Reference bunch was 8 riders (duty cycle 1/8); plan uses 12 (1/12), ` +
      `see spec 8.1: rider NP is the group-size-independent physiological anchor.`
    : `Short test ride (${durationHStr}), NP ${Math.round(np_w)} W. ` +
      `FTP-fallback path: np_target = 0.60 x ftp = ${Math.round(0.6 * cfg.ftp)} W (spec 5.2).`;

  return {
    duration_s,
    mean_power_w,
    np_w,
    sample_count,
    classification,
    np_target_candidate,
    note,
  };
}

/**
 * Determine the np_target anchor from an already-loaded power stream.
 *
 * If a non-null power stream is given, analyzes it. Otherwise (no FIT
 * available) returns a synthetic FitPassMetrics with a 0.60 x ftp fallback.
 */
export function determineAnchorFromPower(
  powerStream: number[] | null,
  cfg: Config,
): FitPassMetrics {
  if (powerStream !== null) {
    return analyzePass(powerStream, cfg);
  }

  // No FIT provided: fallback to 0.60 x ftp (spec 5.2).
  const np_target_candidate = Math.round(0.6 * cfg.ftp);
  return {
    duration_s: 0,
    mean_power_w: 0,
    np_w: 0,
    sample_count: 0,
    classification: 'short_test',
    np_target_candidate,
    note: `No FIT provided, np_target = 0.60 x ftp fallback (spec 5.2).`,
  };
}
