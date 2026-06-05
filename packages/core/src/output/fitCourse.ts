// FIT Course writer: a route the watch can navigate, with one named course
// point per control. The Connect IQ data field reads nameOfNextPoint /
// distanceToNextPoint from these course points.
//
// Reuses the @garmin/fitsdk Encoder pattern from fitWorkout.ts. Positions are
// stored as semicircles (the SDK applies no position auto-scale). Distance and
// altitude are written as raw metres: the SDK Encoder applies the FIT profile
// scale on write and the Decoder reverses it on read, so both round-trip in
// metres. This is the opposite of the workout's durationValue, which uses
// scale 1 and must be pre-multiplied by 100.
//
// Record/course-point timestamps are synthetic and monotonic in distance. The
// watch re-times when the course is ridden, so only their order matters; the
// planned clock the rider sees is baked into the course point NAME instead.

import { Encoder, Profile } from '@garmin/fitsdk';
import type { MicroSegment, PlanResult, Config } from '../types.js';
import type { ControlPoint } from '../segmentation.js';
import { secondsToClock, secondsToElapsed } from '../util/time.js';
import { nearestMicroIndex, nearestEtaS } from './course.js';

type FitFieldValue = string | number | boolean | bigint | Date | Array<string | number>;
interface FitMesg {
  mesgNum: number;
  [field: string]: FitFieldValue | undefined;
}

function writeFitMesg(encoder: Encoder, mesg: FitMesg): void {
  encoder.writeMesg(mesg as unknown as Parameters<Encoder['writeMesg']>[0]);
}

/** 2^31 / 180: degrees -> FIT semicircles. */
const SEMICIRCLES_PER_DEGREE = 2147483648 / 180;
function toSemicircles(deg: number): number {
  return Math.round(deg * SEMICIRCLES_PER_DEGREE);
}

/**
 * Fixed nominal base date for synthetic record/course-point timestamps. Using a
 * constant (never new Date()) keeps the encoded bytes deterministic for tests.
 */
const BASE_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

/** Course name written to the FIT file and shown on the watch. */
const COURSE_NAME = 'Vatternrundan';

export interface CourseFitOptions {
  /**
   * When true, bake start-independent elapsed labels ("+H:MM") into each course
   * point name instead of absolute wall-clock ("HH:MM"). The Connect IQ field
   * detects the leading '+' and compares against the rider's own elapsed time,
   * so the plan delta is correct no matter when the ride is started.
   */
  relativeTime?: boolean;
}

/**
 * Encode a FIT Course from the route microsegments and the control points.
 * Mirrors buildCourseGpx's inputs so the cli can write both from one call site.
 */
export function buildCourseFit(
  microsegments: MicroSegment[],
  plan: PlanResult,
  cfg: Config,
  controls: ControlPoint[],
  opts: CourseFitOptions = {},
): Uint8Array {
  const encoder = new Encoder();

  const last = microsegments[microsegments.length - 1];
  const totalDist = last.cum_distance_m;
  const totalTime = plan.total_time_s;

  // Synthetic monotonic timestamp for a point at cumulative distance distM.
  const tsAtDist = (distM: number): Date => {
    const frac = totalDist > 0 ? distM / totalDist : 0;
    return new Date(BASE_MS + Math.round(frac * totalTime) * 1000);
  };

  // file_id (course).
  writeFitMesg(encoder, {
    mesgNum: Profile.MesgNum.FILE_ID,
    type: 'course',
    manufacturer: 'development',
    product: 0,
    timeCreated: new Date(BASE_MS),
    serialNumber: 1234,
  });

  // course.
  writeFitMesg(encoder, {
    mesgNum: Profile.MesgNum.COURSE,
    name: COURSE_NAME,
    sport: 'cycling',
  });

  // lap spanning the whole route.
  const first = microsegments[0];
  writeFitMesg(encoder, {
    mesgNum: Profile.MesgNum.LAP,
    timestamp: tsAtDist(totalDist),
    startTime: tsAtDist(0),
    startPositionLat: toSemicircles(first.lat),
    startPositionLong: toSemicircles(first.lon),
    endPositionLat: toSemicircles(last.lat),
    endPositionLong: toSemicircles(last.lon),
    totalElapsedTime: totalTime,
    totalTimerTime: totalTime,
    totalDistance: totalDist,
  });

  // timer start event.
  writeFitMesg(encoder, {
    mesgNum: Profile.MesgNum.EVENT,
    timestamp: tsAtDist(0),
    event: 'timer',
    eventType: 'start',
  });

  // records: the navigable track.
  for (const m of microsegments) {
    writeFitMesg(encoder, {
      mesgNum: Profile.MesgNum.RECORD,
      timestamp: tsAtDist(m.cum_distance_m),
      positionLat: toSemicircles(m.lat),
      positionLong: toSemicircles(m.lon),
      distance: m.cum_distance_m,
      altitude: m.ele_start_m,
    });
  }

  // course points: one per control, named "<control> HH:MM" (absolute clock)
  // or "<control> +H:MM" (elapsed-since-start, when relativeTime is set).
  for (const cp of controls) {
    const targetM = cp.km * 1000;
    const micro = microsegments[nearestMicroIndex(microsegments, targetM)];
    const etaS = nearestEtaS(plan, targetM);
    const timeLabel = opts.relativeTime
      ? `+${secondsToElapsed(etaS)}`
      : secondsToClock(etaS, cfg.start_time);
    writeFitMesg(encoder, {
      mesgNum: Profile.MesgNum.COURSE_POINT,
      timestamp: tsAtDist(micro.cum_distance_m),
      positionLat: toSemicircles(micro.lat),
      positionLong: toSemicircles(micro.lon),
      distance: micro.cum_distance_m,
      name: `${cp.name} ${timeLabel}`,
      type: 'generic',
    });
  }

  // timer stop event.
  writeFitMesg(encoder, {
    mesgNum: Profile.MesgNum.EVENT,
    timestamp: tsAtDist(totalDist),
    event: 'timer',
    eventType: 'stopAll',
  });

  return encoder.close();
}
