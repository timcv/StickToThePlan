/**
 * Tests for src/ciq/generate.ts (Task 17): Connect IQ plan-delta data field.
 *
 * These tests are the HARD, TESTED gate per spec 12.5: source generation plus a
 * monotonic lookup table. They do NOT invoke the monkeyc compiler, so they are
 * fast and require neither the SDK nor a network.
 */

import { describe, it, expect } from 'vitest';
import { buildLookupTable, generatePlanDeltaSource } from '../src/ciq/generate.js';
import type { DisplaySegment, PlanResult, Config } from '../src/types.js';

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

/**
 * Four display segments with strictly increasing to_km and eta_s. Only the
 * fields the CIQ generator reads (to_km, eta_s) carry meaningful values; the
 * rest are filled with neutral placeholders so the object type-checks.
 */
function makeDisplaySegments(): DisplaySegment[] {
  const boundaries: Array<{ to_km: number; eta_s: number }> = [
    { to_km: 76.9, eta_s: 9300 },
    { to_km: 134.0, eta_s: 17880 },
    { to_km: 220.5, eta_s: 29400 },
    { to_km: 314.89, eta_s: 42300 },
  ];
  let fromKm = 0;
  return boundaries.map((b, i) => {
    const seg: DisplaySegment = {
      from_km: fromKm,
      to_km: b.to_km,
      distance_m: Math.round((b.to_km - fromKm) * 1000),
      net_height_m: 0,
      avg_grade: 0,
      avg_speed_kmh: 0,
      eta_s: b.eta_s,
      wind_label: 'Med 0 m/s',
      pull_w_low: 200,
      pull_w_high: 250,
      avg_w: 165,
      note: 'JAMN FART',
      micro_indices: [i],
    };
    fromKm = b.to_km;
    return seg;
  });
}

function makePlan(): PlanResult {
  return {
    np_target_used: 165,
    rider_np_ride_w: 165,
    intensity_factor: 165 / 272,
    total_time_s: 42300,
    rolling_time_s: 39300,
    stop_time_s: 3000,
    segments: [],
    stops: [],
    reachable: true,
    notes: [],
  };
}

function makeConfig(): Config {
  // Only start_time is read by the generator; the rest satisfy the type.
  return {
    race_date: '2026-06-13',
    start_time: '04:22',
    gpx_path: 'route.gpx',
    ftp: 272,
    n_riders: 12,
    target_total_hm: '11:45',
    stops: [],
    m: 96,
    cda_pull: 0.32,
    cda_draft: 0.21,
    crr: 0.0045,
    eta: 0.97,
    g: 9.81,
    rho_fallback: 1.2,
    pull_seconds: 45,
    pull_cap_hard: 354,
    pull_cap_soft: 250,
    pull_cap_mult: 1.3,
    max_plan_speed_kmh: 50,
    sustain_if_warn: 0.75,
    climb_threshold: 0.03,
    climb_discount: true,
    watch_target: 'pull',
    k_yaw: 0.04,
    band_pct: 0.05,
    neutral_speed_kmh: 20,
    neutral_distance_km: 1,
    cache_ttl_h: 3,
    ele_smooth_window: 5,
    max_grade: 0.18,
    min_segment_km: 2,
    grade_merge_pct: 0.003,
    styrkort_max_rows: 20,
    solo: false,
    rider_wind_height_m: 1.2,
    forecast_wind_height_m: 10,
    exposure_terrain: 'mixed',
    apply_wind_height_correction: true,
  };
}

// ---------------------------------------------------------------------------
// buildLookupTable
// ---------------------------------------------------------------------------

describe('buildLookupTable', () => {
  it('starts at distance 0, is monotonic non-decreasing, and ends at the final boundary', () => {
    const segs = makeDisplaySegments();
    const table = buildLookupTable(segs, makePlan());

    // Starts with the {0, 0} origin.
    expect(table[0]).toEqual({ distance_m: 0, elapsed_s: 0 });

    // At least 3 entries (origin + boundaries).
    expect(table.length).toBeGreaterThanOrEqual(3);

    // Monotonic non-decreasing in distance, and elapsed never goes backwards.
    for (let i = 1; i < table.length; i++) {
      expect(table[i].distance_m).toBeGreaterThanOrEqual(table[i - 1].distance_m);
      expect(table[i].elapsed_s).toBeGreaterThanOrEqual(table[i - 1].elapsed_s);
    }

    // Last distance equals the final segment boundary in metres.
    const last = table[table.length - 1];
    expect(last.distance_m).toBe(Math.round(314.89 * 1000));
    expect(last.elapsed_s).toBe(42300);
  });

  it('dedupes equal distances keeping the larger elapsed', () => {
    const segs = makeDisplaySegments();
    // Inject a duplicate boundary distance with a smaller elapsed before the
    // real one; the larger elapsed must win and distances stay unique.
    const dup: DisplaySegment = { ...segs[1], eta_s: segs[1].eta_s - 500 };
    const withDup = [segs[0], dup, ...segs.slice(1)];

    const table = buildLookupTable(withDup, makePlan());

    // Distances are strictly increasing after dedupe (no equal neighbours).
    for (let i = 1; i < table.length; i++) {
      expect(table[i].distance_m).toBeGreaterThan(table[i - 1].distance_m);
    }

    // The kept elapsed at the duplicated distance is the larger one.
    const dupDist = Math.round(segs[1].to_km * 1000);
    const entry = table.find((e) => e.distance_m === dupDist);
    expect(entry?.elapsed_s).toBe(segs[1].eta_s);
  });
});

// ---------------------------------------------------------------------------
// generatePlanDeltaSource
// ---------------------------------------------------------------------------

describe('generatePlanDeltaSource', () => {
  const segs = makeDisplaySegments();
  const source = generatePlanDeltaSource(segs, makePlan(), makeConfig());

  it('embeds a Monkey C array literal with the boundary pair values', () => {
    // Origin pair.
    expect(source).toContain('[0,0]');
    // First boundary: 76.9 km -> 76900 m, 9300 s.
    expect(source).toContain('[76900,9300]');
    // Second boundary: 134.0 km -> 134000 m, 17880 s.
    expect(source).toContain('[134000,17880]');
    // Final boundary: 314.89 km -> 314890 m, 42300 s.
    expect(source).toContain('[314890,42300]');
  });

  it('substitutes PLAN_TOTAL_S and START_CLOCK_S with numbers and leaves no placeholders', () => {
    // plan.total_time_s = 42300.
    expect(source).toMatch(/PLAN_TOTAL_S\s*=\s*42300\b/);
    // clockToSeconds("04:22") = 4*3600 + 22*60 = 15720.
    expect(source).toMatch(/START_CLOCK_S\s*=\s*15720\b/);
    // No leftover template placeholders.
    expect(source).not.toContain('/*__');
    expect(source).not.toContain('__*/');
  });

  it('references SimpleDataField and compute', () => {
    expect(source).toContain('SimpleDataField');
    expect(source).toContain('compute');
  });

  it('contains no em dash', () => {
    expect(source).not.toContain(String.fromCharCode(0x2014));
  });
});
