// FIT ingest and anchor determination for the Vatternrundan race-plan calculator.
// Reads a Garmin FIT power file and derives the np_target anchor.
// Spec sections 8, 8.1, 18.2.

import { Decoder, Stream } from '@garmin/fitsdk';
import type { FitPassMetrics, Config } from '../types.js';
import { normalizedPower } from '../physics.js';

/**
 * Read raw power values (watts) from the bytes of a FIT activity file.
 * Returns one value per record message that carries a numeric power field.
 * Null/undefined power records are filtered out.
 */
export function readFitPowerBytes(bytes: Uint8Array | number[]): number[] {
  const stream = Stream.fromByteArray(Array.from(bytes));
  const decoder = new Decoder(stream);
  const { messages } = decoder.read();
  const records: Array<{ power?: unknown }> = messages.recordMesgs ?? [];
  return records.map((r) => r.power).filter((p): p is number => typeof p === 'number');
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
