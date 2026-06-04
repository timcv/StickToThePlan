// Distance-based Garmin FIT workout writer (Task 14, spec sections 12.2 and 15).
//
// Produces a structured cycling workout with one workout_step per display
// segment. The watch follows the step targets by distance: when you have
// ridden the step's distance it advances to the next segment's watt band.
//
// CRITICAL: the +1000 power offset (spec 12.2).
// Garmin's workout power encoding overloads one uint32 field:
//   values 0..1000   = percent of FTP
//   values > 1000    = absolute watts minus 1000
// So an absolute target of 250 W is stored as 1250. We always add 1000.
//
// Field-name and scaling choices were verified by round-tripping a file
// through the SDK Encoder and Decoder (the round-trip is the source of truth):
//   - The encoder matches only top-level Profile field names, never subfield
//     names. Writing `durationDistance` or `customTargetPowerLow` is silently
//     dropped, so we write the parent fields `durationValue` and
//     `customTargetValueLow` / `customTargetValueHigh`.
//   - `durationValue` carries no scale in the encoder (parent scale 1), but the
//     decoder applies the `durationDistance` subfield scale of 100. To make the
//     decoded metres come out right we pre-multiply metres by 100 on write.
//   - `customTargetValueLow` / `High` use scale 1 on both write and read, so the
//     +1000 watt value round-trips byte-for-byte.

import { Encoder, Profile } from '@garmin/fitsdk';
import type { DisplaySegment, Config } from '../types.js';

/**
 * A FIT message literal: the global mesgNum plus its named field values.
 *
 * Why this exists: the SDK ships a hand-written Encoder.writeMesg type
 * (Encodable<Mesg>) that only declares `mesgNum`/`developerFields`. Under
 * bundler-style module resolution (apps/web) that strict type rejects the real
 * FIT fields (type, wktName, power, ...) as excess properties on a literal,
 * even though the runtime accepts them; under NodeNext (core/cli) the SDK's
 * extensionless declaration re-exports do not resolve at all, so writeMesg is
 * effectively untyped and the same literals pass. Passing a value of this named
 * type (not a fresh literal) into writeMesg sidesteps excess-property checking,
 * so both resolution modes agree without using `any`.
 */
type FitFieldValue = string | number | boolean | bigint | Date | Array<string | number>;
interface FitMesg {
  mesgNum: number;
  [field: string]: FitFieldValue | undefined;
}

function writeFitMesg(encoder: Encoder, mesg: FitMesg): void {
  // The SDK's writeMesg parameter type (Encodable<Mesg>) is narrower than what
  // the encoder accepts at runtime; cast through unknown so the widened message
  // shape compiles identically under NodeNext and bundler resolution.
  encoder.writeMesg(mesg as unknown as Parameters<Encoder['writeMesg']>[0]);
}

/** Distance subfield scale: the decoder divides the raw value by 100 to get metres. */
const DISTANCE_SCALE = 100;

/** Garmin workout power offset. Absolute watts are stored as watts + 1000 (spec 12.2). */
const POWER_OFFSET = 1000;

/** Workout name written to the FIT file and shown on the watch. */
const WORKOUT_NAME = 'Vatternrundan';

/** Garmin caps a structured workout at 50 steps; segmentation already enforces this upstream. */
const MAX_STEPS = 50;

export interface WorkoutStepTarget {
  messageIndex: number;
  durationMeters: number;
  wattsLow: number;
  wattsHigh: number;
  name?: string;
}

/**
 * Turn display segments into ordered workout step targets.
 *
 * Watt targets follow cfg.watch_target:
 *   'pull' -> the segment's pull band (pull_w_low / pull_w_high).
 *   'avg'  -> the rider mean avg_w widened by +/- cfg.band_pct, rounded.
 *
 * Neutral segments (both watt bounds zero, e.g. the km0-1 neutral block) carry
 * no real power target. We DROP them so every emitted step holds a meaningful
 * watt band, then re-index the survivors from 0. The neutral kilometre is
 * untimed on the watch anyway, so nothing useful is lost.
 *
 * durationMeters is round(distance_m). name is the control town when present,
 * otherwise the note keyword.
 *
 * Throws if more than MAX_STEPS steps would result: segmentation caps display
 * segments at <= 50, so exceeding it is an upstream error worth surfacing.
 */
export function buildSteps(displaySegments: DisplaySegment[], cfg: Config): WorkoutStepTarget[] {
  const steps: WorkoutStepTarget[] = [];

  for (const seg of displaySegments) {
    let wattsLow: number;
    let wattsHigh: number;

    if (cfg.watch_target === 'avg') {
      wattsLow = Math.round(seg.avg_w * (1 - cfg.band_pct));
      wattsHigh = Math.round(seg.avg_w * (1 + cfg.band_pct));
    } else {
      wattsLow = seg.pull_w_low;
      wattsHigh = seg.pull_w_high;
    }

    // Skip neutral segments with no real power target.
    if (wattsLow === 0 && wattsHigh === 0) {
      continue;
    }

    steps.push({
      messageIndex: steps.length,
      durationMeters: Math.round(seg.distance_m),
      wattsLow,
      wattsHigh,
      name: seg.town ?? seg.note,
    });
  }

  if (steps.length > MAX_STEPS) {
    throw new Error(
      `FIT workout would have ${steps.length} steps, exceeding the ${MAX_STEPS}-step limit; ` +
        `display segmentation should cap segments at ${MAX_STEPS} (upstream error).`,
    );
  }

  return steps;
}

/**
 * Build the workout steps and encode a distance-based FIT workout, returning
 * the encoded bytes.
 *
 * Messages written:
 *   file_id      type=workout, manufacturer=development, time_created, serial_number.
 *   workout      wkt_name, sport=cycling, num_valid_steps.
 *   workout_step one per step: message_index, optional wkt_step_name,
 *                duration_type=distance + duration_value (metres * 100),
 *                target_type=power + custom_target_value_low/high (watts + 1000).
 */
export function encodeWorkout(
  displaySegments: DisplaySegment[],
  cfg: Config,
): Uint8Array {
  const steps = buildSteps(displaySegments, cfg);

  const encoder = new Encoder();

  writeFitMesg(encoder, {
    mesgNum: Profile.MesgNum.FILE_ID,
    type: 'workout',
    manufacturer: 'development',
    product: 0,
    timeCreated: new Date(),
    serialNumber: 1234,
  });

  writeFitMesg(encoder, {
    mesgNum: Profile.MesgNum.WORKOUT,
    wktName: WORKOUT_NAME,
    sport: 'cycling',
    numValidSteps: steps.length,
  });

  for (const step of steps) {
    writeFitMesg(encoder, {
      mesgNum: Profile.MesgNum.WORKOUT_STEP,
      messageIndex: step.messageIndex,
      wktStepName: step.name,
      durationType: 'distance',
      // Parent field scale is 1 on write; decoder applies the distance subfield
      // scale of 100, so pre-multiply to land on the intended metres.
      durationValue: step.durationMeters * DISTANCE_SCALE,
      targetType: 'power',
      customTargetValueLow: step.wattsLow + POWER_OFFSET,
      customTargetValueHigh: step.wattsHigh + POWER_OFFSET,
    });
  }

  return encoder.close();
}
