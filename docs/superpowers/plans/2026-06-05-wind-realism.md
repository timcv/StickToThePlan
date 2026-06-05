# Wind Realism Honest Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pacing model's wind handling realistic and honest, effective wind (height + per-segment exposure), vector apparent-wind aero, and a finish-time uncertainty interval, with UX that explains it.

**Architecture:** One engine. Forecast 10m wind is scaled to rider level by a single log-profile factor whose roughness `z0` is global by default and per-segment when baked exposure data is present. The scaled wind feeds the existing per-segment bearing decomposition; the aero force then uses the true apparent-wind vector. The finish-time interval holds the expected-scenario NP fixed and re-marches the route under optimistic/pessimistic wind. Core stays network-free; exposure is baked offline (OSM) and injected as pre-processed data.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` specifiers), pnpm workspaces, Vitest, React 19 + Vite (web). Core in `packages/core`, web in `apps/web`.

**Git policy (repo owner):** Commits require the owner's explicit OK. Each task's final step stages changes and uses a Conventional Commits message; during execution, pause for the owner to approve the commit (or batch-commit on confirmation). Never push/amend without explicit OK.

**Spec:** `docs/superpowers/specs/2026-06-05-wind-realism-design.md`

**Important correction discovered during planning:** the three scenarios (`solveThreeScenarios`) all hit the SAME target time and differ only in anchor NP. So the time interval is NOT "repackage the three scenario times" (they are equal). It is computed by holding the expected NP fixed and re-marching under optimistic/pessimistic wind (Task 5).

---

### Task 1: Config + types for the wind model

**Goal:** Add the configuration fields, the `ExposureClass` type, and the optional segment/micro fields that the later tasks read and write. Behavior unchanged (defaults reproduce today's numbers because `exposure_terrain='mixed'` with no wind is a no-op, and `apply_wind_height_correction` only matters once wiring lands in Task 3).

**Files:**

- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/config.ts`
- Test: `packages/core/tests/config.wind.test.ts` (create)

**Acceptance Criteria:**

- [ ] `Config` has `rider_wind_height_m`, `forecast_wind_height_m`, `exposure_terrain`, `apply_wind_height_correction`, optional `wind_roughness_z0`.
- [ ] Defaults: `rider_wind_height_m=1.2`, `forecast_wind_height_m=10`, `exposure_terrain='mixed'`, `apply_wind_height_correction=true`. `wind_roughness_z0` is NOT defaulted (optional override).
- [ ] `ExposureClass` exported from types and re-exported from `index.ts`.
- [ ] `MicroSegment` gains optional `z0_used?`, `exposure_class?`. `SegmentPlan` gains `raw_windspeed_ms`, `eff_windspeed_ms`, `z0_used`, `exposure_class?`.
- [ ] `applyDefaults({...minimal})` returns the new defaults.

**Verify:** `npx vitest run packages/core/tests/config.wind.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/config.wind.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyDefaults } from '../src/config.js';

describe('wind-model config defaults', () => {
  const base = { gpx_path: 'r.gpx', race_date: '2026-06-13', start_time: '04:22' };

  it('applies the wind-model defaults', () => {
    const cfg = applyDefaults(base);
    expect(cfg.rider_wind_height_m).toBe(1.2);
    expect(cfg.forecast_wind_height_m).toBe(10);
    expect(cfg.exposure_terrain).toBe('mixed');
    expect(cfg.apply_wind_height_correction).toBe(true);
    expect(cfg.wind_roughness_z0).toBeUndefined();
  });

  it('lets raw config override the wind-model fields', () => {
    const cfg = applyDefaults({ ...base, rider_wind_height_m: 10, exposure_terrain: 'open' });
    expect(cfg.rider_wind_height_m).toBe(10);
    expect(cfg.exposure_terrain).toBe('open');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/config.wind.test.ts`
Expected: FAIL (`cfg.rider_wind_height_m` is undefined).

- [ ] **Step 3: Add the type changes**

In `packages/core/src/types.ts`, add near the top (after the `Stop` interface):

```ts
export type ExposureClass =
  | 'open'
  | 'semi_open'
  | 'sheltered'
  | 'forest'
  | 'urban'
  | 'water'
  | 'bridge';
```

In the `Config` interface, add these fields (anywhere in the body):

```ts
  rider_wind_height_m: number; // 1.2: height the cyclist feels wind at
  forecast_wind_height_m: number; // 10: height the forecast wind is given at
  wind_roughness_z0?: number; // optional raw roughness override; else derived from exposure_terrain / per-segment exposure
  exposure_terrain: 'open' | 'mixed' | 'sheltered'; // coarse global openness when no per-segment exposure data
  apply_wind_height_correction: boolean; // false = treat wind as already at rider level (manual "felt" wind)
```

In `MicroSegment`, add:

```ts
  z0_used?: number; // roughness length applied to this segment's wind (set when exposure data present)
  exposure_class?: ExposureClass; // landscape class if known
```

In `SegmentPlan`, add:

```ts
  raw_windspeed_ms: number; // forecast wind magnitude before height/exposure correction
  eff_windspeed_ms: number; // wind magnitude used after correction
  z0_used: number; // roughness applied
  exposure_class?: ExposureClass;
```

- [ ] **Step 4: Add the config defaults**

In `packages/core/src/config.ts`, add to the `DEFAULTS` object:

```ts
  rider_wind_height_m: 1.2,
  forecast_wind_height_m: 10,
  exposure_terrain: 'mixed',
  apply_wind_height_correction: true,
```

(Do NOT add `wind_roughness_z0` to DEFAULTS, it stays optional.) The existing `{ ...DEFAULTS, ...raw }` merge in `applyDefaults` carries them into the returned `Config` automatically.

- [ ] **Step 5: Re-export the type**

In `packages/core/src/index.ts`, add `ExposureClass` to the `export type { ... } from './types.js';` block.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/config.wind.test.ts`
Expected: PASS. Then `npx vitest run packages/core` to confirm nothing else broke (it should not, fields are additive).

- [ ] **Step 7: Stage and commit (await owner OK)**

```bash
git add packages/core/src/types.ts packages/core/src/config.ts packages/core/src/index.ts packages/core/tests/config.wind.test.ts
git commit -m "feat(core): add wind-model config fields and exposure types"
```

---

### Task 2: Height-correction engine (`effective.ts`)

**Goal:** A pure module that converts forecast wind to rider-level wind via the log wind profile, plus the roughness lookups for terrain and exposure class.

**Files:**

- Create: `packages/core/src/weather/effective.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/effective.test.ts` (create)

**Acceptance Criteria:**

- [ ] `heightFactor(z0, riderH=1.2, forecastH=10)` returns `ln(riderH/z0)/ln(forecastH/z0)`, clamped to `[0.15, 1]`.
- [ ] `heightFactor` throws when any of `z0`, `riderH`, `forecastH` ≤ 0.
- [ ] `heightFactor(z0, 10, 10) === 1` (escape hatch).
- [ ] lower `z0` → higher factor (more exposed → more wind).
- [ ] `adjustWindForHeight(w, z0, ...)` = `max(0, w * heightFactor(...))`.
- [ ] `terrainToZ0`: open 0.03, mixed 0.05, sheltered 0.30. `exposureClassToZ0` covers all seven classes; water/bridge give the highest factor, forest/sheltered the lowest.

**Verify:** `npx vitest run packages/core/tests/effective.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/effective.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  heightFactor,
  adjustWindForHeight,
  terrainToZ0,
  exposureClassToZ0,
} from '../src/weather/effective.js';

describe('heightFactor', () => {
  it('reduces wind from 10m to 1.2m over typical roughness', () => {
    const k = heightFactor(0.05, 1.2, 10);
    expect(k).toBeGreaterThan(0.5);
    expect(k).toBeLessThan(0.7);
  });

  it('is 1 when rider height equals forecast height (escape hatch)', () => {
    expect(heightFactor(0.05, 10, 10)).toBeCloseTo(1, 10);
  });

  it('gives more wind (higher factor) over smoother ground', () => {
    expect(heightFactor(0.01, 1.2, 10)).toBeGreaterThan(heightFactor(0.5, 1.2, 10));
  });

  it('is floored at 0.15 and capped at 1', () => {
    expect(heightFactor(2.0, 1.2, 10)).toBe(0.15); // very rough: log ratio below floor
    expect(heightFactor(0.05, 1.2, 10)).toBeLessThanOrEqual(1);
  });

  it('throws on non-positive inputs', () => {
    expect(() => heightFactor(0, 1.2, 10)).toThrow();
    expect(() => heightFactor(0.05, 0, 10)).toThrow();
    expect(() => heightFactor(0.05, 1.2, 0)).toThrow();
  });
});

describe('adjustWindForHeight', () => {
  it('scales wind and never goes negative', () => {
    expect(adjustWindForHeight(6, 0.05, 1.2, 10)).toBeCloseTo(6 * heightFactor(0.05, 1.2, 10), 10);
    expect(adjustWindForHeight(0, 0.05, 1.2, 10)).toBe(0);
  });
});

describe('roughness lookups', () => {
  it('orders terrain openness', () => {
    expect(terrainToZ0('open')).toBeLessThan(terrainToZ0('mixed'));
    expect(terrainToZ0('mixed')).toBeLessThan(terrainToZ0('sheltered'));
  });

  it('makes water/bridge windier than forest/sheltered at rider level', () => {
    const f = (z: number) => heightFactor(z, 1.2, 10);
    expect(f(exposureClassToZ0('water'))).toBeGreaterThan(f(exposureClassToZ0('forest')));
    expect(f(exposureClassToZ0('bridge'))).toBeGreaterThan(f(exposureClassToZ0('sheltered')));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/effective.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the module**

Create `packages/core/src/weather/effective.ts`:

```ts
/**
 * Effective wind: convert forecast wind (given at forecast_wind_height_m, e.g.
 * 10 m) to the wind the cyclist feels (rider_wind_height_m, e.g. 1.2 m) using
 * the neutral logarithmic wind profile. Pure, deterministic, no IO.
 *
 *   U(z) ∝ ln(z / z0)
 *   factor = U(riderH) / U(forecastH) = ln(riderH/z0) / ln(forecastH/z0)
 *
 * z0 is the aerodynamic roughness length (m). Lower z0 (open water, bridges) =>
 * less near-ground slowdown => higher factor. Higher z0 (forest, buildings) =>
 * more shelter => lower factor. The factor is floored at 0.15 because the bare
 * log profile over-shelters tall-roughness classes for a rider on an open road
 * gap, and capped at 1 (rider level is never windier than forecast level here).
 */
import type { ExposureClass } from '../types.js';

const K_FLOOR = 0.15;

export function heightFactor(z0: number, riderH = 1.2, forecastH = 10): number {
  if (!(z0 > 0) || !(riderH > 0) || !(forecastH > 0)) {
    throw new Error(
      `heightFactor: z0, riderH, forecastH must all be > 0 (got z0=${z0}, riderH=${riderH}, forecastH=${forecastH})`,
    );
  }
  const k = Math.log(riderH / z0) / Math.log(forecastH / z0);
  return Math.min(1, Math.max(K_FLOOR, k));
}

export function adjustWindForHeight(
  rawWind_ms: number,
  z0: number,
  riderH = 1.2,
  forecastH = 10,
): number {
  return Math.max(0, rawWind_ms * heightFactor(z0, riderH, forecastH));
}

const TERRAIN_Z0: Record<'open' | 'mixed' | 'sheltered', number> = {
  open: 0.03,
  mixed: 0.05,
  sheltered: 0.3,
};

export function terrainToZ0(terrain: 'open' | 'mixed' | 'sheltered'): number {
  return TERRAIN_Z0[terrain];
}

// Starting values, literature-derived, configurable, NOT calibrated to real rides.
const CLASS_Z0: Record<ExposureClass, number> = {
  water: 0.001,
  bridge: 0.002,
  open: 0.03,
  semi_open: 0.08,
  forest: 0.3,
  urban: 0.4,
  sheltered: 0.5,
};

export function exposureClassToZ0(cls: ExposureClass): number {
  return CLASS_Z0[cls];
}
```

- [ ] **Step 4: Export from index**

In `packages/core/src/index.ts`, add after the `hourly.js` export block:

```ts
export {
  heightFactor,
  adjustWindForHeight,
  terrainToZ0,
  exposureClassToZ0,
} from './weather/effective.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/effective.test.ts`
Expected: PASS.

- [ ] **Step 6: Stage and commit (await owner OK)**

```bash
git add packages/core/src/weather/effective.ts packages/core/src/index.ts packages/core/tests/effective.test.ts
git commit -m "feat(core): add log-profile effective-wind engine"
```

---

### Task 3: Wire height correction into the planner

**Goal:** Apply the effective-wind correction once per effort segment, store raw/effective wind on each segment, and re-baseline the wind-dependent tests that now shift.

**Files:**

- Modify: `packages/core/src/planner.ts`
- Test: `packages/core/tests/planner.effectivewind.test.ts` (create)
- Re-baseline: `packages/core/tests/scenarios.test.ts`, `packages/core/tests/planner.test.ts` (only assertions that depend on absolute wind-affected numbers)

**Acceptance Criteria:**

- [ ] Effort segments scale wind by `adjustWindForHeight` using `resolveZ0(micro, cfg)` before `decomposeWind`, unless `cfg.apply_wind_height_correction === false`.
- [ ] `resolveZ0` = `micro.z0_used ?? cfg.wind_roughness_z0 ?? terrainToZ0(cfg.exposure_terrain)`.
- [ ] Each `SegmentPlan` carries `raw_windspeed_ms`, `eff_windspeed_ms`, `z0_used`, `exposure_class`.
- [ ] Calm route (0 wind) is byte-identical to before (scaling 0 → 0).
- [ ] `apply_wind_height_correction=false` reproduces raw-wind behavior.
- [ ] Existing suites green after re-baseline.

**Verify:** `npx vitest run packages/core/tests/planner.effectivewind.test.ts` → PASS, then `npx vitest run packages/core` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/planner.effectivewind.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runInnerSolve } from '../src/planner.js';
import { applyDefaults } from '../src/config.js';
import type { MicroSegment, WeatherFn } from '../src/types.js';

function flatMicros(n: number): MicroSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    distance_m: 1000,
    cum_distance_m: (i + 1) * 1000,
    grade: 0,
    bearing_deg: 0, // travelling north
    lat: 59,
    lon: 16,
    ele_start_m: 0,
    ele_end_m: 0,
    neutral: false,
  }));
}

// Wind from the north (0 deg) = pure headwind on a northbound segment.
const headwind6: WeatherFn = () => ({
  windspeed_ms: 6,
  winddir_from_deg: 0,
  temp_c: 15,
  pressure_pa: 101325,
});

describe('effective wind in the planner', () => {
  const cfg = applyDefaults({
    gpx_path: 'r.gpx',
    race_date: '2026-06-13',
    start_time: '04:22',
    n_riders: 1,
    target_total_hm: '10:00',
  });

  it('reduces effective headwind below the raw forecast', () => {
    const plan = runInnerSolve(flatMicros(5), 150, headwind6, cfg, 0);
    const seg = plan.segments[0];
    expect(seg.raw_windspeed_ms).toBeCloseTo(6, 6);
    expect(seg.eff_windspeed_ms).toBeLessThan(6);
    expect(seg.eff_windspeed_ms).toBeGreaterThan(0);
    // headwind component equals the effective wind on a head-on segment
    expect(seg.headwind_ms).toBeCloseTo(seg.eff_windspeed_ms, 6);
  });

  it('escape hatch: apply_wind_height_correction=false uses raw wind', () => {
    const raw = applyDefaults({
      gpx_path: 'r.gpx',
      race_date: '2026-06-13',
      start_time: '04:22',
      n_riders: 1,
      target_total_hm: '10:00',
      apply_wind_height_correction: false,
    });
    const plan = runInnerSolve(flatMicros(5), 150, headwind6, raw, 0);
    expect(plan.segments[0].eff_windspeed_ms).toBeCloseTo(6, 6);
  });

  it('calm wind is unchanged (0 -> 0)', () => {
    const calm: WeatherFn = () => ({
      windspeed_ms: 0,
      winddir_from_deg: 0,
      temp_c: 15,
      pressure_pa: 101325,
    });
    const plan = runInnerSolve(flatMicros(3), 150, calm, cfg, 0);
    expect(plan.segments[0].eff_windspeed_ms).toBe(0);
    expect(plan.segments[0].headwind_ms).toBeCloseTo(0, 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/planner.effectivewind.test.ts`
Expected: FAIL (`raw_windspeed_ms` undefined / not applied).

- [ ] **Step 3: Add the imports and `resolveZ0`**

In `packages/core/src/planner.ts`, extend the physics/effective imports:

```ts
import { airDensity, decomposeWind, solveSpeedForPower, yawCdaFactor } from './physics.js';
import { adjustWindForHeight, terrainToZ0 } from './weather/effective.js';
```

Add a helper above `runInnerSolve`:

```ts
/** Roughness length for a segment: per-segment exposure if present, else an
 *  explicit override, else the coarse terrain default. */
function resolveZ0(micro: MicroSegment, cfg: Config): number {
  return micro.z0_used ?? cfg.wind_roughness_z0 ?? terrainToZ0(cfg.exposure_terrain);
}
```

- [ ] **Step 4: Apply the correction in the effort branch**

In `runInnerSolve`, replace the wind block (currently `const { headwind, crosswind } = decomposeWind(w.windspeed_ms, w.winddir_from_deg, micro.bearing_deg);`) with:

```ts
const z0 = resolveZ0(micro, cfg);
const rawW = w.windspeed_ms;
const effW = cfg.apply_wind_height_correction
  ? adjustWindForHeight(rawW, z0, cfg.rider_wind_height_m, cfg.forecast_wind_height_m)
  : rawW;
const { headwind, crosswind } = decomposeWind(effW, w.winddir_from_deg, micro.bearing_deg);
```

In the effort-segment `segments.push({ ... })`, add the four fields:

```ts
      raw_windspeed_ms: rawW,
      eff_windspeed_ms: effW,
      z0_used: z0,
      exposure_class: micro.exposure_class,
```

- [ ] **Step 5: Fill the new fields on the neutral branch**

In the neutral `segments.push({ ... })` (near the top of the loop), add:

```ts
        raw_windspeed_ms: 0,
        eff_windspeed_ms: 0,
        z0_used: resolveZ0(micro, cfg),
        exposure_class: micro.exposure_class,
```

- [ ] **Step 6: Run the new test, then the whole core suite**

Run: `npx vitest run packages/core/tests/planner.effectivewind.test.ts` → PASS
Run: `npx vitest run packages/core`
Expected: `scenarios.test.ts` and any windy `planner.test.ts` assertions on absolute numbers FAIL (wind is now scaled).

- [ ] **Step 7: Re-baseline the shifted assertions**

For each failing assertion:

- If it asserts an **ordering/inequality** (e.g. optimistic NP < pessimistic NP), it still holds, no change.
- If it asserts an **absolute** wind-affected number (NP/time at a given wind), either update the expected value to the newly printed actual, OR, when the test's intent is to check decomposition rather than height, add `apply_wind_height_correction: false` (or `rider_wind_height_m: 10`) to that test's config to preserve the legacy value.
  Add a one-line comment at each changed assertion: `// re-baselined for effective-wind height correction (z0=0.05, k~0.6)`.

Run: `npx vitest run packages/core` → PASS.

- [ ] **Step 8: Stage and commit (await owner OK)**

```bash
git add packages/core/src/planner.ts packages/core/tests/
git commit -m "feat(core): apply effective-wind height correction per segment"
```

---

### Task 4: Vector apparent wind + tailwind clamp

**Goal:** Replace the axial aero magnitude with the true apparent-wind vector and clamp the yaw used for the CdA factor, so crosswind adds drag and strong tailwinds stay numerically safe. Pure head/tailwind is unchanged.

**Files:**

- Modify: `packages/core/src/physics.ts`
- Modify: `packages/core/src/chaingang.ts`
- Modify: `packages/core/src/planner.ts` (pass crosswind through the cap solver)
- Test: `packages/core/tests/physics.apparent.test.ts` (create)

**Acceptance Criteria:**

- [ ] `pedalPower(v, grade, headwind, p, crosswind=0)`: `u=v+headwind`, `vApp=hypot(u,crosswind)`, `fAero=0.5*rho*cda*vApp*u`. `crosswind=0` is byte-identical to today.
- [ ] `yawCdaFactor` clamps |yaw| to ≤ 50°.
- [ ] Pure crosswind raises power vs calm; pure headwind/tailwind unchanged vs legacy.
- [ ] Strong tailwind + crosswind (`u<0`) gives a finite result and a bounded yaw factor (≤ `1 + 0.04*50/10 = 1.2`).
- [ ] `pedalPower` stays strictly increasing in `v` with crosswind present (bisection safe).

**Verify:** `npx vitest run packages/core/tests/physics.apparent.test.ts` → PASS, then `npx vitest run packages/core` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/physics.apparent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pedalPower, yawCdaFactor } from '../src/physics.js';
import type { PhysicsParams } from '../src/types.js';

const p: PhysicsParams = { m: 80, g: 9.81, crr: 0.0045, eta: 0.97, cda: 0.3, rho: 1.2 };

describe('apparent-wind aero', () => {
  it('crosswind=0 reduces to the legacy axial formula', () => {
    // legacy: fAero = 0.5*rho*cda*(v+hw)*|v+hw|
    const v = 8,
      hw = 3;
    const u = v + hw;
    const fGrav = 0; // flat
    const fRoll = p.m * p.g * p.crr;
    const fAero = 0.5 * p.rho * p.cda * u * Math.abs(u);
    const legacy = ((fRoll + fAero) * v) / p.eta;
    expect(pedalPower(v, 0, hw, p, 0)).toBeCloseTo(legacy, 6);
  });

  it('pure crosswind increases required power vs calm', () => {
    const calm = pedalPower(8, 0, 0, p, 0);
    const cross = pedalPower(8, 0, 0, p, 5);
    expect(cross).toBeGreaterThan(calm);
  });

  it('strong tailwind with crosswind is finite and not NaN', () => {
    const power = pedalPower(10, 0, -14, p, 3);
    expect(Number.isFinite(power)).toBe(true);
  });

  it('is strictly increasing in v even with crosswind', () => {
    const a = pedalPower(6, 0, 2, p, 4);
    const b = pedalPower(9, 0, 2, p, 4);
    expect(b).toBeGreaterThan(a);
  });
});

describe('yawCdaFactor clamp', () => {
  it('clamps the yaw angle to 50 degrees', () => {
    // u<0 (strong tailwind) drives atan2 toward 180 deg; must clamp.
    const f = yawCdaFactor(3, -4, 0.04); // atan2(3,-4) ~ 143 deg
    expect(f).toBeLessThanOrEqual(1 + (0.04 * 50) / 10 + 1e-9);
  });

  it('is unchanged for small yaw', () => {
    expect(yawCdaFactor(1, 10, 0.04)).toBeCloseTo(
      1 + (0.04 * ((Math.atan2(1, 10) * 180) / Math.PI)) / 10,
      9,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/physics.apparent.test.ts`
Expected: FAIL (`pedalPower` ignores the 5th arg; clamp not present).

- [ ] **Step 3: Update `pedalPower` and `yawCdaFactor` and `solveSpeedForPower`**

In `packages/core/src/physics.ts`, replace the `pedalPower` body's `vAir`/`fAero` lines and signature:

```ts
export function pedalPower(
  v: number,
  grade: number,
  headwind: number,
  p: PhysicsParams,
  crosswind = 0,
): number {
  const theta = Math.atan(grade);
  const fGrav = p.m * p.g * Math.sin(theta);
  const fRoll = p.m * p.g * Math.cos(theta) * p.crr;
  const u = v + headwind; // axial apparent wind, + into wind
  const vApp = Math.hypot(u, crosswind); // true apparent-wind magnitude
  const fAero = 0.5 * p.rho * p.cda * vApp * u; // magnitude vApp, projected on travel axis, sign from u
  const pWheel = (fGrav + fRoll + fAero) * v;
  return pWheel / p.eta;
}
```

Update `solveSpeedForPower` to accept and forward crosswind:

```ts
export function solveSpeedForPower(
  target: number,
  grade: number,
  headwind: number,
  p: PhysicsParams,
  crosswind = 0,
): number {
  let lo = 0.5;
  let hi = 25;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const pm = pedalPower(mid, grade, headwind, p, crosswind);
    if (Math.abs(pm - target) < 0.01) return mid;
    if (pm < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
```

In `yawCdaFactor`, clamp the degrees:

```ts
export function yawCdaFactor(crosswind: number, vAir: number, kYaw: number): number {
  const yawRad = Math.atan2(crosswind, vAir);
  let yawDeg = (yawRad * 180) / Math.PI;
  const MAX_YAW_DEG = 50; // wind-tunnel-valid range; clamps the u<0 ~180deg blow-up
  yawDeg = Math.max(-MAX_YAW_DEG, Math.min(MAX_YAW_DEG, yawDeg));
  return 1 + (kYaw * Math.abs(yawDeg)) / 10;
}
```

- [ ] **Step 4: Thread crosswind through chaingang**

In `packages/core/src/chaingang.ts`, update `pullPower` and `draftPower` to pass crosswind into `pedalPower`:

```ts
export function pullPower(v, grade, headwind, crosswind, rho, cfg): number {
  return pedalPower(
    v,
    grade,
    headwind,
    buildPullParams(v, headwind, crosswind, rho, cfg),
    crosswind,
  );
}
export function draftPower(v, grade, headwind, crosswind, rho, cfg): number {
  return pedalPower(
    v,
    grade,
    headwind,
    buildDraftParams(v, headwind, crosswind, rho, cfg),
    crosswind,
  );
}
```

(Keep the existing parameter type annotations; only the final `pedalPower(...)` call gains the trailing `crosswind` argument.)

- [ ] **Step 5: Pass crosswind through the planner cap solver**

In `packages/core/src/planner.ts`, `speedAtPull` calls `solveSpeedForPower(capW, grade, headwind, { ...cda })`. Add the trailing crosswind:

```ts
return solveSpeedForPower(
  capW,
  grade,
  headwind,
  {
    m: cfg.m,
    g: cfg.g,
    crr: cfg.crr,
    eta: cfg.eta,
    rho,
    cda,
  },
  crosswind,
);
```

- [ ] **Step 6: Run the new test, then the suite + re-baseline**

Run: `npx vitest run packages/core/tests/physics.apparent.test.ts` → PASS
Run: `npx vitest run packages/core`
Expected: any crosswind-bearing scenario assertions shift slightly (drag now higher in crosswind). Re-baseline absolute values as in Task 3 Step 7; ordering assertions are unaffected. The existing `physics.test.ts` yaw test (increases with crosswind, symmetric) still holds within the ≤50° range; if it probes beyond 50°, adjust it to assert the plateau.

- [ ] **Step 7: Stage and commit (await owner OK)**

```bash
git add packages/core/src/physics.ts packages/core/src/chaingang.ts packages/core/src/planner.ts packages/core/tests/
git commit -m "feat(core): vector apparent-wind aero with yaw clamp"
```

---

### Task 5: Finish-time uncertainty interval + outputs

**Goal:** Compute an honest finish-time interval by holding the expected-scenario NP fixed and re-marching under optimistic/pessimistic wind, then surface it in the tempokort and plan.json.

**Files:**

- Modify: `packages/core/src/planner.ts` (extend `ThreeScenarios`, compute interval in `solveThreeScenarios`)
- Modify: `packages/core/src/output/tempokort.ts` (header line)
- Modify: `packages/core/src/output/planJson.ts` (interval + assumptions)
- Test: `packages/core/tests/uncertainty.test.ts` (create)

**Acceptance Criteria:**

- [ ] `ThreeScenarios` gains `time_uncertainty_s: { expected; low; high; source: 'scenario' }`.
- [ ] `solveThreeScenarios` computes `low`/`high` by `runInnerSolve` at `expected.np_target_used` under optimistic/pessimistic `makeWeatherFn`, with `low = min(.., expected)`, `high = max(.., expected)`.
- [ ] Markdown + HTML show `Beräknad tid H:MM (rimligt spann H:MM–H:MM)`; when `high-low < 60s` show only the point value + "(spann saknas, ett väderscenario)".
- [ ] `plan.json` includes `time_uncertainty_s` and an `assumptions` block.
- [ ] `expected ∈ [low, high]`; a wider ensemble spread yields a wider interval.

**Verify:** `npx vitest run packages/core/tests/uncertainty.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/uncertainty.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { solveThreeScenarios } from '../src/planner.js';
import { applyDefaults } from '../src/config.js';
import type { EnsembleField } from '../src/weather/ensemble.js';
import type { MicroSegment } from '../src/types.js';

function micros(n: number): MicroSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    distance_m: 1000,
    cum_distance_m: (i + 1) * 1000,
    grade: 0,
    bearing_deg: 0,
    lat: 59,
    lon: 16,
    ele_start_m: 0,
    ele_end_m: 0,
    neutral: false,
  }));
}

function field(p10: number, p90: number): EnsembleField {
  return {
    cells: [
      {
        time_iso: '2026-06-13T04:00:00Z',
        lat: 59,
        lon: 16,
        windspeed_mean_ms: (p10 + p90) / 2,
        winddir_from_deg: 0,
        windspeed_p10_ms: p10,
        windspeed_p90_ms: p90,
        temp_c: 12,
        pressure_pa: 101325,
        n_sources: 3,
      },
    ],
    sources: ['a', 'b', 'c'],
    reduced: false,
  };
}

const cfg = applyDefaults({
  gpx_path: 'r.gpx',
  race_date: '2026-06-13',
  start_time: '04:22',
  n_riders: 1,
  target_total_hm: '0:40',
});

describe('time uncertainty interval', () => {
  it('puts expected inside [low, high]', () => {
    const s = solveThreeScenarios(micros(20), field(2, 8), cfg);
    const u = s.time_uncertainty_s;
    expect(u.source).toBe('scenario');
    expect(u.low).toBeLessThanOrEqual(u.expected + 1);
    expect(u.high).toBeGreaterThanOrEqual(u.expected - 1);
  });

  it('widens with more wind spread', () => {
    const narrow = solveThreeScenarios(micros(20), field(4, 6), cfg).time_uncertainty_s;
    const wide = solveThreeScenarios(micros(20), field(1, 12), cfg).time_uncertainty_s;
    expect(wide.high - wide.low).toBeGreaterThan(narrow.high - narrow.low);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/uncertainty.test.ts`
Expected: FAIL (`time_uncertainty_s` undefined).

- [ ] **Step 3: Extend `ThreeScenarios` and compute the interval**

In `packages/core/src/planner.ts`, extend the interface:

```ts
export interface ThreeScenarios {
  expected: PlanResult;
  optimistic: PlanResult;
  pessimistic: PlanResult;
  time_uncertainty_s: { expected: number; low: number; high: number; source: 'scenario' };
}
```

In `solveThreeScenarios`, replace the final `return { ... }` with:

```ts
const expected = solveScenario('expected');
const optimistic = solveScenario('optimistic');
const pessimistic = solveScenario('pessimistic');

// Time interval: hold the expected anchor NP fixed and re-march under the
// optimistic / pessimistic wind. (The three scenarios above all hit the same
// target time and differ in NP, so their times are equal; the honest time
// spread comes from fixing effort and varying wind luck.)
const np = expected.np_target_used;
const lowTime = runInnerSolve(
  microsegments,
  np,
  makeWeatherFn(field, 'optimistic', startClockS, favorableWind),
  cfg,
  startClockS,
).total_time_s;
const highTime = runInnerSolve(
  microsegments,
  np,
  makeWeatherFn(field, 'pessimistic', startClockS, favorableWind),
  cfg,
  startClockS,
).total_time_s;
const expTime = expected.total_time_s;

return {
  expected,
  optimistic,
  pessimistic,
  time_uncertainty_s: {
    expected: expTime,
    low: Math.min(lowTime, expTime),
    high: Math.max(highTime, expTime),
    source: 'scenario',
  },
};
```

- [ ] **Step 4: Render the interval in the tempokort**

In `packages/core/src/output/tempokort.ts`, add a minute formatter near `secondsToHms`:

```ts
/** Duration as H:MM (floored to the minute), for the headline interval. */
function secondsToHm(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Headline estimate + interval, or a point value when the spread is sub-minute. */
function buildEstimateLine(scenarios: ThreeScenarios): string {
  const u = scenarios.time_uncertainty_s;
  if (u.high - u.low < 60) {
    return `Beräknad tid ${secondsToHm(u.expected)} (spann saknas, ett väderscenario)`;
  }
  return `Beräknad tid ${secondsToHm(u.expected)} (rimligt spann ${secondsToHm(u.low)}–${secondsToHm(u.high)})`;
}
```

In `renderMarkdown`, after `lines.push(buildScenarioLine(scenarios));` add:

```ts
lines.push('');
lines.push(buildEstimateLine(scenarios));
lines.push('');
lines.push('_Vind i planen avser effektiv vind vid cyklisten, inte rå prognosvind._');
```

In `renderHtml`, after the `scenarioLine` paragraph add (use `escHtml`):

```ts
const estimateLine = escHtml(buildEstimateLine(scenarios));
// ...inside the returned template, after the <p class="scenarios"> line:
//   <p class="estimate">${estimateLine}</p>
//   <p class="footnote">Vind i planen avser effektiv vind vid cyklisten, inte rå prognosvind.</p>
```

- [ ] **Step 5: Add the interval + assumptions to plan.json**

In `packages/core/src/output/planJson.ts`, inside the returned object of `buildPlanJson`, add:

```ts
    time_uncertainty_s: scenarios.time_uncertainty_s,
    assumptions: {
      rider_wind_height_m: cfg.rider_wind_height_m,
      forecast_wind_height_m: cfg.forecast_wind_height_m,
      exposure_terrain: cfg.exposure_terrain,
      wind_roughness_z0: cfg.wind_roughness_z0 ?? null,
      apply_wind_height_correction: cfg.apply_wind_height_correction,
      aero: 'vector',
    },
```

- [ ] **Step 6: Run the test + suite, re-baseline tempokort snapshot text**

Run: `npx vitest run packages/core/tests/uncertainty.test.ts` → PASS
Run: `npx vitest run packages/core` → fix `tempokort.test.ts` assertions that match the header text (add the new lines to expected output).

- [ ] **Step 7: Stage and commit (await owner OK)**

```bash
git add packages/core/src/planner.ts packages/core/src/output/ packages/core/tests/
git commit -m "feat(core): finish-time uncertainty interval and plan assumptions"
```

---

### Task 6: OSM exposure bake script + committed data

**Goal:** A dev-only Node script that classifies the built-in route's microsegments from OpenStreetMap and writes a committed static exposure file. Run once; the output is the artifact the core loads.

**Files:**

- Create: `scripts/bake-exposure.mjs`
- Create (generated, committed): `data/vatternrundan-exposure.json`
- Create: `packages/core/tests/fixtures/exposure-sample.json` (small fixture for Task 7)

**Acceptance Criteria:**

- [ ] `node scripts/bake-exposure.mjs` reads `data/vatternrundan-315km.gpx`, queries Overpass over the route bbox, and writes `data/vatternrundan-exposure.json`.
- [ ] Output shape: `{ route_id, generated_note, total_km, runs: [{ from_km, to_km, class }] }`, runs covering 0..total_km, classes from the seven `ExposureClass` values.
- [ ] At least one `bridge` run is produced (Vättern has bridge crossings tagged `bridge=yes`).
- [ ] A small hand-written `exposure-sample.json` fixture exists for the loader tests.

**Verify:** `node scripts/bake-exposure.mjs` → prints run count and class histogram; `data/vatternrundan-exposure.json` exists and parses.

**Steps:**

- [ ] **Step 1: Write the bake script**

Create `scripts/bake-exposure.mjs`:

```js
// Dev-only. Classifies the built-in route's microsegments from OpenStreetMap
// and writes a committed static exposure file. NOT run at solve time.
// Usage: node scripts/bake-exposure.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const GPX = 'data/vatternrundan-315km.gpx';
const OUT = 'data/vatternrundan-exposure.json';
const ROUTE_ID = 'vatternrundan-315km';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

// --- parse trackpoints from GPX (regex is fine for a one-off dev script) ---
function parsePoints(xml) {
  const pts = [];
  const re = /<trkpt[^>]*lat="([\d.-]+)"[^>]*lon="([\d.-]+)"/g;
  let m;
  while ((m = re.exec(xml))) pts.push({ lat: +m[1], lon: +m[2] });
  return pts;
}

function haversine(a, b) {
  const R = 6371000,
    toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat),
    dLon = toR(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// --- Overpass: forests, water, residential, bridges within the bbox ---
async function fetchFeatures(bbox) {
  const q = `[out:json][timeout:120];
(
  way["natural"="wood"](${bbox});
  way["landuse"="forest"](${bbox});
  way["natural"="water"](${bbox});
  way["landuse"="residential"](${bbox});
  way["landuse"="industrial"](${bbox});
  way["bridge"="yes"](${bbox});
);
out geom;`;
  const res = await fetch(OVERPASS, { method: 'POST', body: q });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return (await res.json()).elements ?? [];
}

function classOf(el) {
  const t = el.tags ?? {};
  if (t.bridge === 'yes') return 'bridge';
  if (t.natural === 'water') return 'water';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'forest';
  if (t.landuse === 'residential' || t.landuse === 'industrial') return 'urban';
  return null;
}

// ray-casting point-in-polygon on a way's geometry (lon=x, lat=y)
function inPoly(pt, geom) {
  let inside = false;
  for (let i = 0, j = geom.length - 1; i < geom.length; j = i++) {
    const xi = geom[i].lon,
      yi = geom[i].lat,
      xj = geom[j].lon,
      yj = geom[j].lat;
    const hit =
      yi > pt.lat !== yj > pt.lat && pt.lon < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function classifyPoint(pt, polys) {
  // priority: bridge > water > forest > urban; default semi_open
  const order = ['bridge', 'water', 'forest', 'urban'];
  for (const cls of order) {
    for (const poly of polys) {
      if (poly.cls === cls && poly.geom.length > 2 && inPoly(pt, poly.geom)) return cls;
    }
  }
  return 'semi_open';
}

function toRuns(perSegClass, cumKm) {
  const runs = [];
  let start = 0;
  for (let i = 1; i <= perSegClass.length; i++) {
    if (i === perSegClass.length || perSegClass[i] !== perSegClass[start]) {
      runs.push({
        from_km: +cumKm[start].toFixed(3),
        to_km: +cumKm[i].toFixed(3),
        class: perSegClass[start],
      });
      start = i;
    }
  }
  return runs;
}

const xml = readFileSync(GPX, 'utf8');
const pts = parsePoints(xml);
if (pts.length < 2) throw new Error('no trackpoints');

const lats = pts.map((p) => p.lat),
  lons = pts.map((p) => p.lon);
const bbox = `${Math.min(...lats)},${Math.min(...lons)},${Math.max(...lats)},${Math.max(...lons)}`;
console.log(`points=${pts.length} bbox=${bbox}`);

const polys = (await fetchFeatures(bbox))
  .map((el) => ({ cls: classOf(el), geom: el.geometry ?? [] }))
  .filter((p) => p.cls && p.geom.length > 2);
console.log(`polygons=${polys.length}`);

// cumulative km at each segment boundary; classify each segment midpoint
const cumKm = [0];
const perSeg = [];
for (let i = 0; i < pts.length - 1; i++) {
  const mid = { lat: (pts[i].lat + pts[i + 1].lat) / 2, lon: (pts[i].lon + pts[i + 1].lon) / 2 };
  perSeg.push(classifyPoint(mid, polys));
  cumKm.push(cumKm[i] + haversine(pts[i], pts[i + 1]) / 1000);
}

const runs = toRuns(perSeg, cumKm);
const hist = perSeg.reduce((h, c) => ((h[c] = (h[c] ?? 0) + 1), h), {});
console.log('class histogram', hist, 'runs', runs.length);

writeFileSync(
  OUT,
  JSON.stringify(
    {
      route_id: ROUTE_ID,
      generated_note:
        'OSM/Overpass bake; classes literature-mapped to z0 in core/weather/effective.ts',
      total_km: +cumKm[cumKm.length - 1].toFixed(3),
      runs,
    },
    null,
    2,
  ),
);
console.log(`wrote ${OUT}`);
```

- [ ] **Step 2: Run the bake (manual, network)**

Run: `node scripts/bake-exposure.mjs`
Expected: prints `points=...`, `polygons=...`, a class histogram including a non-zero `bridge`, and `wrote data/vatternrundan-exposure.json`. If Overpass rate-limits, wait and retry (one-off).

- [ ] **Step 3: Write the loader test fixture**

Create `packages/core/tests/fixtures/exposure-sample.json`:

```json
{
  "route_id": "test-route",
  "generated_note": "fixture",
  "total_km": 4,
  "runs": [
    { "from_km": 0, "to_km": 1, "class": "open" },
    { "from_km": 1, "to_km": 2, "class": "forest" },
    { "from_km": 2, "to_km": 3, "class": "bridge" },
    { "from_km": 3, "to_km": 4, "class": "water" }
  ]
}
```

- [ ] **Step 4: Stage and commit (await owner OK)**

```bash
git add scripts/bake-exposure.mjs data/vatternrundan-exposure.json packages/core/tests/fixtures/exposure-sample.json
git commit -m "feat(data): bake OSM exposure for the built-in route"
```

---

### Task 7: Exposure loader, apply-to-microsegments, data quality

**Goal:** Pure core functions to load the baked runs, stamp each microsegment with its exposure class and `z0`, and report exposure coverage. This is what makes `z0` per-segment instead of global.

**Files:**

- Create: `packages/core/src/weather/exposure.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/planner.ts` (attach `data_quality` to `ThreeScenarios`)
- Test: `packages/core/tests/exposure.test.ts` (create)

**Acceptance Criteria:**

- [ ] `ExposureRuns` type + `applyExposure(micros, runs)` sets `exposure_class` and `z0_used = exposureClassToZ0(class)` on each microsegment whose cumulative-distance midpoint falls in a run.
- [ ] `exposureCoveragePct(micros)` = % of distance with an `exposure_class` set.
- [ ] Missing/empty runs leave microsegments untouched and never throw (fallback to global z0 happens naturally in `resolveZ0`).
- [ ] `ThreeScenarios` gains optional `data_quality?: { exposureCoveragePct; exposureSource; weatherSource }`; `solveThreeScenarios` sets `exposureCoveragePct` from the microsegments.

**Verify:** `npx vitest run packages/core/tests/exposure.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/exposure.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyExposure, exposureCoveragePct, type ExposureRuns } from '../src/weather/exposure.js';
import { exposureClassToZ0 } from '../src/weather/effective.js';
import type { MicroSegment } from '../src/types.js';

function micros(n: number, segKm = 0.5): MicroSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    distance_m: segKm * 1000,
    cum_distance_m: (i + 1) * segKm * 1000,
    grade: 0,
    bearing_deg: 0,
    lat: 59,
    lon: 16,
    ele_start_m: 0,
    ele_end_m: 0,
    neutral: false,
  }));
}

const runs: ExposureRuns = JSON.parse(
  readFileSync(new URL('./fixtures/exposure-sample.json', import.meta.url), 'utf8'),
);

describe('applyExposure', () => {
  it('stamps class and z0 from the runs', () => {
    const m = micros(8); // 8 * 0.5 km = 4 km, matches the fixture
    applyExposure(m, runs);
    // midpoint of segment 0 is at 0.25 km -> "open"
    expect(m[0].exposure_class).toBe('open');
    expect(m[0].z0_used).toBeCloseTo(exposureClassToZ0('open'), 9);
    // a segment around 2.75 km -> "bridge"
    const bridgeSeg = m.find((s) => s.exposure_class === 'bridge');
    expect(bridgeSeg).toBeDefined();
  });

  it('full coverage when runs span the route', () => {
    const m = micros(8);
    applyExposure(m, runs);
    expect(exposureCoveragePct(m)).toBeCloseTo(100, 3);
  });

  it('empty runs are a no-op', () => {
    const m = micros(4);
    applyExposure(m, { route_id: 'x', total_km: 0, runs: [] });
    expect(m[0].exposure_class).toBeUndefined();
    expect(exposureCoveragePct(m)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/exposure.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write the module**

Create `packages/core/src/weather/exposure.ts`:

```ts
/**
 * Per-segment exposure: map baked land-cover runs onto microsegments so the
 * effective-wind engine can use a per-segment roughness. Pure, no IO. The
 * baked file is produced offline by scripts/bake-exposure.mjs and injected by
 * the app/CLI layer (core never fetches it).
 */
import type { MicroSegment, ExposureClass } from '../types.js';
import { exposureClassToZ0 } from './effective.js';

export interface ExposureRun {
  from_km: number;
  to_km: number;
  class: ExposureClass;
}
export interface ExposureRuns {
  route_id: string;
  total_km: number;
  runs: ExposureRun[];
  generated_note?: string;
}

/** Stamp exposure_class + z0_used on each microsegment by its midpoint km. */
export function applyExposure(micros: MicroSegment[], data: ExposureRuns): void {
  if (!data?.runs?.length) return;
  for (const m of micros) {
    const midKm = (m.cum_distance_m - m.distance_m / 2) / 1000;
    const run = data.runs.find((r) => midKm >= r.from_km && midKm < r.to_km);
    if (run) {
      m.exposure_class = run.class;
      m.z0_used = exposureClassToZ0(run.class);
    }
  }
}

/** Percent of total distance that carries an exposure_class. */
export function exposureCoveragePct(micros: MicroSegment[]): number {
  let total = 0;
  let covered = 0;
  for (const m of micros) {
    total += m.distance_m;
    if (m.exposure_class) covered += m.distance_m;
  }
  return total > 0 ? (covered / total) * 100 : 0;
}
```

- [ ] **Step 4: Export and add `data_quality`**

In `packages/core/src/index.ts` add:

```ts
export {
  applyExposure,
  exposureCoveragePct,
  type ExposureRun,
  type ExposureRuns,
} from './weather/exposure.js';
```

In `packages/core/src/planner.ts`, extend `ThreeScenarios`:

```ts
  data_quality?: {
    exposureCoveragePct: number;
    exposureSource: 'baked' | 'fetched' | 'terrain' | 'none';
    weatherSource: 'manual' | 'forecast' | 'ensemble';
  };
```

Add `exposureCoveragePct` to the returned object in `solveThreeScenarios` (import `exposureCoveragePct` at top):

```ts
    data_quality: {
      exposureCoveragePct: exposureCoveragePct(microsegments),
      exposureSource: microsegments.some((m) => m.exposure_class) ? 'baked' : 'terrain',
      weatherSource: field.sources.includes('manual') ? 'manual' : 'forecast',
    },
```

- [ ] **Step 5: Run the test + suite**

Run: `npx vitest run packages/core/tests/exposure.test.ts` → PASS
Run: `npx vitest run packages/core` → PASS (data_quality is additive; existing tests unaffected).

- [ ] **Step 6: Stage and commit (await owner OK)**

```bash
git add packages/core/src/weather/exposure.ts packages/core/src/index.ts packages/core/src/planner.ts packages/core/tests/exposure.test.ts
git commit -m "feat(core): per-segment exposure loader and coverage reporting"
```

---

### Task 8: Web UX honesty

**Goal:** Surface effective wind, exposure, the time interval, the manual-wind reference toggle, tooltips, and the coarse terrain / opt-in-fetch advanced settings, all in Swedish, following existing component patterns.

**Files (follow existing patterns; read each before editing):**

- Modify: `apps/web/src/components/SummaryCard.tsx` (interval)
- Modify: `apps/web/src/components/WeatherPanel.tsx` (manual `10m`/`felt` toggle + helptext)
- Modify: `apps/web/src/components/TempokortTable.tsx` (effective wind label + exposure column + segment detail)
- Modify: `apps/web/src/components/UploadForm.tsx` (advanced: terrain selector, "Visa spann", "Hämta exponering")
- Modify: `apps/web/src/lib/pipeline.ts` (thread `apply_wind_height_correction`, `exposure_terrain`, exposure runs into the solve; expose `time_uncertainty_s` + `data_quality` on `PipelineResult`)
- Modify: `apps/web/src/lib/weather/*` (opt-in `fetchExposureForRoute`)
- Test: `apps/web/tests/SummaryCard.interval.test.tsx`, `apps/web/tests/WeatherPanel.toggle.test.tsx` (create)

**Acceptance Criteria:**

- [ ] Finish time renders as a range when `scenarios.time_uncertainty_s.high - low ≥ 60`, else the point value.
- [ ] Wind shown to the user is effective wind; segment detail shows `Prognos X,X m/s → Effektiv Y,Y m/s (−Z%, orsak)` and the exposure label.
- [ ] Manual wind has a clear `10 m prognosvind` vs `vinden jag känner på vägen` toggle (default felt); choosing felt sets `apply_wind_height_correction=false`.
- [ ] InfoTip tooltips exist for effektiv vind, NP, IF, cap, spann.
- [ ] Advanced settings: terrain selector (Öppet/Blandat/Skyddat → `exposure_terrain`), "Visa spann" toggle, "Hämta exponering för rutten" button (opt-in; runs in the app layer, caches result, injects as exposure runs).
- [ ] Exposure labels in Swedish per the spec table.

**Verify:** `npm run dev -w @stp/web`, solve with manual wind 6 m/s felt → finish time unchanged vs raw; switch to 10m → time increases; `npx vitest run apps/web` → PASS. Capture a preview screenshot of the summary + a segment detail.

**Steps:**

- [ ] **Step 1: Read the components and pipeline** so edits match the existing JSX/hook patterns:
      `apps/web/src/components/{SummaryCard,WeatherPanel,TempokortTable,UploadForm}.tsx`, `apps/web/src/lib/pipeline.ts`, `apps/web/src/lib/format.ts`, and the InfoTip component.

- [ ] **Step 2: SummaryCard interval (write test first)**

Create `apps/web/tests/SummaryCard.interval.test.tsx` asserting that when `time_uncertainty_s` spans ≥ 60 s the rendered text contains "spann", and when the spread is sub-minute it does not. Then update `SummaryCard.tsx`: read `scenarios.time_uncertainty_s` and render, next to `secondsToHMM(expected.total_time_s)`, a `rimligt spann {low}–{high}` line using a minute formatter; when `high-low < 60` render `(spann saknas)` instead. Keep the existing FTP warning.

- [ ] **Step 3: Manual-wind toggle (write test first)**

Create `apps/web/tests/WeatherPanel.toggle.test.tsx` asserting the toggle renders both options and that selecting "vinden jag känner" yields `apply_wind_height_correction=false` in the pipeline input the panel produces. Then add the radio + one-line helptext to `WeatherPanel.tsx` (manual mode only):

```
Vinden jag angav är:
( ) 10 m prognosvind   ( ) vinden jag känner på vägen
Hjälptext: "Väderprognoser anger vind på 10 meters höjd. Vid marken känner du mindre. Välj '10 m' om du tog siffran från en prognos, annars 'vinden jag känner'."
```

- [ ] **Step 4: Pipeline wiring**

In `apps/web/src/lib/pipeline.ts`: extend `PipelineForm`/`PipelineInput` with `exposure_terrain`, `apply_wind_height_correction`, optional `exposureRuns`; before solving, if `exposureRuns` present call `applyExposure(microsegments, exposureRuns)`; set `cfg.exposure_terrain` / `cfg.apply_wind_height_correction`. Add `time_uncertainty_s` and `data_quality` to `PipelineResult` (read off the `ThreeScenarios`). For the built-in route, load `data/vatternrundan-exposure.json` (Vite `?url`/`import`) and pass it as `exposureRuns`.

- [ ] **Step 5: TempokortTable effective wind + exposure**

Use `seg.eff_windspeed_ms`/`seg.exposure_class` (now on `SegmentPlan`/`DisplaySegment` if propagated; if the display segment doesn't carry them yet, surface from the expected scenario's segments by index). Show the exposure label per row and a detail expander with `Prognos → Effektiv (−Z%, orsak)`.

- [ ] **Step 6: Advanced settings + opt-in fetch**

In `UploadForm.tsx` advanced area add the terrain `<select>` (Öppet/Blandat/Skyddat), a "Visa spann" checkbox, and a "Hämta exponering för rutten" button that calls a new `fetchExposureForRoute(micros)` in `apps/web/src/lib/weather/` (Overpass, app layer, cached in state), feeding `exposureRuns`.

- [ ] **Step 7: Tooltips**

Extend the existing InfoTip usage to add: effektiv vind, NP, IF, cap, spann, with the copy from the spec §15 / ux-copy doc.

- [ ] **Step 8: Verify in the browser + tests**

Run `npm run dev -w @stp/web`; solve manual 6 m/s felt vs 10m and confirm the finish time changes only for 10m; `npx vitest run apps/web` green; capture screenshots.

- [ ] **Step 9: Stage and commit (await owner OK)**

```bash
git add apps/web
git commit -m "feat(web): surface effective wind, exposure, interval and manual-wind toggle"
```

---

### Task 9: Docs, final re-baseline, validation replay, DoD

**Goal:** Update documentation to match the implementation, finish any remaining re-baselining, and add the optional reference-ride replay. Closes the Definition of Done.

**Files:**

- Modify: `docs/calculation-model.md`, `MODELL.md`, `docs/build-report.md`
- Create: `docs/wind-model.md`, `docs/aero-model.md`, `docs/exposure-model.md`, `docs/ux-copy.md`, `docs/validation.md`
- Test (optional): `packages/core/tests/replay.reference.test.ts` (gated by `SLOW_TESTS`)

**Acceptance Criteria:**

- [ ] Docs describe: prognos vs effektiv vind; the log-profile factor + `z0` defaults; the seven exposure classes + fallback (terrain selector, opt-in fetch, baked file); the vector apparent-wind change + clamp; what the time interval means; that this is NOT CFD and `z0` is literature-derived, not calibrated; how to calibrate later from a FIT.
- [ ] `docs/build-report.md` numbers updated for the new defaults (note calm is unchanged; windy shifted), each delta explained.
- [ ] One windy before/after example documented (raw vs effective finish time on the built-in route).
- [ ] Optional replay test: 2026-05-30 reference ride (NP 165 W, 99.8 km, 3.98 h) solved at fixed NP under that day's light wind lands within tolerance, demonstrating the effective-wind path does not break the low-wind power model.
- [ ] `ExposureClass` label table (Swedish) lives in `docs/ux-copy.md`.

**Verify:** `npm run test` → PASS; `npm run typecheck` → PASS; `SLOW_TESTS=1 npx vitest run packages/core/tests/replay.reference.test.ts` → PASS (if added).

**Steps:**

- [ ] **Step 1: Write/refresh the docs** listed above, cross-linking the spec. Keep the honest non-goals prominent (not CFD, z0 not calibrated, exposure sharpens _where_ more than _how much_).

- [ ] **Step 2: Re-baseline `docs/build-report.md`** with the new windy numbers from a fresh built-in solve; keep the calm 11:45 line and annotate it as unchanged.

- [ ] **Step 3: Add the windy before/after** to `docs/validation.md`: run the built-in route once with `apply_wind_height_correction=false` and once true under a representative windy field; record both finish times and the delta.

- [ ] **Step 4 (optional): Reference replay test** under `SLOW_TESTS`, asserting the modelled time at NP 165 W within tolerance of 3.98 h.

- [ ] **Step 5: Full green gate**

Run: `npm run test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 6: Stage and commit (await owner OK)**

```bash
git add docs MODELL.md packages/core/tests
git commit -m "docs: document effective wind, vector aero, exposure and uncertainty"
```

---

## Self-Review

- **Spec coverage:** C1→Task 4; C2→Tasks 1-3; C3→Task 5; C4→Tasks 6-7 (+ web fetch in Task 8); C5→Task 8; C6→Task 9. All spec components covered.
- **Type consistency:** `ExposureClass` (Task 1) used by `effective.ts` (Task 2), `exposure.ts` (Task 7), `SegmentPlan`/`MicroSegment` (Task 1). `time_uncertainty_s` shape identical in `ThreeScenarios` (Task 5), tempokort (Task 5), planJson (Task 5), web (Task 8). `pedalPower(..., crosswind=0)` signature consistent across physics, chaingang, planner (Task 4). `resolveZ0` precedence identical in planner (Task 3) and matches `applyExposure` writing `z0_used` (Task 7).
- **Placeholder scan:** core tasks (1-7) carry complete code; Task 8 (web) gives concrete files + copy + acceptance and instructs reading components first (UI follows existing patterns); Task 9 enumerates exact docs. No TBD/TODO.
- **Re-baseline risk:** flagged explicitly in Tasks 3, 4, 5; ordering assertions unaffected, only absolute wind-affected numbers move.
