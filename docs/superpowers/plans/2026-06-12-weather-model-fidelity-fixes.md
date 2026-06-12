# Weather Model Fidelity Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three weather-model correctness gaps: date-blind cell matching, flat-averaged net-downwind detection, and four disagreeing default atmospheres.

**Architecture:** Two shared primitives (`nearestCell` for absolute-time cell pick, `raceStartEpochMs` for the absolute start instant) underpin fixes 1 and 2; fix 3 introduces one ISA constant referenced by all fallbacks. All in `packages/core`, plus a one-line wiring change in `apps/web/src/App.tsx`.

**Tech Stack:** TypeScript, Vitest, npm workspaces (core/cli/web/api).

Spec: [docs/superpowers/specs/2026-06-12-weather-model-fidelity-fixes-design.md](../specs/2026-06-12-weather-model-fidelity-fixes-design.md)

Test invocation note: this is an npm repo whose vitest glob matches two dirs; run scoped commands like `npm test -w @stp/core` and `npm run typecheck` (covers api/). Lefthook runs format+lint+test on commit.

---

### Task 1: Unify default atmosphere (Fix 3)

**Goal:** One ISA standard-atmosphere constant replaces four disagreeing calm fallbacks.

**Files:**

- Modify: `packages/core/src/physics.ts` (add constants after `airDensity`)
- Modify: `packages/core/src/planner.ts:41-46` (`calmWeather`)
- Modify: `packages/core/src/weather/ensemble.ts:271-276` (empty-field fallback)
- Modify: `packages/core/src/weather/hourly.ts:83-97` (`buildManualField`)
- Modify: `packages/core/src/config.ts:14` (`rho_fallback`)
- Test: `packages/core/test/physics.test.ts` (or nearest existing physics test)

**Acceptance Criteria:**

- [ ] `STANDARD_ATMOSPHERE = { temp_c: 15, pressure_pa: 101_325 }` and `STANDARD_RHO ≈ 1.2250` exported from physics.ts
- [ ] `calmWeather`, empty-field `WeatherFn`, `buildManualField` all use 15 C / 101325 Pa via the constant
- [ ] `config.ts` default `rho_fallback === STANDARD_RHO`
- [ ] No remaining literal `temp_c: 10` calm fallback or `rho_fallback: 1.2`

**Verify:** `npm test -w @stp/core` → green

**Steps:**

- [ ] **Step 1: Failing test for the constant**

```ts
// packages/core/test/physics.test.ts
import { STANDARD_ATMOSPHERE, STANDARD_RHO, airDensity } from '../src/physics.js';

test('STANDARD_RHO is the ISA standard-atmosphere density', () => {
  expect(STANDARD_ATMOSPHERE).toEqual({ temp_c: 15, pressure_pa: 101_325 });
  expect(STANDARD_RHO).toBeCloseTo(1.225, 3);
  expect(STANDARD_RHO).toBe(airDensity(15, 101_325));
});
```

- [ ] **Step 2: Run, expect FAIL** (`STANDARD_ATMOSPHERE` not exported)

Run: `npm test -w @stp/core -- physics`

- [ ] **Step 3: Add constants to physics.ts** (after `airDensity`, ~line 113)

```ts
/**
 * International Standard Atmosphere reference: the single default used wherever
 * no weather data is available (calm fallbacks, manual field, neutral-segment
 * rho). One value everywhere keeps fallback air density consistent.
 */
export const STANDARD_ATMOSPHERE = { temp_c: 15, pressure_pa: 101_325 } as const;

/** Air density of the standard atmosphere (~1.2250 kg/m^3). */
export const STANDARD_RHO = airDensity(STANDARD_ATMOSPHERE.temp_c, STANDARD_ATMOSPHERE.pressure_pa);
```

- [ ] **Step 4: Repoint `calmWeather`** (planner.ts). Extend the physics import and rewrite the fallback:

```ts
import { airDensity, decomposeWind, STANDARD_ATMOSPHERE } from './physics.js';
```

```ts
export const calmWeather: WeatherFn = () => ({
  windspeed_ms: 0,
  winddir_from_deg: 0,
  temp_c: STANDARD_ATMOSPHERE.temp_c,
  pressure_pa: STANDARD_ATMOSPHERE.pressure_pa,
});
```

- [ ] **Step 5: Repoint empty-field fallback** (ensemble.ts). Add `import { STANDARD_ATMOSPHERE } from '../physics.js';` near the top, then:

```ts
if (cells.length === 0) {
  // Fallback: calm wind at the standard atmosphere
  return (_lat, _lon, _timeS) => ({
    windspeed_ms: 0,
    winddir_from_deg: 0,
    temp_c: STANDARD_ATMOSPHERE.temp_c,
    pressure_pa: STANDARD_ATMOSPHERE.pressure_pa,
  });
}
```

- [ ] **Step 6: Repoint `buildManualField`** (hourly.ts). Add `import { STANDARD_ATMOSPHERE } from '../physics.js';`, then change the cell literal:

```ts
      temp_c: STANDARD_ATMOSPHERE.temp_c,
      pressure_pa: STANDARD_ATMOSPHERE.pressure_pa,
```

- [ ] **Step 7: Repoint `rho_fallback`** (config.ts). Add `import { STANDARD_RHO } from './physics.js';`, then in `DEFAULTS`:

```ts
  rho_fallback: STANDARD_RHO,
```

- [ ] **Step 8: Update any existing test pinning 10 C / 1.2**

Run: `npm test -w @stp/core` then `npm run typecheck`. Search failures for hardcoded `1.2` rho or `temp_c` 10 calm expectations and update to `STANDARD_RHO` / 15.

- [ ] **Step 9: Commit** (only if commits are authorised this session)

```bash
git add packages/core/src/physics.ts packages/core/src/planner.ts packages/core/src/weather/ensemble.ts packages/core/src/weather/hourly.ts packages/core/src/config.ts packages/core/test/physics.test.ts
git commit -m "fix(core): unify calm fallbacks on one ISA standard atmosphere"
```

---

### Task 2: Absolute-time primitives — `raceStartEpochMs` + `nearestCell`

**Goal:** Add the absolute-instant start helper and the absolute-time cell picker both fixes 1 and 2 build on.

**Files:**

- Modify: `packages/core/src/util/time.ts` (add `raceStartEpochMs`, refactor `utcStartClockSeconds`)
- Modify: `packages/core/src/weather/ensemble.ts` (add exported `nearestCell`)
- Test: `packages/core/test/time.test.ts`, `packages/core/test/ensemble.test.ts` (or nearest existing)

**Acceptance Criteria:**

- [ ] `raceStartEpochMs("2026-06-13","06:00","Europe/Stockholm")` === `Date.UTC(2026,5,13,4,0,0)`
- [ ] `utcStartClockSeconds` still returns seconds-of-day, derived from `raceStartEpochMs`
- [ ] `nearestCell` picks the correct-day cell over a same-hour wrong-day duplicate
- [ ] `nearestCell([], ...)` returns `undefined`

**Verify:** `npm test -w @stp/core` → green

**Steps:**

- [ ] **Step 1: Failing tests**

```ts
// packages/core/test/time.test.ts
import { raceStartEpochMs, utcStartClockSeconds } from '../src/util/time.js';

test('raceStartEpochMs returns the absolute UTC instant of a local start', () => {
  // 06:00 Europe/Stockholm in June = 04:00 UTC
  expect(raceStartEpochMs('2026-06-13', '06:00', 'Europe/Stockholm')).toBe(
    Date.UTC(2026, 5, 13, 4, 0, 0),
  );
});

test('utcStartClockSeconds still returns UTC seconds-of-day', () => {
  expect(utcStartClockSeconds('2026-06-13', '06:00', 'Europe/Stockholm')).toBe(4 * 3600);
});
```

```ts
// packages/core/test/ensemble.test.ts
import { nearestCell, type EnsembleCell } from '../src/weather/ensemble.js';

const cell = (time_iso: string): EnsembleCell => ({
  time_iso,
  lat: 58.5,
  lon: 14.5,
  windspeed_mean_ms: 5,
  winddir_from_deg: 270,
  windspeed_p10_ms: 4,
  windspeed_p90_ms: 6,
  temp_c: 15,
  pressure_pa: 101_325,
  n_sources: 1,
});

test('nearestCell disambiguates across days by absolute time', () => {
  const day1 = cell('2026-06-13T06:00:00Z');
  const day2 = cell('2026-06-14T06:00:00Z');
  const q = Date.parse('2026-06-14T05:30:00Z');
  expect(nearestCell([day1, day2], 58.5, 14.5, q)).toBe(day2);
});

test('nearestCell returns undefined for an empty field', () => {
  expect(nearestCell([], 58.5, 14.5, 0)).toBeUndefined();
});
```

- [ ] **Step 2: Run, expect FAIL** (`raceStartEpochMs`/`nearestCell` not exported)

Run: `npm test -w @stp/core -- time ensemble`

- [ ] **Step 3: Add `raceStartEpochMs`, refactor `utcStartClockSeconds`** (time.ts)

```ts
/**
 * Absolute UTC epoch (ms) of a local wall-clock instant ("HH:MM" in timeZone on
 * dateIso). Two-pass offset correction handles a start inside a DST transition.
 */
export function raceStartEpochMs(dateIso: string, hhmm: string, timeZone: string): number {
  const wallAsUtcMs = Date.parse(`${dateIso}T${hhmm.padStart(5, '0')}:00Z`);
  if (Number.isNaN(wallAsUtcMs)) {
    throw new Error(`raceStartEpochMs: invalid date/time "${dateIso}" / "${hhmm}"`);
  }
  let utcMs = wallAsUtcMs - tzOffsetMinutes(wallAsUtcMs, timeZone) * 60_000;
  utcMs = wallAsUtcMs - tzOffsetMinutes(utcMs, timeZone) * 60_000;
  return utcMs;
}

/**
 * Convert a local wall-clock start to UTC seconds since midnight. Weather cells
 * are binned on UTC hours, so the weather clock must run in UTC while ETAs stay
 * in local time.
 * Example: utcStartClockSeconds("2026-06-13", "06:00", "Europe/Stockholm") -> 14400 (04:00 UTC).
 */
export function utcStartClockSeconds(dateIso: string, hhmm: string, timeZone: string): number {
  const d = new Date(raceStartEpochMs(dateIso, hhmm, timeZone));
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
}
```

- [ ] **Step 4: Add `nearestCell`** (ensemble.ts, in the helpers/makeWeatherFn area; `haversine` is already imported)

```ts
/**
 * Pick the cell best matching a query point and absolute instant. Spatial score
 * uses haversine; temporal score is ABSOLUTE milliseconds (not hour-of-day), so
 * cells are disambiguated across days: a ride past UTC midnight matches the
 * correct day rather than the same hour on the wrong day. Returns undefined for
 * an empty field.
 */
export function nearestCell(
  cells: EnsembleCell[],
  lat: number,
  lon: number,
  queryEpochMs: number,
): EnsembleCell | undefined {
  if (cells.length === 0) return undefined;
  const SPACE_REF_M = 100_000;
  const TIME_REF_H = 12;
  let best = cells[0];
  let bestScore = Infinity;
  for (const cell of cells) {
    const distM = haversine({ lat, lon }, { lat: cell.lat, lon: cell.lon });
    const dtH = Math.abs(Date.parse(cell.time_iso) - queryEpochMs) / 3_600_000;
    const score = distM / SPACE_REF_M + dtH / TIME_REF_H;
    if (score < bestScore) {
      bestScore = score;
      best = cell;
    }
  }
  return best;
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `npm test -w @stp/core -- time ensemble`

- [ ] **Step 6: Commit** (only if authorised)

```bash
git add packages/core/src/util/time.ts packages/core/src/weather/ensemble.ts packages/core/test/time.test.ts packages/core/test/ensemble.test.ts
git commit -m "feat(core): add raceStartEpochMs + absolute-time nearestCell"
```

---

### Task 3: Multi-day weather fetch (Fix 1, fetch half)

**Goal:** Fetch `race_date` and the following day so a ride past UTC midnight has wind data for its whole window.

**Files:**

- Modify: `packages/core/src/weather/openMeteo.ts` (add `nextDay`; set `end_date` in the 3 URL builders)
- Test: `packages/core/test/openMeteo.test.ts` (or nearest existing)

**Acceptance Criteria:**

- [ ] `nextDay('2026-06-13') === '2026-06-14'` and `nextDay('2026-06-30') === '2026-07-01'`
- [ ] `buildForecastUrl`, `buildEnsembleUrl`, `buildForecastUrlMulti` emit `start_date=<date>` and `end_date=<nextDay(date)>`
- [ ] `gatherWindSamples` signature unchanged (api/handler.ts + CLI untouched)

**Verify:** `npm test -w @stp/core` → green

**Steps:**

- [ ] **Step 1: Failing test**

```ts
// packages/core/test/openMeteo.test.ts
import {
  nextDay,
  buildForecastUrl,
  buildEnsembleUrl,
  buildForecastUrlMulti,
} from '../src/weather/openMeteo.js';

test('nextDay advances one UTC calendar day, across month end', () => {
  expect(nextDay('2026-06-13')).toBe('2026-06-14');
  expect(nextDay('2026-06-30')).toBe('2026-07-01');
});

test('URL builders fetch race_date through the next day', () => {
  const p = { lat: 58.5, lon: 14.5 };
  for (const url of [
    buildForecastUrl(p, '2026-06-13'),
    buildEnsembleUrl(p, '2026-06-13'),
    buildForecastUrlMulti([p], '2026-06-13'),
  ]) {
    expect(url).toContain('start_date=2026-06-13');
    expect(url).toContain('end_date=2026-06-14');
  }
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -w @stp/core -- openMeteo`

- [ ] **Step 3: Add `nextDay`** (openMeteo.ts, after the URL-builder section header)

```ts
/** UTC calendar date (YYYY-MM-DD) one day after the given date. */
export function nextDay(dateIso: string): string {
  const ms = Date.parse(`${dateIso}T00:00:00Z`);
  return new Date(ms + 86_400_000).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Set `end_date` in all three builders**

In `buildForecastUrl`, `buildEnsembleUrl`, and `buildForecastUrlMulti`, change the `end_date` line from `end_date: date,` to:

```ts
    end_date: nextDay(date),
```

- [ ] **Step 5: Run, expect PASS**

Run: `npm test -w @stp/core -- openMeteo`

- [ ] **Step 6: Commit** (only if authorised)

```bash
git add packages/core/src/weather/openMeteo.ts packages/core/test/openMeteo.test.ts
git commit -m "fix(core): fetch race_date + next day so post-midnight rides have wind"
```

---

### Task 4: Absolute-time matching in `makeWeatherFn` + planner wiring (Fix 1, match half)

**Goal:** Match cells on absolute timestamp (not hour-of-day) so a multi-day field maps each segment to the right day.

**Files:**

- Modify: `packages/core/src/weather/ensemble.ts` (`makeWeatherFn` signature + body uses `nearestCell`)
- Modify: `packages/core/src/planner.ts` (imports; `solveThreeScenarios` uses `raceStartEpochMs`; 3 `makeWeatherFn` call sites)
- Test: `packages/core/test/ensemble.test.ts`

**Acceptance Criteria:**

- [ ] `makeWeatherFn(field, scenario, startEpochMs, favorableWind)` (epoch ms, not seconds-of-day)
- [ ] Querying a cross-midnight elapsed time returns the next-day cell's wind
- [ ] `solveThreeScenarios` passes `raceStartEpochMs(...)` to every `makeWeatherFn`
- [ ] `utcStartClockSeconds` import removed from planner.ts if now unused

**Verify:** `npm test -w @stp/core && npm run typecheck` → green

**Steps:**

- [ ] **Step 1: Failing test (cross-midnight wind pick)**

```ts
// packages/core/test/ensemble.test.ts
import { makeWeatherFn, type EnsembleField, type EnsembleCell } from '../src/weather/ensemble.js';

test('makeWeatherFn matches the next-day cell after UTC midnight', () => {
  const mk = (time_iso: string, dir: number): EnsembleCell => ({
    time_iso,
    lat: 58.5,
    lon: 14.5,
    windspeed_mean_ms: 5,
    winddir_from_deg: dir,
    windspeed_p10_ms: 5,
    windspeed_p90_ms: 5,
    temp_c: 15,
    pressure_pa: 101_325,
    n_sources: 1,
  });
  const field: EnsembleField = {
    cells: [mk('2026-06-13T22:00:00Z', 90), mk('2026-06-14T02:00:00Z', 270)],
    sources: ['x'],
    reduced: true,
  };
  // Start 22:00 UTC on race day; +4h elapsed = 02:00 next day -> the 270 cell.
  const startEpochMs = Date.UTC(2026, 5, 13, 22, 0, 0);
  const wx = makeWeatherFn(field, 'expected', startEpochMs);
  expect(wx(58.5, 14.5, 4 * 3600).winddir_from_deg).toBe(270);
});
```

- [ ] **Step 2: Run, expect FAIL** (old signature took seconds-of-day; type/behavior mismatch)

Run: `npm test -w @stp/core -- ensemble`

- [ ] **Step 3: Rewrite `makeWeatherFn`** (ensemble.ts). Replace the signature param and the cell-selection block; keep the percentile/return block below unchanged.

```ts
export function makeWeatherFn(
  field: EnsembleField,
  scenario: Scenario,
  startEpochMs: number,
  favorableWind = false,
): WeatherFn {
  const { cells } = field;

  if (cells.length === 0) {
    // Fallback: calm wind at the standard atmosphere
    return (_lat, _lon, _timeS) => ({
      windspeed_ms: 0,
      winddir_from_deg: 0,
      temp_c: STANDARD_ATMOSPHERE.temp_c,
      pressure_pa: STANDARD_ATMOSPHERE.pressure_pa,
    });
  }

  const cellCache = new Map<string, EnsembleCell>();

  return (lat: number, lon: number, timeS: number): WindCond => {
    // Absolute UTC instant of this query; cells are matched on absolute time so a
    // multi-day field disambiguates days (memoized per lat|lon|absolute-hour).
    const queryEpochMs = startEpochMs + timeS * 1000;
    const hourIndex = Math.floor(queryEpochMs / 3_600_000);
    const cacheKey = `${lat}|${lon}|${hourIndex}`;
    let bestCell = cellCache.get(cacheKey);
    if (bestCell === undefined) {
      bestCell = nearestCell(cells, lat, lon, queryEpochMs)!;
      cellCache.set(cacheKey, bestCell);
    }

    const pLow = bestCell.windspeed_p10_ms;
    // ... existing percentile selection + return WindCond (unchanged) ...
  };
}
```

Also update the JSDoc above `makeWeatherFn`: the `startClockS` param is now `startEpochMs` (absolute UTC ms of race start); drop the "hour-of-day" / `% 86400` description.

- [ ] **Step 4: Wire `solveThreeScenarios`** (planner.ts). Update imports:

```ts
import { makeWeatherFn, nearestCell } from './weather/ensemble.js';
```

```ts
import { hmToSeconds, raceStartEpochMs } from './util/time.js';
```

Replace the `utcStartS` setup (the `favorableWind` line changes in Task 5):

```ts
const startEpochMs = raceStartEpochMs(cfg.race_date, cfg.start_time, cfg.time_zone);
const favorableWind = routeIsNetDownwind(microsegments, field);

const solveScenario = (scenario: Scenario): PlanResult => {
  const weather = makeWeatherFn(field, scenario, startEpochMs, favorableWind);
  return solveForTargetTime(microsegments, weather, cfg);
};
```

And the two interval re-marches (formerly `utcStartS`):

```ts
    makeWeatherFn(field, 'optimistic', startEpochMs, favorableWind),
```

```ts
    makeWeatherFn(field, 'pessimistic', startEpochMs, favorableWind),
```

- [ ] **Step 5: Run, expect PASS**

Run: `npm test -w @stp/core -- ensemble` then `npm test -w @stp/core` then `npm run typecheck`. Update any existing `makeWeatherFn(...)` test calls still passing seconds-of-day to pass an epoch (`raceStartEpochMs(...)` or `Date.UTC(...)`).

- [ ] **Step 6: Commit** (only if authorised)

```bash
git add packages/core/src/weather/ensemble.ts packages/core/src/planner.ts packages/core/test/ensemble.test.ts
git commit -m "fix(core): match weather cells on absolute time, not hour-of-day"
```

---

### Task 5: `routeIsNetDownwind` weights by ridden hours (Fix 2)

**Goal:** Decide net-downwind from each segment's local wind at its approximate ride time, not a flat field average, so a veering wind no longer flips the percentile mapping.

**Files:**

- Modify: `packages/core/src/planner.ts` (`routeIsNetDownwind` signature + body; one call site in `solveThreeScenarios`)
- Test: `packages/core/test/planner.test.ts` (or nearest existing planner test)

**Acceptance Criteria:**

- [ ] `routeIsNetDownwind(microsegments, field, startEpochMs, totalTimeS)`
- [ ] Returns true when the actually-ridden cells are downwind despite decoy cells (wrong place/time) that would dominate a flat average
- [ ] `solveThreeScenarios` calls it with `raceStartEpochMs(...)` and `hmToSeconds(cfg.target_total_hm)`

**Verify:** `npm test -w @stp/core && npm run typecheck` → green

**Steps:**

- [ ] **Step 1: Failing test (local wind beats flat-average decoys)**

```ts
// packages/core/test/planner.test.ts — uses the un-exported routeIsNetDownwind via solveThreeScenarios,
// OR export routeIsNetDownwind for the test. Prefer a direct test by exporting it.
import { routeIsNetDownwind } from '../src/planner.js';
import type { EnsembleField } from '../src/weather/ensemble.js';
import type { MicroSegment } from '../src/types.js';

test('routeIsNetDownwind uses local ridden-hour wind, not a flat average', () => {
  const seg = (cum: number, bearing: number): MicroSegment =>
    ({
      // minimal shape the function reads: lat, lon, bearing_deg, distance_m, cum_distance_m, neutral
      lat: 58.5,
      lon: 14.5,
      bearing_deg: bearing,
      distance_m: 1000,
      cum_distance_m: cum,
      neutral: false,
    }) as MicroSegment;
  const cell = (time_iso: string, lat: number, dir: number) => ({
    time_iso,
    lat,
    lon: 14.5,
    windspeed_mean_ms: 6,
    winddir_from_deg: dir,
    windspeed_p10_ms: 6,
    windspeed_p90_ms: 6,
    temp_c: 15,
    pressure_pa: 101_325,
    n_sources: 1,
  });
  const startEpochMs = Date.UTC(2026, 5, 13, 18, 0, 0);
  // Route heads east (bearing 90) the whole time; ridden cells have wind FROM 270 (tailwind => downwind).
  const micro = [seg(1000, 90), seg(2000, 90)];
  const field: EnsembleField = {
    cells: [
      cell('2026-06-13T18:00:00Z', 58.5, 270), // ridden, tailwind
      cell('2026-06-13T18:00:00Z', 59.9, 90), // decoy far north, headwind
      cell('2026-06-13T18:00:00Z', 60.0, 90), // decoy far north, headwind
      cell('2026-06-13T18:00:00Z', 60.1, 90), // decoy far north, headwind
    ],
    sources: ['x'],
    reduced: true,
  };
  const totalTimeS = 3600;
  expect(routeIsNetDownwind(micro, field, startEpochMs, totalTimeS)).toBe(true);
});
```

- [ ] **Step 2: Run, expect FAIL** (signature mismatch / not exported)

Run: `npm test -w @stp/core -- planner`

- [ ] **Step 3: Export + rewrite `routeIsNetDownwind`** (planner.ts). Add `export` and the new body:

```ts
export function routeIsNetDownwind(
  microsegments: MicroSegment[],
  field: EnsembleField,
  startEpochMs: number,
  totalTimeS: number,
): boolean {
  if (field.cells.length === 0) return false;
  const fullDist = microsegments.reduce((s, m) => s + m.distance_m, 0);
  if (fullDist <= 0) return false;
  let exposure = 0;
  let total = 0;
  for (const m of microsegments) {
    if (m.neutral) continue;
    // Approximate ride time at this segment (distance-proportional over the whole
    // route incl. neutral + stops); hour-resolution is enough to pick the cell bin.
    const approxElapsedS = (m.cum_distance_m / fullDist) * totalTimeS;
    const cell = nearestCell(field.cells, m.lat, m.lon, startEpochMs + approxElapsedS * 1000);
    if (!cell) continue;
    const delta = ((cell.winddir_from_deg - m.bearing_deg) * Math.PI) / 180;
    exposure += Math.cos(delta) * m.distance_m; // + into wind, - downwind
    total += m.distance_m;
  }
  return total > 0 && exposure < -0.05 * total;
}
```

Remove the old vector-mean-of-all-cells body and the now-unused `field.cells` direction loop.

- [ ] **Step 4: Update the call site** (`solveThreeScenarios`)

```ts
const startEpochMs = raceStartEpochMs(cfg.race_date, cfg.start_time, cfg.time_zone);
const favorableWind = routeIsNetDownwind(
  microsegments,
  field,
  startEpochMs,
  hmToSeconds(cfg.target_total_hm),
);
```

- [ ] **Step 5: Run, expect PASS**

Run: `npm test -w @stp/core -- planner` then `npm test -w @stp/core` then `npm run typecheck`.

- [ ] **Step 6: Commit** (only if authorised)

```bash
git add packages/core/src/planner.ts packages/core/test/planner.test.ts
git commit -m "fix(core): weight net-downwind detection by ridden hours/places"
```

---

### Task 6: Window-aware `summarizeHourly` + web wiring (Fix 1, web no-regression)

**Goal:** Keep the web "hour by hour" display correct now that the field spans ~48h, by resolving each requested hour to its ride-window occurrence.

**Files:**

- Modify: `packages/core/src/weather/hourly.ts` (`summarizeHourly` optional `startEpochMs`)
- Modify: `apps/web/src/App.tsx:126-131` (pass the ref epoch)
- Test: `packages/core/test/hourly.test.ts` (or nearest existing)

**Acceptance Criteria:**

- [ ] `summarizeHourly(field, hours, startEpochMs?)`; without the arg, behavior unchanged
- [ ] With a multi-day field, a requested hour resolves to the cell on the ride-window day, not a vector-mean of both days
- [ ] `App.tsx` passes `raceStartEpochMs(race_date, start_time, cfg.time_zone)`

**Verify:** `npm test -w @stp/core && npm run typecheck` → green

**Steps:**

- [ ] **Step 1: Failing test**

```ts
// packages/core/test/hourly.test.ts
import { summarizeHourly } from '../src/weather/hourly.js';
import type { EnsembleField } from '../src/weather/ensemble.js';

test('summarizeHourly picks the ride-window day for a multi-day field', () => {
  const mk = (time_iso: string, dir: number) => ({
    time_iso,
    lat: 58.5,
    lon: 14.5,
    windspeed_mean_ms: 5,
    winddir_from_deg: dir,
    windspeed_p10_ms: 5,
    windspeed_p90_ms: 5,
    temp_c: 15,
    pressure_pa: 101_325,
    n_sources: 1,
  });
  const field: EnsembleField = {
    cells: [mk('2026-06-13T06:00:00Z', 90), mk('2026-06-14T06:00:00Z', 270)],
    sources: ['x'],
    reduced: true,
  };
  // Ride starts 2026-06-13 20:00 UTC: hour 06 occurs on 2026-06-14 -> the 270 cell.
  const startEpochMs = Date.UTC(2026, 5, 13, 20, 0, 0);
  const [row] = summarizeHourly(field, [6], startEpochMs);
  expect(row.dir_from_deg).toBeCloseTo(270, 0);
});
```

- [ ] **Step 2: Run, expect FAIL** (extra arg ignored; merges both days)

Run: `npm test -w @stp/core -- hourly`

- [ ] **Step 3: Make `summarizeHourly` window-aware** (hourly.ts)

```ts
/**
 * One summary row per requested hour-of-day. With a multi-day field, pass
 * startEpochMs so each hour resolves to its ride-window occurrence (the first
 * matching UTC hour at-or-after the start) instead of vector-meaning both days.
 * Empty hours fall back to the nearest available hour.
 */
export function summarizeHourly(
  field: EnsembleField,
  hours: number[],
  startEpochMs?: number,
): HourlyWind[] {
  if (startEpochMs !== undefined) {
    return hours.map((hour) => {
      // First instant at-or-after start whose UTC hour === hour.
      const startHour = Math.floor(startEpochMs / 3_600_000);
      let idx = startHour;
      while (new Date(idx * 3_600_000).getUTCHours() !== ((hour % 24) + 24) % 24) idx++;
      const targetMs = idx * 3_600_000;
      const matching = field.cells.filter(
        (c) => Math.floor(Date.parse(c.time_iso) / 3_600_000) === idx,
      );
      const cells = matching.length > 0 ? matching : nearestHourCells(field, targetMs);
      if (cells.length === 0) return { hour, dir_from_deg: 0, speed_ms: 0 };
      const { dir, speed } = vectorMean(cells);
      return { hour, dir_from_deg: dir, speed_ms: speed };
    });
  }
  // Legacy hour-of-day path (single-day field)
  const byHour = new Map<number, EnsembleCell[]>();
  for (const c of field.cells) {
    const h = hourOf(c.time_iso);
    const list = byHour.get(h);
    if (list) list.push(c);
    else byHour.set(h, [c]);
  }
  const available = [...byHour.keys()];
  return hours.map((hour) => {
    let cells = byHour.get(hour);
    if (!cells || cells.length === 0) {
      if (available.length === 0) return { hour, dir_from_deg: 0, speed_ms: 0 };
      const nearest = available.reduce((a, b) => (Math.abs(b - hour) < Math.abs(a - hour) ? b : a));
      cells = byHour.get(nearest)!;
    }
    const { dir, speed } = vectorMean(cells);
    return { hour, dir_from_deg: dir, speed_ms: speed };
  });
}

/** Cells in the absolute hour nearest to targetMs (fallback when the exact hour is absent). */
function nearestHourCells(field: EnsembleField, targetMs: number): EnsembleCell[] {
  if (field.cells.length === 0) return [];
  let bestIdx = Math.floor(Date.parse(field.cells[0].time_iso) / 3_600_000);
  let bestDiff = Infinity;
  const target = Math.floor(targetMs / 3_600_000);
  for (const c of field.cells) {
    const idx = Math.floor(Date.parse(c.time_iso) / 3_600_000);
    const diff = Math.abs(idx - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = idx;
    }
  }
  return field.cells.filter((c) => Math.floor(Date.parse(c.time_iso) / 3_600_000) === bestIdx);
}
```

- [ ] **Step 4: Pass the epoch from the web** (App.tsx). Import `raceStartEpochMs` from `@stp/core`, then at the `summarizeHourly` call:

```ts
const off = offsetFor(form);
const utcRows = summarizeHourly(
  f,
  hoursFor(form).map((h) => toUtcHour(h, off)),
  raceStartEpochMs(form.form.race_date, form.form.start_time, cfg.time_zone),
);
```

Confirm `raceStartEpochMs` is exported from `packages/core/src/index.ts` (add to the `util/time` export line if absent).

- [ ] **Step 5: Run, expect PASS + typecheck**

Run: `npm test -w @stp/core -- hourly` then `npm test -w @stp/core` then `npm run typecheck` (covers api/ and web types).

- [ ] **Step 6: Commit** (only if authorised)

```bash
git add packages/core/src/weather/hourly.ts packages/core/src/index.ts apps/web/src/App.tsx packages/core/test/hourly.test.ts
git commit -m "fix(web): keep hour-by-hour wind correct across the multi-day field"
```

---

## Self-Review

- **Spec coverage:** Fix 1 fetch → Task 3; Fix 1 match → Task 4; Fix 1 web no-regression → Task 6; Fix 2 → Task 5; Fix 3 → Task 1; shared primitives → Task 2. All spec sections covered.
- **Type consistency:** `nearestCell(cells, lat, lon, queryEpochMs)`, `raceStartEpochMs(date, hhmm, tz)`, `makeWeatherFn(field, scenario, startEpochMs, favorableWind)`, `routeIsNetDownwind(microsegments, field, startEpochMs, totalTimeS)`, `summarizeHourly(field, hours, startEpochMs?)` — names/arities consistent across tasks.
- **Ordering:** Task 2 before 4/5/6; Task 4 before 5 (shared `startEpochMs` wiring). Task 1 and 3 independent.
- **Test shapes:** the `MicroSegment`/`EnsembleCell` literals in tests are minimal; during execution, cast or fill required fields to satisfy the real types (run typecheck).
