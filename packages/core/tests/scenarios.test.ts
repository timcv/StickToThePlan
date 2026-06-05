import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { MicroSegment, Config } from '../src/types.js';
import type { EnsembleField } from '../src/weather/ensemble.js';
import { applyDefaults } from '../src/config.js';
import { ingestGpxString } from '../src/ingest/gpx.js';
import { hmToSeconds } from '../src/util/time.js';
import { solveThreeScenarios } from '../src/planner.js';

// ---------------------------------------------------------------------------
// Helper: build a synthetic flat route.
// ~200 microsegments, each 100 m (20 km total), grade 0, bearing 90 (travelling
// due east), fixed lat/lon, cum_distance increasing, none neutral.
// ---------------------------------------------------------------------------
const LAT = 58.0;
const LON = 14.5;

function buildFlatRoute(n = 200): MicroSegment[] {
  const segs: MicroSegment[] = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const distance_m = 100;
    cum += distance_m;
    segs.push({
      index: i,
      distance_m,
      cum_distance_m: cum,
      grade: 0,
      bearing_deg: 90, // travelling east
      lat: LAT,
      lon: LON,
      ele_start_m: 100,
      ele_end_m: 100,
      neutral: false,
    });
  }
  return segs;
}

// ---------------------------------------------------------------------------
// A) SYNTHETIC (always runs, fast).
//
// One ensemble cell at the route point. Wind FROM 90 deg while travelling
// bearing 90 deg => pure headwind. The three scenarios pick windspeed by
// percentile: optimistic p10 = 3 m/s, expected mean = 6 m/s, pessimistic
// p90 = 9 m/s. More headwind => higher required NP to hold the same time.
//
// NOTE on the target time: the task suggested 0:45 for the 20 km route, but
// under the hard pull cap (= ftp = 272 W) the 9 m/s pessimistic headwind cannot
// be ridden in 0:45 (~26.7 km/h ground into a ~32 km/h air speed). At 0:45 the
// pessimistic case caps out at FTP and lands ~3542 s, so reachable === false and
// the NP ordering is no longer meaningful (it clamps at FTP). 1:00 is the
// smallest reachable target where ALL three scenarios hit within 90 s and the NP
// ordering (optimistic 81.5 W < expected 129.6 W < pessimistic 192.5 W) is a
// clean strict ordering with a clear headwind margin. We use 1:00.
// ---------------------------------------------------------------------------
describe('A) synthetic flat route, three wind scenarios', () => {
  const TARGET = '1:00';

  const field: EnsembleField = {
    cells: [
      {
        time_iso: '2026-06-13T05:00:00Z',
        lat: LAT,
        lon: LON,
        windspeed_mean_ms: 6,
        winddir_from_deg: 90, // wind FROM east, route travels east => headwind
        windspeed_p10_ms: 3,
        windspeed_p90_ms: 9,
        temp_c: 12,
        pressure_pa: 101325,
        n_sources: 3,
      },
    ],
    sources: ['a', 'b', 'c'],
    reduced: false,
  };

  const cfg: Config = applyDefaults({
    race_date: '2026-06-13',
    start_time: '04:22',
    gpx_path: 'x',
    ftp: 272,
    n_riders: 12,
    target_total_hm: TARGET,
    stops: [],
  });

  const micro = buildFlatRoute(200);
  const three = solveThreeScenarios(micro, field, cfg);

  it('returns three PlanResults (expected, optimistic, pessimistic)', () => {
    expect(three.expected).toBeDefined();
    expect(three.optimistic).toBeDefined();
    expect(three.pessimistic).toBeDefined();
  });

  it(`all three totals within 90 s of ${TARGET}`, () => {
    const target = hmToSeconds(TARGET);
    expect(Math.abs(three.optimistic.total_time_s - target)).toBeLessThanOrEqual(90);
    expect(Math.abs(three.expected.total_time_s - target)).toBeLessThanOrEqual(90);
    expect(Math.abs(three.pessimistic.total_time_s - target)).toBeLessThanOrEqual(90);
  });

  it('all three scenarios are reachable at this target', () => {
    expect(three.optimistic.reachable).toBe(true);
    expect(three.expected.reachable).toBe(true);
    expect(three.pessimistic.reachable).toBe(true);
  });

  it('NP ordering: optimistic <= expected <= pessimistic (less headwind => lower NP)', () => {
    const EPS = 1e-6;
    expect(three.optimistic.np_target_used).toBeLessThanOrEqual(
      three.expected.np_target_used + EPS,
    );
    expect(three.expected.np_target_used).toBeLessThanOrEqual(
      three.pessimistic.np_target_used + EPS,
    );
  });

  it('pessimistic NP exceeds optimistic NP by a clear margin (headwind matters)', () => {
    // optimistic ~81.5 W vs pessimistic ~192.5 W. Require a clear, not marginal, gap.
    expect(three.pessimistic.np_target_used - three.optimistic.np_target_used).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// A2) NET-DOWNWIND route: optimistic/pessimistic spread must INVERT.
//
// Route travels east (bearing 90); wind FROM 270 (west) => pure tailwind on the
// whole route. More wind is FASTER here, so the WORST (pessimistic) case is the
// LEAST wind (p10) and the BEST (optimistic) case is the MOST wind (p90). The old
// magnitude-only mapping (pessimistic = p90) would have called the windiest
// tailwind the worst case, which is backwards. Guards the routeIsNetDownwind /
// favorableWind inversion.
// ---------------------------------------------------------------------------
describe('A2) net-downwind route inverts the optimistic/pessimistic spread', () => {
  const TARGET = '0:40'; // 30 km/h avg over 20 km; reachable even at the least tailwind

  const field: EnsembleField = {
    cells: [
      {
        time_iso: '2026-06-13T05:00:00Z',
        lat: LAT,
        lon: LON,
        windspeed_mean_ms: 5,
        winddir_from_deg: 270, // FROM the west; route travels east => tailwind
        windspeed_p10_ms: 2,
        windspeed_p90_ms: 8,
        temp_c: 12,
        pressure_pa: 101325,
        n_sources: 3,
      },
    ],
    sources: ['a', 'b', 'c'],
    reduced: false,
  };

  const cfg: Config = applyDefaults({
    race_date: '2026-06-13',
    start_time: '04:22',
    gpx_path: 'x',
    ftp: 272,
    n_riders: 12,
    target_total_hm: TARGET,
    stops: [],
  });

  const three = solveThreeScenarios(buildFlatRoute(200), field, cfg);

  it('pessimistic is the SLOWEST and optimistic the FASTEST (inverted vs magnitude)', () => {
    // Same target time, so on a tailwind route the slowest case needs the MOST
    // power (least tailwind = p10) and the fastest needs the least (most tailwind).
    expect(three.pessimistic.np_target_used).toBeGreaterThan(three.optimistic.np_target_used);
  });

  it('all three remain reachable at this target', () => {
    expect(three.optimistic.reachable).toBe(true);
    expect(three.expected.reachable).toBe(true);
    expect(three.pessimistic.reachable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B) REAL GPX smoke (slow, gated behind SLOW_TESTS). Runs three full course
// solves (~100 s). One ensemble cell over the course is acceptable for the smoke.
// ---------------------------------------------------------------------------
const REAL_GPX = 'data/vatternrundan-315km.gpx';

describe('B) real GPX (Vatternrundan 315 km), three scenarios', () => {
  it.skipIf(!process.env.SLOW_TESTS || !existsSync(REAL_GPX))(
    'all three totals within 120 s of 11:45 and NP ordering optimistic <= expected <= pessimistic',
    () => {
      const cfg: Config = applyDefaults({
        race_date: '2026-06-13',
        start_time: '04:22',
        gpx_path: REAL_GPX,
        ftp: 272,
        n_riders: 12,
        target_total_hm: '11:45',
        stops: [
          { control: 'Gränna', km: 77, minutes: 10 },
          { control: 'Fagerhult', km: 134, minutes: 10 },
          { control: 'Boviken', km: 226, minutes: 15 },
          { control: 'Askersund', km: 256, minutes: 15 },
        ],
      });

      const micro = ingestGpxString(readFileSync(REAL_GPX, 'utf8'), cfg);

      // Simple single-cell field roughly centred on the course bounding box
      // (lat 57.78..58.89, lon 14.10..15.16). A single cell is acceptable for
      // the smoke (spec 9.5 / task B). Light westerly so the field is realistic.
      const field: EnsembleField = {
        cells: [
          {
            time_iso: '2026-06-13T08:00:00Z',
            lat: 58.3,
            lon: 14.6,
            windspeed_mean_ms: 5,
            winddir_from_deg: 270, // from the west
            windspeed_p10_ms: 2,
            windspeed_p90_ms: 8,
            temp_c: 14,
            pressure_pa: 101325,
            n_sources: 3,
          },
        ],
        sources: ['a', 'b', 'c'],
        reduced: false,
      };

      const three = solveThreeScenarios(micro, field, cfg);
      const target = 42300; // 11:45

      // ---- Diagnostic output (always printed) ----
      for (const k of ['optimistic', 'expected', 'pessimistic'] as const) {
        const p = three[k];
        const hm = `${Math.floor(p.total_time_s / 3600)}:${String(
          Math.floor((p.total_time_s % 3600) / 60),
        ).padStart(2, '0')}`;

        console.log(
          `[real scenarios] ${k.padEnd(12)} np=${p.np_target_used.toFixed(1)} W ` +
            `total=${p.total_time_s.toFixed(0)} s (${hm}) ` +
            `delta=${(p.total_time_s - target).toFixed(0)} s reachable=${p.reachable}`,
        );
      }

      // ---- Gates ----
      expect(Math.abs(three.optimistic.total_time_s - target)).toBeLessThanOrEqual(120);
      expect(Math.abs(three.expected.total_time_s - target)).toBeLessThanOrEqual(120);
      expect(Math.abs(three.pessimistic.total_time_s - target)).toBeLessThanOrEqual(120);

      const EPS = 1e-6;
      expect(three.optimistic.np_target_used).toBeLessThanOrEqual(
        three.expected.np_target_used + EPS,
      );
      expect(three.expected.np_target_used).toBeLessThanOrEqual(
        three.pessimistic.np_target_used + EPS,
      );
    },
    // Three full NP-based bisections over ~4760 microsegments. One solve ~35 s.
    200_000,
  );
});
