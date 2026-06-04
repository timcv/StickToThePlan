# Vätternrundan race-plan calculator, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local TypeScript/Node 22 CLI that turns the course GPX, a historical FIT power ride, and a live multi-source weather forecast into a power-paced race plan (tempokort), a distance-based FIT workout, a course GPX with ETA waypoints, a Connect IQ plan-delta data field, and a machine-readable plan-JSON, holding constant rider NP with caps.

**Architecture:** Pure functional core (physics, chaingang) with no IO, wrapped by IO modules (config, ingest, weather, output). The planner time-marches microsegments and bisects rider NP to hit total time 11:45. Everything regenerates each run from `config.json`. See the authoritative spec: [docs/superpowers/specs/2026-06-03-vatternrundan-raceplan-design.md](../specs/2026-06-03-vatternrundan-raceplan-design.md). Subagents MUST read the relevant spec sections named in each task.

**Tech Stack:** TypeScript (strict, ESM/NodeNext), Node 22.22, Vitest, `@garmin/fitsdk` (FIT read/write), `fast-xml-parser` (GPX), native `fetch` (weather), `monkeyc` 9.1.0 (Connect IQ).

**Formatting rule (whole codebase + output):** never use em dash. Commas or new sentences. Field/API names English, comments may be Swedish.

**Units convention (locked, internal):** distances metres, speeds m/s, wind m/s, angles degrees, power watts, time seconds, temperature Celsius at API boundary then Kelvin in formulas, pressure Pascal. Convert to km/h and clock only at output boundaries.

---

## Locked shared interfaces

These types are the contract between modules. Define in `src/types.ts` (Task 1) and import everywhere. Do not rename fields.

```typescript
// config
export interface Stop { control: string; km: number; minutes: number; }
export interface Config {
  race_date: string;          // "2026-06-13"
  start_time: string;         // "04:22" local race-day time
  gpx_path: string;
  fit_path?: string;          // optional in solo mode
  ftp: number;                // 272
  n_riders: number;           // 12 group, 1 solo
  target_total_hm: string;    // "11:45"
  stops: Stop[];
  m: number;                  // 96 kg
  np_target?: number;         // resolved: from FIT, or 0.60*ftp
  cda_pull: number;           // 0.32
  cda_draft: number;          // 0.21
  crr: number;                // 0.0045
  eta: number;                // 0.97 drivetrain
  g: number;                  // 9.81
  rho_fallback: number;       // 1.2
  pull_seconds: number;       // 45
  pull_cap_hard: number;      // = ftp
  pull_cap_soft: number;      // 0.92*ftp = 250
  climb_threshold: number;    // 0.03 (3%)
  climb_discount: boolean;    // true
  watch_target: 'pull' | 'avg';
  k_yaw: number;              // 0.04 (yields ~8% cda rise at 20 deg yaw)
  band_pct: number;           // 0.05 workout target band +/-5%
  neutral_speed_kmh: number;  // 20
  neutral_distance_km: number;// 1
  cache_ttl_h: number;        // 3
  ele_smooth_window: number;  // 5 (microsegment moving-average window for elevation)
  max_grade: number;          // 0.18 clip implausible gradients
  solo: boolean;              // derived: n_riders === 1
}

// physics
export interface PhysicsParams {
  m: number; g: number; crr: number; eta: number; cda: number; rho: number;
}
export interface WindCond {
  windspeed_ms: number; winddir_from_deg: number; temp_c: number; pressure_pa: number;
}

// ingest
export interface RoutePoint { lat: number; lon: number; ele: number; }
export interface MicroSegment {
  index: number;
  distance_m: number;       // length of this segment
  cum_distance_m: number;   // cumulative distance at segment END
  grade: number;            // decimal, smoothed, clipped
  bearing_deg: number;      // direction of travel 0..360
  lat: number; lon: number; // segment start point, used for weather lookup
  ele_start_m: number; ele_end_m: number;
  neutral: boolean;         // true for km 0..1 neutral block
}
export interface FitPassMetrics {
  duration_s: number; mean_power_w: number; np_w: number; sample_count: number;
  classification: 'long_representative' | 'short_test';
  np_target_candidate: number;
  note: string;             // how the anchor was determined (logged for Tim)
}

// planner
export interface SegmentPlan {
  micro: MicroSegment;
  v_ms: number; speed_kmh: number;
  p_pull_w: number; p_draft_w: number; p_mean_w: number; rider_np_w: number;
  time_s: number; eta_s: number;     // eta_s = seconds from start_time at segment END
  headwind_ms: number; crosswind_ms: number; rho: number;
  cap_binding: 'none' | 'hard' | 'soft';
}
export interface StopPlan { control: string; km: number; minutes: number; arrive_s: number; depart_s: number; }
export interface PlanResult {
  np_target_used: number;
  total_time_s: number; rolling_time_s: number; stop_time_s: number;
  segments: SegmentPlan[];
  stops: StopPlan[];
  reachable: boolean;       // false if target time not sustainable
  notes: string[];          // logged decisions (caps binding sectors, reduced ensemble, etc.)
}

// weather
export interface WindSample {
  time_iso: string; lat: number; lon: number;
  windspeed_ms: number; winddir_from_deg: number; temp_c: number; pressure_pa: number;
  source: string;
}
export type Scenario = 'expected' | 'optimistic' | 'pessimistic';
// A weather provider answers wind at a place and a clock offset (seconds from start) for a scenario.
export type WeatherFn = (lat: number, lon: number, timeS: number) => WindCond;

// segmentation
export interface DisplaySegment {
  from_km: number; to_km: number; town?: string;
  distance_m: number; net_height_m: number; avg_grade: number;
  eta_s: number;                  // at segment end
  wind_label: string;             // e.g. "Mot 6 m/s", "Med 4 m/s", "Sido 5 m/s"
  pull_w_low: number; pull_w_high: number;
  avg_w: number;
  note: string;                   // JÄMN FART, KLÄTTRING, ...
  stop_minutes?: number; depart_s?: number;
  micro_indices: number[];        // microsegments covered
}
```

**Solo mode collapse (spec 2.1, 5.2):** when `config.solo` is true: `f_front = 1.0`, CdA always `cda_pull`, no square wave, rider NP = `P_pedal` directly, `watch_target` defaults to `avg`. Every task that touches physics/chaingang/solver/output must branch on `config.solo`.

---

## File structure

```
package.json, tsconfig.json, vitest.config.ts, .editorconfig
config.json                         # default Vätternrundan group config (committed)
src/
  types.ts                          # locked interfaces above
  util/time.ts                      # "11:45" <-> seconds, start clock + offset -> "HH:MM"
  util/geo.ts                       # haversine, bearing
  config.ts                         # load + validate + defaults + solo derivation
  physics.ts                        # forces, pedalPower, solveSpeedForPower, airDensity, decomposeWind, yaw, NP
  chaingang.ts                      # duty cycle, pull/draft/mean power, rider NP square wave, solo collapse
  ingest/gpx.ts                     # parse, dedup, smooth, microsegments
  ingest/fit.ts                     # power stream, pass metrics, anchor determination
  weather/openMeteo.ts              # forecast + ensemble client
  weather/smhi.ts                   # SMHI point forecast
  weather/metNorway.ts              # MET Norway locationforecast
  weather/ensemble.ts               # normalize + aggregate + scenario providers
  weather/cache.ts                  # read/write .cache/weather-<date>.json, TTL, --offline
  planner.ts                        # inner solve (time march, neutral, caps, stops), outer bisection, 3 scenarios
  segmentation.ts                   # micro -> display segments, step limit, note keywords
  output/tempokort.ts               # markdown + html
  output/fitWorkout.ts              # distance-based FIT workout writer (1000 offset)
  output/course.ts                  # course GPX with ETA waypoints
  output/planJson.ts                # machine-readable plan dump
  ciq/generate.ts                   # render Monkey C source + lookup table, invoke monkeyc
  ciq/PlanDelta.mc.tmpl             # Monkey C template
  cli.ts                            # entry: plan command, flags
tests/                              # mirrors src/, Vitest
ciq/                                # manifest.xml, resources, generated source lands here
output/                             # generated artifacts (gitignored except .gitkeep)
docs/build-report.md               # written last
```

---

### Task 1: Project scaffold and shared types

**Goal:** A buildable, testable TypeScript ESM project with locked shared types and a committed default config.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.editorconfig`
- Create: `src/types.ts` (the locked interfaces above, verbatim)
- Create: `config.json` (the group default), `output/.gitkeep`
- Create: `tests/scaffold.test.ts`

**Acceptance Criteria:**
- [ ] `npm install` succeeds with `@garmin/fitsdk`, `fast-xml-parser`, `typescript`, `vitest`, `tsx`, `@types/node` installed
- [ ] `npx tsc --noEmit` passes (strict mode)
- [ ] `npm test` runs Vitest and the scaffold test passes
- [ ] `src/types.ts` exports every interface in "Locked shared interfaces"

**Verify:** `npm install && npx tsc --noEmit && npm test` → tsc clean, 1 test passing

**Steps:**
- [ ] **Step 1:** `npm init -y`, then set `package.json`: `"type": "module"`, scripts `{ "build": "tsc", "test": "vitest run", "test:watch": "vitest", "start": "tsx src/cli.ts plan", "typecheck": "tsc --noEmit" }`. Install deps:
```bash
npm install @garmin/fitsdk fast-xml-parser
npm install -D typescript tsx vitest @types/node
```
- [ ] **Step 2:** `tsconfig.json`: `target ES2022`, `module NodeNext`, `moduleResolution NodeNext`, `strict true`, `esModuleInterop true`, `resolveJsonModule true`, `outDir dist`, `rootDir .`, `skipLibCheck true`, include `src`, `tests`.
- [ ] **Step 3:** `vitest.config.ts`: default node environment, `globals: false` (import from `vitest`).
- [ ] **Step 4:** Write `src/types.ts` with the locked interfaces above verbatim.
- [ ] **Step 5:** Write `config.json` exactly:
```json
{
  "race_date": "2026-06-13",
  "start_time": "04:22",
  "gpx_path": "data/vatternrundan-315km.gpx",
  "fit_path": "data/23066238193_ACTIVITY.fit",
  "ftp": 272,
  "n_riders": 12,
  "target_total_hm": "11:45",
  "stops": [
    { "control": "Gränna",    "km": 77,  "minutes": 10 },
    { "control": "Fagerhult", "km": 134, "minutes": 10 },
    { "control": "Boviken",   "km": 226, "minutes": 15 },
    { "control": "Askersund", "km": 256, "minutes": 15 }
  ]
}
```
- [ ] **Step 6:** `tests/scaffold.test.ts`: import a type and assert a trivial truth so the runner has one green test.
```typescript
import { describe, it, expect } from 'vitest';
import type { Config } from '../src/types.js';
describe('scaffold', () => {
  it('compiles and runs', () => { const x: Pick<Config, 'ftp'> = { ftp: 272 }; expect(x.ftp).toBe(272); });
});
```
- [ ] **Step 7:** Verify with the command above, then commit: `feat: scaffold typescript project with locked shared types`

---

### Task 2: Config loader with defaults and solo derivation

**Goal:** Load `config.json`, apply all numeric defaults (spec 5.4), derive `solo`, resolve `watch_target`, validate mandatory fields, expand `pull_cap_*` and `np_target` fallback.

**Files:**
- Create: `src/config.ts`, `src/util/time.ts`
- Test: `tests/config.test.ts`, `tests/time.test.ts`

**Acceptance Criteria:**
- [ ] `loadConfig(path)` returns a fully-populated `Config` with every optional field defaulted per spec 5.4
- [ ] `n_riders === 1` sets `solo: true` and `watch_target: 'avg'` (unless explicitly set)
- [ ] Missing `gpx_path`, `race_date`, or `start_time` throws a clear error; `fit_path` may be absent (solo)
- [ ] `pull_cap_hard` defaults to `ftp`, `pull_cap_soft` to `0.92*ftp`, `np_target` left undefined here (resolved by FIT/fallback in planner)
- [ ] `hmToSeconds("11:45") === 42300`, `secondsToClock(42300, "04:22") === "16:07"`

**Verify:** `npx vitest run tests/config.test.ts tests/time.test.ts` → all pass

**Steps:**
- [ ] **Step 1 (RED):** Write `tests/time.test.ts`: `hmToSeconds("11:45")===42300`, `hmToSeconds("0:50")===3000`, `secondsToClock(0,"04:22")==="04:22"`, `secondsToClock(42300,"04:22")==="16:07"`, `clockToSeconds("04:22")===15720`.
- [ ] **Step 2 (GREEN):** `src/util/time.ts`: `hmToSeconds(hm)` splits on `:`, `h*3600+m*60`. `clockToSeconds(hhmm)` same. `secondsToClock(offsetS, startHHMM)` = `(clockToSeconds(start)+offsetS) % 86400` formatted `HH:MM` zero-padded.
- [ ] **Step 3 (RED):** Write `tests/config.test.ts`: loading the committed `config.json` yields `ftp===272`, `cda_pull===0.32`, `pull_cap_soft===250`, `solo===false`, `watch_target==='pull'`, `m===96`, `k_yaw===0.04`. A config with `n_riders:1` and no `fit_path` yields `solo===true`, `watch_target==='avg'`. A config missing `gpx_path` throws.
- [ ] **Step 4 (GREEN):** `src/config.ts`: `loadConfig(path='config.json')` reads JSON, spreads over a `DEFAULTS` object (spec 5.4 table values), computes `solo = n_riders === 1`, sets `watch_target` to provided value else `solo ? 'avg' : 'pull'`, `pull_cap_hard ??= ftp`, `pull_cap_soft ??= round(0.92*ftp)`, validates mandatory fields. Allow per-run override via explicit fields in JSON.
- [ ] **Step 5:** Verify, commit: `feat(config): config loader with defaults and solo derivation`

---

### Task 3: Physics core

**Goal:** Steady-state power model, speed solver, air density, wind decomposition, yaw CdA, NP, all pure, matching spec section 5 sanity values within a few percent.

**Files:**
- Create: `src/physics.ts`, `src/util/geo.ts`
- Test: `tests/physics.test.ts`, `tests/geo.test.ts`

**Acceptance Criteria (spec 5 sanity, solo, rho 1.2, cda 0.32, crr 0.0045, eta 0.97, m 96):**
- [ ] `pedalPower(8.0, 0, 0, p)` (28.8 km/h flat calm) ≈ 135 W within 8%
- [ ] `solveSpeedForPower(270, 0.05, 0, p)` ≈ 17 km/h (4.7 m/s) within 8%
- [ ] `pedalPower(8.0, 0, 5.56, p)` (28.8 km/h, 20 km/h headwind) ≈ 325 W within 10%
- [ ] `decomposeWind(10, 270, 270)` → `{headwind: ~10, crosswind: ~0}`; `decomposeWind(10, 270, 0)` → `{headwind: ~0, crosswind: ~10}` (sign per spec 6.2 check); all four quadrants tested
- [ ] `airDensity(15, 101325)` ≈ 1.225 within 2%; `normalizedPower(steady200)` ≈ 200
- [ ] `solveSpeedForPower` monotonic, converges (bisection on v in [0.5, 25] m/s, tol 0.01 W)

**Verify:** `npx vitest run tests/physics.test.ts tests/geo.test.ts` → all pass

**Steps:**
- [ ] **Step 1 (RED):** `tests/geo.test.ts`: `haversine` Motala-ish two points vs known metres (use two close lat/lon and assert ~expected); `bearing` due-east ≈ 90, due-north ≈ 0.
- [ ] **Step 2 (GREEN):** `src/util/geo.ts`: `haversine(a,b)` standard (R=6371000 m), `bearing(a,b)` returns `(atan2(...)deg+360)%360`.
- [ ] **Step 3 (RED):** `tests/physics.test.ts` with the AC values above. Build `PhysicsParams` `{m:96,g:9.81,crr:0.0045,eta:0.97,cda:0.32,rho:1.2}`.
- [ ] **Step 4 (GREEN):** `src/physics.ts` implement spec section 6 verbatim:
```typescript
export function pedalPower(v: number, grade: number, headwind: number, p: PhysicsParams): number {
  const theta = Math.atan(grade);
  const fGrav = p.m * p.g * Math.sin(theta);
  const fRoll = p.m * p.g * Math.cos(theta) * p.crr;
  const vAir = v + headwind;                 // headwind>0 into wind
  const fAero = 0.5 * p.rho * p.cda * vAir * Math.abs(vAir);
  const pWheel = (fGrav + fRoll + fAero) * v;
  return pWheel / p.eta;
}
export function solveSpeedForPower(target: number, grade: number, headwind: number, p: PhysicsParams): number {
  let lo = 0.5, hi = 25;                      // m/s
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const pm = pedalPower(mid, grade, headwind, p);
    if (Math.abs(pm - target) < 0.01) return mid;
    if (pm < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
```
  `decomposeWind(W, phiFrom, beta)`: `delta=rad(phiFrom-beta); headwind=W*cos(delta); crosswind=W*sin(delta)`. `airDensity(tempC, pPa, rh=0)`: dry `p/(287.058*(tempC+273.15))`, optional humidity via virtual temperature (document the formula). `yawCdaFactor(crosswind, vAir, kYaw)`: `yaw=atan2(crosswind,vAir); 1 + kYaw*abs(degrees(yaw))/10`. `normalizedPower(samples, hz=1)`: 30-sample (30s) rolling mean, then `mean(rolling^4)^0.25`.
- [ ] **Step 5:** Cross-check one `pedalPower` case against gribble.org mentally/comment, verify, commit: `feat(physics): forces, speed solver, air density, wind decomposition, NP`

---

### Task 4: Chaingang model

**Goal:** Duty cycle, pull/draft/mean power, rider-NP square wave, and solo collapse, so the solver can target constant rider NP.

**Files:**
- Create: `src/chaingang.ts`
- Test: `tests/chaingang.test.ts`

**Acceptance Criteria (spec 7, 2.1):**
- [ ] `fFront(12, 45) === 1/12`; `fFront(1, 45) === 1.0`
- [ ] Group: at flat 28.8 km/h, `pullPower > meanPower > draftPower`; `riderNp` > `meanPower` (variability penalty), and draft flat ≈ 90 W per spec 5 sanity
- [ ] Solo (`solo:true`): `riderNpAtSpeed` equals `pedalPower(v; cda_pull)` exactly, no square wave
- [ ] `solveSpeedForRiderNp(163, 0, 0, cfg-group)` returns a speed whose recomputed rider NP ≈ 163 within 0.5 W
- [ ] `riderNp` square wave uses circular 30s rolling over one full cycle (`n_riders*pull_seconds` s)

**Verify:** `npx vitest run tests/chaingang.test.ts` → all pass

**Steps:**
- [ ] **Step 1 (RED):** Write `tests/chaingang.test.ts` for the AC above. For solo, build a `Config` with `solo:true, n_riders:1`.
- [ ] **Step 2 (GREEN):** `src/chaingang.ts`:
  - `fFront(n, pull) = 1/n` (group), 1.0 if n===1.
  - `pullPower(v, grade, headwind, crosswind, rho, cfg)`: base `PhysicsParams` from cfg with `cda = yawCdaFactor*cda_pull`, return `pedalPower`.
  - `draftPower(...)`: same with `cda_draft` (raised toward pull on narrow flag, future). Solo: equals pullPower.
  - `meanPower(pull, draft, fFront) = fFront*pull + (1-fFront)*draft`.
  - `riderNpAtSpeed(v, grade, headwind, crosswind, rho, cfg)`: solo returns `pullPower` (== pedalPower with cda_pull). Group: render per-second array length `n_riders*pull_seconds`, first `pull_seconds` = pullPower, rest = draftPower, apply circular 30s rolling mean, NP formula.
  - `solveSpeedForRiderNp(npTarget, grade, headwind, crosswind, rho, cfg)`: bisection on v in [0.5,25], comparing `riderNpAtSpeed(v,...)` to npTarget.
- [ ] **Step 3:** Verify, commit: `feat(chaingang): duty cycle, pull/draft/mean power, rider NP square wave, solo collapse`

---

### Task 5: GPX ingest

**Goal:** Parse the course GPX, dedup zero-length steps, smooth elevation, build microsegments with distance, bearing, gradient. Conservation: total ≈ 314.89 km.

**Files:**
- Create: `src/ingest/gpx.ts`
- Test: `tests/gpx.test.ts`

**Acceptance Criteria (spec 3, 11):**
- [ ] `parseGpx(VATTERN_GPX)` returns 4820 raw points (each with lat, lon, ele)
- [ ] After dedup, no zero-length consecutive steps remain (54 removed)
- [ ] `sum(microsegment.distance_m) / 1000` ∈ [314.0, 315.5] (target 314.89)
- [ ] Every microsegment has finite `grade` within `[-max_grade, max_grade]`, `bearing_deg` in [0,360)
- [ ] Smoothed cumulative gain < raw gain (smoothing lowers GPS noise; raw ~1597 m)
- [ ] Falls back gracefully: a tiny synthetic 3-point GPX yields 2 microsegments with correct distances

**Verify:** `npx vitest run tests/gpx.test.ts` → all pass. (Test reads the real GPX from `data/vatternrundan-315km.gpx`; guard with `it.skipIf(!existsSync(path))` so CI without the file still passes the synthetic case.)

**Steps:**
- [ ] **Step 1 (RED):** `tests/gpx.test.ts`: synthetic GPX string with 3 trkpts (known coords) → 2 microsegments, distances via haversine. Real-file block under `it.skipIf`: 4820 points, distance in band, dedup count.
- [ ] **Step 2 (GREEN):** `src/ingest/gpx.ts`:
  - `parseGpx(path)`: read file, `XMLParser` (fast-xml-parser, `ignoreAttributes:false`), navigate `gpx.trk.trkseg.trkpt[]`, map `@_lat,@_lon` to numbers and `ele` to number.
  - `dedupePoints(pts)`: drop a point if haversine to previous < 0.5 m.
  - `smoothElevation(eles, window)`: centered moving average, window = `cfg.ele_smooth_window`.
  - `buildMicroSegments(pts, smoothedEle, cfg)`: for each consecutive pair compute `distance_m` (haversine), `bearing_deg`, `grade = clamp((eleEnd-eleStart)/distance_m, -max_grade, max_grade)`, accumulate `cum_distance_m`, set `neutral = cum_distance_m_at_start < neutral_distance_km*1000`. Use segment START lat/lon for weather lookup.
- [ ] **Step 3:** Verify, commit: `feat(ingest): GPX to microsegments with dedup, smoothing, bearing, gradient`

---

### Task 6: FIT ingest and anchor determination

**Goal:** Decode the reference FIT power stream, compute duration, mean, NP, classify, and produce the `np_target` candidate (expect ≈ 165 W from the 2026-05-30 reference). Log how the anchor was determined.

**Files:**
- Create: `src/ingest/fit.ts`
- Test: `tests/fit.test.ts`

**Acceptance Criteria (spec 8, 18.2):**
- [ ] `readFitPower(REF_FIT)` returns a power stream (array of watts) and a sample count of order 14000 (≈3.98 h at 1 Hz)
- [ ] `analyzePass(stream, cfg)` returns `np_w` ≈ 165 W (±5 W), `duration_s` ≈ 14300 (±5%), `classification: 'long_representative'`, `np_target_candidate === np_w`
- [ ] If `fit_path` absent: caller uses `0.60*ftp` (≈163 W); `analyzePass` exposes that path via a `null`-stream branch returning the fallback with a clear `note`
- [ ] `note` explains: long representative ride, NP used directly, 8-rider duty cycle noted vs 12 in plan (spec 8.1)

**Verify:** `npx vitest run tests/fit.test.ts` → pass (real-FIT block under `it.skipIf(!existsSync(REF_FIT))`; synthetic steady-200 W stream always tests `analyzePass`)

**Steps:**
- [ ] **Step 1 (RED):** `tests/fit.test.ts`: synthetic stream `Array(3600).fill(200)` → `np_w` ≈ 200, `mean_power_w` ≈ 200, `classification 'long_representative'`. Real-FIT block: np ≈ 165.
- [ ] **Step 2 (GREEN):** `src/ingest/fit.ts`:
  - `readFitPower(path)`: use `@garmin/fitsdk` `Decoder`/`Stream`. `const stream = Stream.fromByteArray([...fs.readFileSync(path)]); const decoder = new Decoder(stream); const { messages } = decoder.read();` Pull `messages.recordMesgs` and read `power` field per record, filtering null/undefined.
  - `analyzePass(stream, cfg)`: `duration_s = stream.length` (1 Hz), `mean_power_w = mean(stream)`, `np_w = normalizedPower(stream)` (reuse physics). Classify `long_representative` if `duration_s > 7200` (≥2 h steady) else `short_test`. Candidate: long → `np_w`; short → `0.60*ftp`. Build `note`.
- [ ] **Step 3:** Verify, commit: `feat(ingest): FIT power decode, pass metrics, NP anchor determination`

---

### Task 7: Pacing solver without wind

**Goal:** Time-march microsegments at constant rider NP with a fixed neutral start and stops, then bisect `np_target` to hit total 11:45. Calm wind reproduces rolling 10:55 and the control clock times (spec 4.1) within tolerance.

**Files:**
- Create: `src/planner.ts`
- Test: `tests/planner.test.ts`

**Acceptance Criteria (spec 4, 9):**
- [ ] `runInnerSolve(micro, npTarget, calmWeather, cfg, startS)` inserts km 0..1 at `neutral_speed_kmh` (3 min, no NP accounting) and applies stops at their km markers (nearest microsegment boundary)
- [ ] Pull caps: if `pullPower(v) > pull_cap_hard` clamp v down to hard cap; on `grade>climb_threshold` with `climb_discount`, clamp to `pull_cap_soft`; record `cap_binding`
- [ ] `solveForTargetTime(micro, calmWeather, cfg)` bisects `np_target` so `total_time_s` ≈ 42300 (±60 s)
- [ ] Resulting `rolling_time_s` ≈ 39300 (10:55, ±120 s); `stop_time_s === 3000`
- [ ] Control clock at Gränna ≈ 07:12, Boviken ≈ 12:47, finish ≈ 16:07, each within ±6 min (spec 4.1)
- [ ] Per-segment rolling speed (non-neutral) stays ~28.6..29.0 km/h in calm case (spec 4.5), assert mean rolling speed in [28.0, 29.6]
- [ ] If target unreachable sustainably, `reachable:false` and a note; do not crash

**Verify:** `npx vitest run tests/planner.test.ts` → all pass (uses real GPX microsegments under skipIf; a synthetic flat 100 km route always tests the march/bisection/stop logic)

**Steps:**
- [ ] **Step 1 (RED):** `tests/planner.test.ts`: synthetic flat route (1000 microsegments × 100 m, grade 0, bearing 90), calm weather fn returning `{windspeed_ms:0,...,temp_c:15,pressure_pa:101325}`. Assert `solveForTargetTime` hits target total within tol and stop insertion works. Real-GPX block: control clocks within ±6 min, mean rolling speed in band.
- [ ] **Step 2 (GREEN):** `src/planner.ts`:
  - `calmWeather: WeatherFn = () => ({windspeed_ms:0, winddir_from_deg:0, temp_c:15, pressure_pa:101325})`.
  - `runInnerSolve`: iterate microsegments. For neutral segments set `v = neutral_speed_kmh/3.6`, `time_s = distance/v`, no NP fields meaningful (set rider_np_w=0, cap 'none'). For effort segments: lookup wind via WeatherFn at (lat,lon,startS+accumS), compute `rho` via airDensity, `decomposeWind`, `solveSpeedForRiderNp`, then apply hard then soft caps (recompute v at capped pull power via `solveSpeedForPower` with cda_pull). Accumulate time; record SegmentPlan. After building, insert stops: for each stop find segment whose `cum_distance_m` crosses `km*1000`, add `minutes*60` to that boundary and all subsequent `eta_s`. Compute totals.
  - `solveForTargetTime`: resolve `npTarget` start = `cfg.np_target ?? fit candidate ?? 0.60*ftp` (caller passes resolved value; planner accepts explicit `npTarget` for the inner solve). Bisect `np_target` in [60, ftp]: higher NP → faster → less total time (monotone). 40 iterations, tol 30 s. If even at `np_target=ftp` total > target, set `reachable:false`, return fastest.
- [ ] **Step 3:** Verify, commit: `feat(planner): time march with neutral start, caps, stops, bisection to target time`

---

### Task 8: Weather, Open-Meteo client

**Goal:** Fetch multi-model forecast and ensemble wind/temp/pressure from Open-Meteo for the course sample points and race-date hours, normalized to `WindSample[]`.

**Files:**
- Create: `src/weather/openMeteo.ts`
- Test: `tests/openMeteo.test.ts`

**Acceptance Criteria (spec 10.1, 10.2):**
- [ ] `fetchOpenMeteo(points, date, hours)` requests `windspeed_10m, winddirection_10m, temperature_2m, surface_pressure` hourly and returns `WindSample[]` with `source` tags (`open-meteo-forecast`, `open-meteo-ensemble-meanN`)
- [ ] Wind speed converted to m/s (Open-Meteo default km/h → divide by 3.6, or request `windspeed_unit=ms`), direction kept meteorological (from), temp Celsius, pressure hPa → Pa (×100)
- [ ] Network parsing is unit-tested against a saved JSON fixture (no live call in tests); a thin `parseOpenMeteo(json, point)` is the tested seam
- [ ] Live `fetchOpenMeteo` is exercised only behind `it.skipIf(process.env.OFFLINE_TESTS)`

**Verify:** `npx vitest run tests/openMeteo.test.ts` → pass (fixture-based)

**Steps:**
- [ ] **Step 1 (RED):** Save a small Open-Meteo JSON fixture in the test. Test `parseOpenMeteo(fixture, point)` → correct units and counts.
- [ ] **Step 2 (GREEN):** `src/weather/openMeteo.ts`: build URL `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&hourly=windspeed_10m,winddirection_10m,temperature_2m,surface_pressure&windspeed_unit=ms&start_date=..&end_date=..`. Also ensemble endpoint `https://ensemble-api.open-meteo.com/v1/ensemble?...&models=icon_seamless`. `parseOpenMeteo(json, point)` maps `hourly.time[i]` + arrays → `WindSample`. Pressure hPa→Pa. Sample points: reduce the 4820 microsegments to ~10 representative points (every ~30 km) to bound API calls; document this in build report.
- [ ] **Step 3:** Verify, commit: `feat(weather): Open-Meteo forecast and ensemble client`

---

### Task 9: Weather, SMHI and MET Norway clients

**Goal:** Two more independent sources, normalized to the same `WindSample[]`.

**Files:**
- Create: `src/weather/smhi.ts`, `src/weather/metNorway.ts`
- Test: `tests/smhi.test.ts`, `tests/metNorway.test.ts`

**Acceptance Criteria (spec 10.1):**
- [ ] `parseSmhi(json, point)` reads wind speed (m/s, SMHI `ws`), direction (`wd`, from), temp (`t`), pressure (`msl` hPa→Pa) from `timeSeries[].parameters[]`, tagged `smhi`
- [ ] `parseMetNorway(json, point)` reads `instant.details.wind_speed` (m/s), `wind_from_direction`, `air_temperature`, `air_pressure_at_sea_level` (hPa→Pa), tagged `met-norway`
- [ ] MET Norway client sends a descriptive `User-Agent` header (required); asserted by inspecting the request init in a unit test
- [ ] Both tested against saved JSON fixtures; live calls behind `it.skipIf`

**Verify:** `npx vitest run tests/smhi.test.ts tests/metNorway.test.ts` → pass

**Steps:**
- [ ] **Step 1 (RED):** Fixtures for SMHI `point/lon/{lon}/lat/{lat}/data.json` and MET `locationforecast/2.0/compact?lat=..&lon=..`. Test parsers.
- [ ] **Step 2 (GREEN):** Implement both. SMHI endpoint `https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point/lon/{lon}/lat/{lat}/data.json` (round lon/lat to 6 decimals). MET endpoint `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=..&lon=..` with header `User-Agent: StickToThePlan/1.0 vatternrundan-raceplan (https://github.com/timcv/StickToThePlan)`.
- [ ] **Step 3:** Verify, commit: `feat(weather): SMHI and MET Norway clients`

---

### Task 10: Weather ensemble aggregation, cache, offline

**Goal:** Merge all sources into a per-point per-hour ensemble (vector-mean direction), expose scenario providers, cache to disk with TTL and `--offline`.

**Files:**
- Create: `src/weather/ensemble.ts`, `src/weather/cache.ts`
- Test: `tests/ensemble.test.ts`, `tests/cache.test.ts`

**Acceptance Criteria (spec 10.2, 10.4, 9.5):**
- [ ] `buildEnsemble(samples)` groups by (point, hour), averages wind as u/v vector mean → mean speed + from-direction, computes p10/p90 speed, mean temp/pressure, counts sources
- [ ] `makeWeatherFn(field, scenario, microsegments, startTime)` returns a `WeatherFn` that interpolates by nearest sample point and nearest hour to the queried `(lat,lon,timeS)`
- [ ] `optimistic` uses p10 wind speed, `pessimistic` p90, `expected` mean (document: least-headwind approximated by least wind magnitude, spec 10.2/10.5)
- [ ] `readCache(date, ttlH, offline)`: returns parsed cache if present and (fresh OR offline), else null; `writeCache(date, field)` writes `.cache/weather-<date>.json`
- [ ] Dead source handling: `buildEnsemble` runs on whatever samples exist, sets a `reduced` flag when `< 3` sources contributed

**Verify:** `npx vitest run tests/ensemble.test.ts tests/cache.test.ts` → pass

**Steps:**
- [ ] **Step 1 (RED):** `tests/ensemble.test.ts`: feed samples from 3 sources at one point/hour with known winds; assert vector-mean direction (e.g. winds 350° and 10° average to 0°, not 180°), p10/p90. `tests/cache.test.ts`: write then read within TTL returns data; stale + not offline returns null; stale + offline returns data. Use a temp dir.
- [ ] **Step 2 (GREEN):** `src/weather/ensemble.ts`: `u=-W*sin(rad(dirFrom)), v=-W*cos(rad(dirFrom))`; mean u,v → `speed=hypot, dirFrom=(deg(atan2(-u,-v))+360)%360`. Percentiles on speed array. `makeWeatherFn` nearest-neighbor in space (haversine) and time (round to hour). `src/weather/cache.ts`: JSON read/write, `mtime` vs `ttlH`, `offline` override.
- [ ] **Step 3:** Verify, commit: `feat(weather): ensemble aggregation, scenario providers, cache and offline`

---

### Task 11: Wire wind into solver, three scenarios

**Goal:** Run the solver with real weather for expected/optimistic/pessimistic and report three total times and anchor NPs. Log capped sectors.

**Files:**
- Modify: `src/planner.ts` (add `solveThreeScenarios`)
- Test: `tests/scenarios.test.ts`

**Acceptance Criteria (spec 9.3, 9.5):**
- [ ] `solveThreeScenarios(micro, field, cfg)` returns `{expected, optimistic, pessimistic}` each a `PlanResult`
- [ ] Each scenario re-bisects `np_target` to hit 11:45 (so the three differ in required NP, not total time) OR holds NP fixed and reports differing total times. Choose fixed total time with differing NP per spec 9.5 ("the three anchor NPs they required"); assert optimistic NP <= expected NP <= pessimistic NP
- [ ] Capped sectors recorded in `PlanResult.notes` (which segments were speed-limited, how much time moved)
- [ ] With a synthetic headwind field on a flat route, pessimistic requires higher NP than optimistic

**Verify:** `npx vitest run tests/scenarios.test.ts` → pass

**Steps:**
- [ ] **Step 1 (RED):** `tests/scenarios.test.ts`: flat route, synthetic ensemble field with steady wind; assert NP ordering optimistic ≤ expected ≤ pessimistic and all hit target total.
- [ ] **Step 2 (GREEN):** add `solveThreeScenarios` calling `solveForTargetTime` with `makeWeatherFn(field, scenario,...)` for each scenario. Collect capped-sector notes during inner solve.
- [ ] **Step 3:** Verify, commit: `feat(planner): wind-driven three scenarios with required NP reporting`

---

### Task 12: Segmentation, micro to display segments

**Goal:** Aggregate microsegments into ≤50 display segments aligned to control km markers, with net height, average gradient, wind label, watt bands, and note keywords.

**Files:**
- Create: `src/segmentation.ts`
- Test: `tests/segmentation.test.ts`

**Acceptance Criteria (spec 11, 12.1):**
- [ ] Boundaries always include the 11 control-point km markers (spec 4.1) and stop depots
- [ ] Additional breaks at climb start/end (grade crossing `climb_threshold`) and head↔tail transitions
- [ ] Total display segments ≤ 50 (merge adjacent similar-target segments until under limit)
- [ ] Each `DisplaySegment` has correct `from_km/to_km`, `net_height_m`, `avg_grade`, `eta_s` (from planner), `pull_w_low/high` (band_pct around segment mean pull), `avg_w`, and a `note` keyword
- [ ] Note keywords drawn from {`JÄMN FART`,`TA DET LUGNT`,`KLÄTTRING`,`ÖKA`,`DEPÅ`,`BACKAR`,`SISTA UPPFÖR`} by gradient/wind/position rules
- [ ] Conservation: display segments cover all microsegments, distances sum to route total

**Verify:** `npx vitest run tests/segmentation.test.ts` → pass

**Steps:**
- [ ] **Step 1 (RED):** synthetic SegmentPlan[] with a clear climb and a depot; assert a `KLÄTTRING` segment exists, a `DEPÅ` at the stop, boundaries at control km, count ≤ 50.
- [ ] **Step 2 (GREEN):** `src/segmentation.ts`: `segment(plan: PlanResult, cfg, controlKms)`: walk segments, cut at control km, stop km, and grade-state changes; aggregate; derive watt band from mean pull × (1±band_pct) rounded; `note` rules: grade>climb_threshold→`KLÄTTRING` (last climb before finish→`SISTA UPPFÖR`), big descent→`BACKAR`, strong headwind→`TA DET LUGNT`, tailwind/flat fast→`ÖKA`, depot→`DEPÅ`, else `JÄMN FART`. Merge loop if `>50`.
- [ ] **Step 3:** Verify, commit: `feat(segmentation): display segments aligned to controls with note keywords`

---

### Task 13: Tempokort output, markdown and HTML

**Goal:** Render the race plan card as Markdown and print-friendly HTML with header (date, start, target, three scenarios) and one row per display segment.

**Files:**
- Create: `src/output/tempokort.ts`
- Test: `tests/tempokort.test.ts`

**Acceptance Criteria (spec 12.1):**
- [ ] `renderMarkdown(plan, displaySegments, scenarios, cfg)` produces a header block and a table with columns From-to, Town, ETA, Distance, Height, Gradient, Wind, Pull W, Avg W, Note, Stop
- [ ] ETA rendered as clock (`secondsToClock`), pull/avg as integer watts, gradient as %
- [ ] `renderHtml(...)` wraps the same data in a standalone printable HTML (inline CSS, A4 page)
- [ ] No em dash anywhere in output (assert the rendered string contains no em dash, U+2014)
- [ ] Three-scenario summary line shows optimistic/expected/pessimistic total times and NPs

**Verify:** `npx vitest run tests/tempokort.test.ts` → pass

**Steps:**
- [ ] **Step 1 (RED):** build a tiny `DisplaySegment[]` and assert the markdown has the header, a row, clock ETA, and zero em dash (U+2014).
- [ ] **Step 2 (GREEN):** `src/output/tempokort.ts`: `renderMarkdown` builds GFM table; `renderHtml` an HTML template with inline CSS. Both write helpers return strings; the CLI writes files.
- [ ] **Step 3:** Verify, commit: `feat(output): tempokort markdown and printable HTML`

---

### Task 14: FIT workout writer with 1000 offset

**Goal:** Write a distance-based structured FIT workout, one step per display segment, watt target band encoded with the +1000 offset, readable back correctly.

**Files:**
- Create: `src/output/fitWorkout.ts`
- Test: `tests/fitWorkout.test.ts`

**Acceptance Criteria (spec 12.2, 15):**
- [ ] `writeWorkout(displaySegments, cfg, outPath)` emits `file_id(type=workout)`, `workout(wkt_name, sport=cycling, num_valid_steps)`, and one `workout_step` per segment with `duration_type=distance`, `duration_distance` (m), `target_type=power`, `custom_target_value_low/high = wattsLow+1000 / wattsHigh+1000`
- [ ] Step target uses `cfg.watch_target`: `pull` → pull band, `avg` → avg ± band
- [ ] Round-trip: decode the written file with `@garmin/fitsdk` `Decoder` and confirm each step's `custom_target_value_low-1000` equals the intended watts (the 1000-offset proof, spec 15)
- [ ] `num_valid_steps` equals the step count; `message_index` runs 0..n-1
- [ ] Step count ≤ 50

**Verify:** `npx vitest run tests/fitWorkout.test.ts` → pass (round-trip decode). If `java` + `FitCSVTool.jar` present under the SDK, additionally run it and log; else note skip.

**Steps:**
- [ ] **Step 1 (RED):** build 3 display segments with known watts; `writeWorkout` to a temp file; decode back; assert decoded `custom_target_value_low === watts+1000`.
- [ ] **Step 2 (GREEN):** `src/output/fitWorkout.ts` using `@garmin/fitsdk` `Encoder`: `const enc = new Encoder();` write `fileIdMesg {type:'workout', manufacturer, product, timeCreated, serialNumber}`, `workoutMesg {wktName, sport:'cycling', numValidSteps}`, then `workoutStepMesg` per segment `{messageIndex, durationType:'distance', durationDistance, targetType:'power', customTargetValueLow: low+1000, customTargetValueHigh: high+1000}`. `const bytes = enc.close(); fs.writeFileSync(outPath, Buffer.from(bytes));`. Verify enum names against the installed SDK `Profile`.
- [ ] **Step 3:** Verify, commit: `feat(output): distance-based FIT workout with 1000-offset watt targets`

---

### Task 15: Course GPX with ETA waypoints

**Goal:** Export the course as GPX (track) plus a `<wpt>` at every control point with the plan ETA baked into the name.

**Files:**
- Create: `src/output/course.ts`
- Test: `tests/course.test.ts`

**Acceptance Criteria (spec 12.3):**
- [ ] `writeCourseGpx(microsegments, controlPoints, cfg, outPath)` writes GPX 1.1 with one `<trkseg>` of all route points and a `<wpt lat lon>` for each of the 11 control points
- [ ] Each waypoint `<name>` includes town + ETA clock, stops annotated, e.g. `Gränna 07:12` and `Boviken 12:47 (15 min)`
- [ ] Output parses back as valid XML and contains exactly 11 waypoints
- [ ] Control point lat/lon taken from the microsegment nearest each control km

**Verify:** `npx vitest run tests/course.test.ts` → pass

**Steps:**
- [ ] **Step 1 (RED):** synthetic route + 2 control points with ETAs; assert 2 `<wpt>` with names containing clock; re-parse valid.
- [ ] **Step 2 (GREEN):** `src/output/course.ts`: build GPX via `XMLBuilder` (fast-xml-parser) or string template. Map each control point km to nearest microsegment for lat/lon; name from town + `secondsToClock(eta_s, start)` + optional stop minutes.
- [ ] **Step 3:** Verify, commit: `feat(output): course GPX with ETA waypoints at control points`

---

### Task 16: CLI, plan-JSON, error handling, offline

**Goal:** Wire everything into `vattern plan`: load config, ingest, fetch/cache weather, solve three scenarios, segment, write all outputs and the plan-JSON. Handle `--offline`, `--config`, missing sources, unreachable targets.

**Files:**
- Create: `src/cli.ts`, `src/output/planJson.ts`
- Test: `tests/cli.test.ts`, `tests/planJson.test.ts`

**Acceptance Criteria (spec 5.3, 12.4, 16):**
- [ ] `npm start` (=`tsx src/cli.ts plan`) with the committed config and real input files writes `output/tempokort.md`, `output/tempokort.html`, `output/workout.fit`, `output/course.gpx`, `output/plan.json`
- [ ] `--offline` forces cache use; `--config path` overrides config path
- [ ] `writePlanJson(plan, displaySegments, scenarios, cfg)` dumps segments, microsegment data, wind per segment, speeds, watts, NP, ETA, stops, three scenarios; re-parses as valid JSON
- [ ] Missing weather source → run on the rest, flag reduced ensemble in output and plan-JSON notes; never crash
- [ ] Target unreachable → tempokort shows the fastest sustainable time and where caps bind (not a silent impossible plan)
- [ ] Missing GPX/FIT file → clear error message naming the missing path; missing FIT in solo mode is allowed (falls back to 0.60×ftp)

**Verify:** `npm start` end-to-end writes all five artifacts; `npx vitest run tests/cli.test.ts tests/planJson.test.ts` → pass. (CLI e2e test runs only under skipIf when real inputs exist; planJson tested on synthetic data always.)

**Steps:**
- [ ] **Step 1 (RED):** `tests/planJson.test.ts`: synthetic plan → JSON parses, has `scenarios`, `segments`, `stops`. `tests/cli.test.ts`: a `runPlan(cfg, {offline})` orchestration function (exported from cli) on a synthetic in-memory setup returns artifact strings without touching network when offline + cache present.
- [ ] **Step 2 (GREEN):** `src/output/planJson.ts`: `writePlanJson(...)` serializes. `src/cli.ts`: arg parse (`plan`, `--offline`, `--config`), `runPlan`: loadConfig → parseGpx+microsegments → readFit/anchor (resolve `np_target`) → weather (cache-or-fetch all sources, build ensemble) → `solveThreeScenarios` → `segment` → write tempokort md/html, workout fit, course gpx, plan json. Wrap source fetches in try/catch, collect notes. Copy input GPX/FIT to `data/` paths only if present; otherwise clear error.
- [ ] **Step 3:** Verify end-to-end run, commit: `feat(cli): plan command wiring, plan-JSON, offline, error handling`

---

### Task 17: Connect IQ plan-delta data field

**Goal:** Generate a Monkey C data field that shows ahead/behind vs plan and projected finish, inject the plan lookup table at generation time, compile to `output/PlanDelta.prg`, skip gracefully if the SDK or signing key is unavailable.

**Files:**
- Create: `src/ciq/generate.ts`, `src/ciq/PlanDelta.mc.tmpl`, `ciq/manifest.xml`, `ciq/monkey.jungle`, `ciq/resources/strings/strings.xml`, `ciq/resources/drawables/launcher_icon.png` (or drawables.xml)
- Modify: `src/cli.ts` (invoke CIQ generation after outputs)
- Test: `tests/ciq.test.ts`

**Acceptance Criteria (spec 12.5):**
- [ ] `generatePlanDeltaSource(displaySegments, plan, cfg)` renders the `.mc` from the template with a baked `{ distance_m: plan_elapsed_s }` lookup array for every display-segment boundary and control point
- [ ] The data field logic computes delta = `elapsedTime - interpolatedPlanElapsed` and projected finish = `start_clock + plan_total + delta`, rendering two lines
- [ ] `compilePlanDelta(outPath)` invokes `monkeyc -f ciq/monkey.jungle -d fenix7x -o output/PlanDelta.prg -y <devkey>`, generating a developer key with `openssl` if absent
- [ ] If `monkeyc` missing OR compile fails: log a warning, write the generated `.mc` source to `output/PlanDelta.mc` for inspection, do not fail the run (spec 12.5 graceful skip)
- [ ] Lookup table is monotonic non-decreasing in distance

**Verify:** `npx vitest run tests/ciq.test.ts` → pass (source generation + monotonic table tested without compiling). Then attempt real compile in the CLI run; record result (success path or BLOCKER) in build-report.

**Steps:**
- [ ] **Step 1 (RED):** `tests/ciq.test.ts`: generate source from 3 display segments; assert the rendered string contains a lookup array with 3+ entries, monotonic distances, and the two display lines.
- [ ] **Step 2 (GREEN):**
  - `ciq/manifest.xml`: a datafield app, `id` (uuid), products `fenix7x`, min-SDK from installed SDK, permissions none.
  - `ciq/monkey.jungle`: `project.manifest = manifest.xml`.
  - `src/ciq/PlanDelta.mc.tmpl`: a `Toybox.WatchUi.SimpleDataField` (or `DataField`) subclass. Placeholder `/*__LOOKUP__*/` replaced by the table, `/*__PLAN_TOTAL_S__*/`, `/*__START_CLOCK__*/`. `compute(info)` reads `info.elapsedTime` and `info.elapsedDistance`, interpolates plan elapsed, computes delta and projected finish, returns a two-line string.
  - `src/ciq/generate.ts`: `generatePlanDeltaSource` does the replacements; `compilePlanDelta` ensures a dev key (`openssl genrsa 4096 | openssl pkcs8 -topk8 -outform DER -nocrypt` to `ciq/developer_key.der` if missing), runs monkeyc via `child_process.execFileSync`, catches errors → warn + write `.mc` only.
- [ ] **Step 3:** Verify generation test, run compile in CLI, commit: `feat(ciq): plan-delta Monkey C data field with baked lookup table`

---

## Final: build report

After Task 17, write `docs/build-report.md` covering: every assumption made and why, decisions taken at forks, the validation results (microsegment sum, sanity table, calm-wind total/rolling/control clocks, wind quadrant tests, FIT 1000-offset round-trip), and a BLOCKERS section for anything that needed a real answer (missing key, SDK signing, source outages). Commit: `docs: build report for M1-M8`.

---

## Self-review (done before handoff)

- Spec coverage: M1 Tasks 3-4; M2 Tasks 5-6; M3 Task 7; M4 Tasks 8-11; M5 Tasks 12-13; M6 Tasks 14-15; M7 Tasks 1-2,16; M8 Task 17. Solo mode threaded through 2,4,6,7,16. Validation (spec 15) covered in 3,4,5,6,7,14 ACs and the build report.
- Placeholders: none; formulas and signatures inline, spec sections referenced for full derivations.
- Type consistency: all modules import the locked `src/types.ts`; field names fixed (`np_target`, `rider_np_w`, `eta_s`, `winddir_from_deg`).

## Execution

User directive (this session): run M1-M8 fully autonomously, no questions, via subagent-driven-development with parallel dispatch for independent tasks. The writing-plans AskUserQuestion handoff is overridden by that explicit instruction. Proceed directly to subagent-driven-development.
