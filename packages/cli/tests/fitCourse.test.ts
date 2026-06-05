// Round-trip test for the FIT Course exporter (buildCourseFit).
// The decode is the source of truth: encode real bytes with the SDK Encoder,
// read them back with the Decoder, and assert the course points the watch
// will navigate by.
import { describe, it, expect } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import {
  buildCourseFit,
  applyDefaults,
  type Config,
  type MicroSegment,
  type PlanResult,
  type ControlPoint,
} from '@stp/core';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return applyDefaults({
    race_date: '2026-06-13',
    start_time: '04:22',
    gpx_path: 'route.gpx',
    ftp: 272,
    n_riders: 12,
    target_total_hm: '11:45',
    stops: [],
    ...overrides,
  });
}

// 11 microsegments over ~10 km along a meridian near Gränna, climbing then flat.
function makeMicro(): MicroSegment[] {
  const out: MicroSegment[] = [];
  for (let i = 0; i < 11; i++) {
    out.push({
      index: i,
      distance_m: 1000,
      cum_distance_m: i * 1000,
      grade: 0,
      bearing_deg: 0,
      lat: 58.0 + i * 0.009,
      lon: 14.5,
      ele_start_m: 100 + i,
      ele_end_m: 101 + i,
      neutral: false,
    });
  }
  return out;
}

// A plan whose segments carry eta_s at each micro end (linear: 120 s per km).
function makePlan(micro: MicroSegment[]): PlanResult {
  const segments = micro.map((m) => ({
    micro: m,
    v_ms: 8.33,
    speed_kmh: 30,
    p_pull_w: 200,
    p_draft_w: 140,
    p_mean_w: 165,
    rider_np_w: 165,
    time_s: 120,
    eta_s: (m.cum_distance_m / 1000) * 120,
    headwind_ms: 0,
    crosswind_ms: 0,
    rho: 1.2,
    cap_binding: 'none' as const,
    raw_windspeed_ms: 0,
    eff_windspeed_ms: 0,
    z0_used: 0,
  }));
  return {
    np_target_used: 165,
    rider_np_ride_w: 165,
    intensity_factor: 165 / 272,
    total_time_s: 1200,
    rolling_time_s: 1200,
    stop_time_s: 0,
    segments,
    stops: [],
    reachable: true,
    notes: [],
  };
}

// Two controls: Start at km 0, Gränna at km 10.
const CONTROLS: ControlPoint[] = [
  { name: 'Start', km: 0 },
  { name: 'Gränna', km: 10 },
];

function decode(bytes: Uint8Array) {
  const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  const { messages, errors } = decoder.read();
  expect(errors.length).toBe(0);
  return messages as Record<string, any[]>;
}

describe('buildCourseFit round-trip', () => {
  const micro = makeMicro();
  const bytes = buildCourseFit(micro, makePlan(micro), makeConfig(), CONTROLS);
  const m = decode(bytes);

  it('is a course file named Vatternrundan, cycling', () => {
    expect((m.fileIdMesgs ?? [])[0]?.type).toBe('course');
    expect((m.courseMesgs ?? [])[0]?.name).toBe('Vatternrundan');
    expect((m.courseMesgs ?? [])[0]?.sport).toBe('cycling');
  });

  it('writes one record per microsegment with monotonic distance', () => {
    const recs = m.recordMesgs ?? [];
    expect(recs).toHaveLength(micro.length);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i].distance).toBeGreaterThanOrEqual(recs[i - 1].distance);
    }
    // distance round-trips to metres (scale handled by the SDK profile).
    expect(Math.abs(recs[recs.length - 1].distance - 10000)).toBeLessThanOrEqual(1);
  });

  it('writes one named course point per control with the planned HH:MM', () => {
    const cps = m.coursePointMesgs ?? [];
    expect(cps).toHaveLength(2);
    // start_time 04:22 + eta 0 s -> 04:22 ; + eta 1200 s (20 min) -> 04:42
    const names = cps.map((c) => c.name);
    expect(names).toContain('Start 04:22');
    expect(names).toContain('Gränna 04:42');
  });

  it('writes one lap spanning the full route', () => {
    const lap = (m.lapMesgs ?? [])[0];
    expect(lap).toBeDefined();
    expect(Math.abs(lap.totalDistance - 10000)).toBeLessThanOrEqual(1);
  });

  it('positions the Gränna course point at its nearest-micro lat/lon', () => {
    const cps = m.coursePointMesgs ?? [];
    const granna = cps.find((c) => (c.name as string).startsWith('Gränna'));
    expect(granna).toBeDefined();
    const SEMI = 2 ** 31 / 180; // inverse of SEMICIRCLES_PER_DEGREE in fitCourse.ts
    const latDeg = (granna!.positionLat as number) / SEMI;
    const lonDeg = (granna!.positionLong as number) / SEMI;
    expect(Math.abs(latDeg - 58.09)).toBeLessThan(0.0002); // micro index 10
    expect(Math.abs(lonDeg - 14.5)).toBeLessThan(0.0002);
  });
});

describe('buildCourseFit relative-time labels', () => {
  const micro = makeMicro();
  const bytes = buildCourseFit(micro, makePlan(micro), makeConfig(), CONTROLS, {
    relativeTime: true,
  });
  const m = decode(bytes);

  it('bakes elapsed "+H:MM" course-point names, independent of start_time', () => {
    const names = (m.coursePointMesgs ?? []).map((c) => c.name);
    // eta 0 s -> +0:00 ; eta 1200 s (20 min) -> +0:20. No "04:22" wall clock.
    expect(names).toContain('Start +0:00');
    expect(names).toContain('Gränna +0:20');
    for (const n of names) {
      expect(n as string).toContain('+');
    }
  });
});
