import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { MicroSegment, Config } from '../src/types.js';
import { applyDefaults } from '../src/config.js';
import { ingestGpxString } from '../src/ingest/gpx.js';
import { hmToSeconds, secondsToClock } from '../src/util/time.js';
import { calmWeather, solveForTargetTime } from '../src/planner.js';

// ---------------------------------------------------------------------------
// Helper: build a synthetic flat route.
// ~1000 microsegments, each 100 m, grade 0, bearing 90, fixed lat/lon.
// First 10 segments (cum_distance_m < 1000) are the neutral km.
// ---------------------------------------------------------------------------
function buildFlatRoute(n = 1000): MicroSegment[] {
  const segs: MicroSegment[] = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const distance_m = 100;
    cum += distance_m;
    // neutral when the START cum distance (before this segment) is < 1000 m
    const startCum = cum - distance_m;
    segs.push({
      index: i,
      distance_m,
      cum_distance_m: cum,
      grade: 0,
      bearing_deg: 90,
      lat: 58.0,
      lon: 14.5,
      ele_start_m: 100,
      ele_end_m: 100,
      neutral: startCum < 1000,
    });
  }
  return segs;
}

describe('calmWeather', () => {
  it('returns zero wind, 15 C, sea-level pressure', () => {
    const w = calmWeather(58, 14.5, 0);
    expect(w.windspeed_ms).toBe(0);
    expect(w.winddir_from_deg).toBe(0);
    expect(w.temp_c).toBe(15);
    expect(w.pressure_pa).toBe(101325);
  });
});

describe('A) synthetic flat route', () => {
  // NOTE on the target time: a 100 km flat route (1000 x 100 m) cannot be ridden
  // in 2:00. That needs ~50 km/h, which forces a front pull power far above the
  // hard pull cap (pull_cap_hard = ftp = 272 W). Under the cap the fastest
  // sustainable flat speed is ~37 km/h (~2:51 for 100 km), so 2:00 is physically
  // unreachable and would make reachable === false. We use 3:15, which IS
  // reachable, lands np_target around 145 W (comfortably inside [60, ftp]), and
  // properly exercises the outer bisection. The 60 s tolerance is unchanged.
  const TARGET = '3:15';
  const cfg: Config = applyDefaults({
    race_date: '2026-06-13',
    start_time: '04:22',
    gpx_path: 'x',
    ftp: 272,
    n_riders: 12,
    target_total_hm: TARGET,
    stops: [{ control: 'Mid', km: 50, minutes: 10 }],
  });

  const micro = buildFlatRoute(1000);
  // Solve once; the route and cfg are deterministic.
  const plan = solveForTargetTime(micro, calmWeather, cfg);

  it(`solveForTargetTime hits total within 60 s of ${TARGET}`, () => {
    expect(Math.abs(plan.total_time_s - hmToSeconds(TARGET))).toBeLessThanOrEqual(60);
  });

  it('stop_time_s === 600 and rolling_time_s === total - 600', () => {
    expect(plan.stop_time_s).toBe(600);
    expect(plan.rolling_time_s).toBe(plan.total_time_s - 600);
  });

  it('neutral segments have rider_np_w === 0', () => {
    const neutralSegs = plan.segments.filter((s) => s.micro.neutral);
    expect(neutralSegs.length).toBeGreaterThan(0);
    for (const s of neutralSegs) {
      expect(s.rider_np_w).toBe(0);
    }
  });

  it('reachable === true', () => {
    expect(plan.reachable).toBe(true);
  });

  it('stop arrive/depart consistent and depart = arrive + minutes*60', () => {
    expect(plan.stops.length).toBe(1);
    const stop = plan.stops[0];
    expect(stop.control).toBe('Mid');
    expect(stop.depart_s - stop.arrive_s).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// B) REAL GPX block. HARD gates from the spec.
// ---------------------------------------------------------------------------
const REAL_GPX = 'data/vatternrundan-315km.gpx';

describe('B) real GPX (Vatternrundan 315 km)', () => {
  it.skipIf(!existsSync(REAL_GPX))(
    'hits locked race structure with calm wind',
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
      const plan = solveForTargetTime(micro, calmWeather, cfg);

      // Mean rolling speed over non-neutral segments.
      let nonNeutralDist = 0;
      let nonNeutralTime = 0;
      for (const s of plan.segments) {
        if (!s.micro.neutral) {
          nonNeutralDist += s.micro.distance_m;
          nonNeutralTime += s.time_s;
        }
      }
      const meanRollingKmh = (nonNeutralDist / nonNeutralTime) * 3.6;

      // ---- Diagnostic output (always printed) ----
      const totalHm = `${Math.floor(plan.total_time_s / 3600)}:${String(
        Math.floor((plan.total_time_s % 3600) / 60),
      ).padStart(2, '0')}`;

      console.log(
        `[real gpx] np_target_used=${plan.np_target_used.toFixed(1)} W, ` +
          `total_time_s=${plan.total_time_s.toFixed(0)} (${totalHm}), ` +
          `rolling_time_s=${plan.rolling_time_s.toFixed(0)}, ` +
          `stop_time_s=${plan.stop_time_s}, ` +
          `mean_rolling_kmh=${meanRollingKmh.toFixed(2)}, ` +
          `reachable=${plan.reachable}`,
      );

      // ---- Control clock table (SOFT, report only except finish) ----
      const controlTable: Array<{ km: number; clock: string }> = [
        { km: 40, clock: '05:45' },
        { km: 77, clock: '07:12' },
        { km: 105, clock: '08:10' },
        { km: 134, clock: '09:20' },
        { km: 173, clock: '10:41' },
        { km: 204, clock: '11:46' },
        { km: 226, clock: '12:47' },
        { km: 256, clock: '14:04' },
        { km: 284, clock: '15:02' },
        { km: 315, clock: '16:07' },
      ];

      const planClockAtKm = (km: number): { clock: string; etaS: number } => {
        const seg = plan.segments.find((s) => s.micro.cum_distance_m >= km * 1000);
        const etaS = seg ? seg.eta_s : plan.segments[plan.segments.length - 1].eta_s;
        return { clock: secondsToClock(etaS, cfg.start_time), etaS };
      };

      const startS = clockSeconds(cfg.start_time);
      for (const row of controlTable) {
        const { clock, etaS } = planClockAtKm(row.km);
        // Table clock as elapsed seconds from start (all controls are same-day, after start).
        const tableS = clockSeconds(row.clock) - startS;
        const deltaMin = (etaS - tableS) / 60;

        console.log(
          `[control] km ${String(row.km).padStart(3)} plan ${clock} vs table ${row.clock} delta ${deltaMin >= 0 ? '+' : ''}${deltaMin.toFixed(1)} min`,
        );
      }

      // ---- HARD gates ----
      expect(Math.abs(plan.total_time_s - 42300)).toBeLessThanOrEqual(90);
      expect(plan.stop_time_s).toBe(3000);
      expect(Math.abs(plan.rolling_time_s - 39300)).toBeLessThanOrEqual(150);
      expect(plan.reachable).toBe(true);
      expect(plan.np_target_used).toBeGreaterThan(120);
      expect(plan.np_target_used).toBeLessThan(272);
      expect(meanRollingKmh).toBeGreaterThanOrEqual(27.5);
      expect(meanRollingKmh).toBeLessThanOrEqual(30.0);

      // ---- Finish clock HARD gate: within +/- 3 min ----
      const finish = planClockAtKm(315);
      const finishTableS = 42300; // 11:45 from start
      expect(Math.abs(finish.etaS - finishTableS)).toBeLessThanOrEqual(180);
    },
    // The NP-based bisection over ~4760 microsegments is compute-heavy
    // (each effort segment solves a square-wave NP). One full solve is ~35 s;
    // give it generous headroom past the default 5 s.
    120_000,
  );
});

// Small local helper for the test only: clock string to seconds since midnight.
function clockSeconds(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 3600 + m * 60;
}
