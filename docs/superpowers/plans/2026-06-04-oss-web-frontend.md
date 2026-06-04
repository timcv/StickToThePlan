# StickToThePlan OSS Web Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish StickToThePlan as MIT open source with a Vercel-hosted React SPA that runs the existing race-plan math client-side, sharing a single pure `core` package between the web app and the Node CLI.

**Architecture:** npm workspaces monorepo. `packages/core` is pure TypeScript (no Node, no DOM) holding all math and output builders. `packages/cli` is the existing Node app refactored onto core (fs, fetch, child_process live here). `apps/web` is a Vite + React SPA that runs core in a Web Worker. An NP performance optimization (precomputed quartic moments) makes the solve interactive.

**Tech Stack:** TypeScript, Node 22, npm workspaces, Vitest, Vite, React 19, @garmin/fitsdk, fast-xml-parser, Vercel.

**Authoritative spec:** `docs/superpowers/specs/2026-06-04-opensource-web-frontend-design.md`. No em dashes anywhere (code, comments, output, docs). Use commas or new sentences.

---

## Orchestration model (decided)

The core extraction (Task 2) rewrites imports across every file and is inherently NOT parallelizable, so the coordinator executes it directly while holding the full module map in context. Additive, file-disjoint work (NP optimization, splits, web components, OSS docs) is delegated to subagents, run in parallel where files are disjoint. Parallel subagents never commit and never edit shared `index.ts` files; the coordinator merges exports and commits at each phase boundary.

Assumptions logged in `docs/build-report-oss.md` as they are made.

---

## File Structure (target)

```
package.json                 # private root, workspaces ["packages/*","apps/*"], scripts, vitest dev dep
tsconfig.base.json           # shared compiler opts + path mapping @stp/core
vitest.config.ts             # projects: core (node), cli (node), web (jsdom)
packages/core/               # PURE. deps: fast-xml-parser, @garmin/fitsdk
  package.json  tsconfig.json
  src/  (mirrors current src/ pure modules) + output/splits.ts (NEW) + ciq/template.ts (NEW embedded .mc template)
  src/index.ts  (public surface)
  tests/  (relocated pure-module tests)
packages/cli/                # Node IO. deps: @stp/core
  package.json  tsconfig.json
  src/ loadConfig.ts fileIo.ts weatherFetch.ts ciqCompile.ts cli.ts
  tests/ (relocated IO tests)
apps/web/                    # Vite + React SPA. deps: @stp/core, react, react-dom
  package.json vite.config.ts index.html tsconfig.json
  src/ main.tsx App.tsx worker/solve.worker.ts components/*
examples/ sample-route.gpx sample-config.json scripts/gen-sample-route.mjs
README.md MODELL.md LICENSE .github/workflows/ci.yml vercel.json
```

---

## PHASE 0: Prerequisite (coordinator)

### Task 0: Branch setup

**Goal:** Get the M1-M8 foundation onto main and create the OSS working branch.

**Decision (logged):** `main` and `build/raceplan-m1-m8` have byte-identical source trees. The only diff is `main` additionally carries the spec doc; `build` would *delete* it. `main`'s squashed commit `bcd441e` IS the merged M1-M8 work. So Phase 0's intent (foundation on main) is already satisfied. A literal `git merge build/raceplan-m1-m8` is a no-op-or-harmful (would try to remove the spec). We therefore do NOT merge; we branch `feat/oss-web` off `main`.

**Verify:** `git rev-parse --abbrev-ref HEAD` -> `feat/oss-web`; `npm test` -> 252 passed.

**Steps:**
- [ ] Confirm clean tree, on `main`.
- [ ] `git checkout -b feat/oss-web`
- [ ] Baseline recorded (252 passed, 1 skipped, suite ~39s).

---

## PHASE 1: Shared core + NP optimization

### Task 1: Monorepo scaffold

**Goal:** Stand up npm workspaces with empty `core`/`cli` packages and a root Vitest that runs the (still root-located) tests, so nothing breaks before the move.

**Files:**
- Create: `package.json` (root), `tsconfig.base.json`, `vitest.config.ts`, `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/cli/package.json`, `packages/cli/tsconfig.json`
- Preserve: existing `src/`, `tests/` until Task 2 moves them.

**Acceptance Criteria:**
- [ ] `npm install` links workspaces (symlinks `@stp/core` into `node_modules`).
- [ ] `npm test` still runs and reports 252 passed.
- [ ] `npm run typecheck` passes.

**Verify:** `npm install && npm test` -> 252 passed.

**Root `package.json`:**
```json
{
  "name": "sticktotheplan",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.base.json --noEmit",
    "build:web": "npm run build -w apps/web",
    "start": "npm run start -w @stp/cli"
  },
  "devDependencies": {
    "@types/node": "^25.9.1",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

**`tsconfig.base.json`** (path mapping lets tsc + vitest resolve `@stp/core` to source without a build):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "lib": ["ES2022"],
    "types": ["node"],
    "baseUrl": ".",
    "paths": {
      "@stp/core": ["packages/core/src/index.ts"],
      "@stp/core/*": ["packages/core/src/*"]
    }
  },
  "include": ["packages/*/src", "packages/*/tests", "src", "tests"]
}
```

**Root `vitest.config.ts`** (transition: include both old and new locations; trim in Task 2):
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          environment: 'node',
          include: ['packages/core/tests/**/*.test.ts', 'tests/**/*.test.ts'],
        },
        resolve: { alias: { '@stp/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname } },
      },
      {
        test: {
          name: 'cli',
          environment: 'node',
          include: ['packages/cli/tests/**/*.test.ts'],
        },
        resolve: { alias: { '@stp/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname } },
      },
    ],
  },
});
```
Note: during Task 1 the legacy `tests/**` still references `../src/*`; keep `src/` in place. The `core` project's `tests/**` glob picks them up so 252 stay green. Task 2 deletes the legacy globs.

**`packages/core/package.json`:**
```json
{
  "name": "@stp/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@garmin/fitsdk": "^21.205.0",
    "fast-xml-parser": "^5.8.0"
  }
}
```

**`packages/core/tsconfig.json`:**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "rootDir": "." }, "include": ["src", "tests"] }
```

**`packages/cli/package.json`:**
```json
{
  "name": "@stp/cli",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "start": "tsx src/cli.ts plan", "typecheck": "tsc --noEmit" },
  "dependencies": { "@stp/core": "*" },
  "devDependencies": { "tsx": "^4.22.4" }
}
```

**`packages/cli/tsconfig.json`:** same shape as core's.

---

### Task 2: Extract `packages/core` and `packages/cli` (pure vs IO split)

**Goal:** Move every module into the right package, splitting the IO-coupled files, with all 252 tests relocated and green. COORDINATOR-EXECUTED (shared-state refactor).

**Move map (pure -> `packages/core/src/`, layout preserved so relative imports survive):**
- `types.ts`, `physics.ts`, `chaingang.ts`, `planner.ts`, `segmentation.ts`, `util/geo.ts`, `util/time.ts`, `weather/ensemble.ts`, `output/tempokort.ts`, `garmin-fitsdk.d.ts`
- `config.ts`: keep ONLY `applyDefaults` + `RawConfig` + `DEFAULTS` (remove `import fs` and `loadConfig`).
- `ingest/gpx.ts`: keep `dedupePoints`, `smoothElevation`, `buildMicroSegments`; ADD pure `parseGpxString(xml: string): RoutePoint[]` (the parse body of current `parseGpx`, fed a string) and `ingestGpxString(xml: string, cfg: Config): MicroSegment[]`. Remove `import fs`, `parseGpx(path)`, `ingestGpx(path)`.
- `ingest/fit.ts`: keep `analyzePass`; ADD `readFitPowerBytes(bytes: Uint8Array | number[]): number[]` (uses `@garmin/fitsdk` `Stream.fromByteArray`) and `determineAnchorFromPower(powerStream: number[] | null, cfg: Config): FitPassMetrics` (the pure decision body of `determineAnchor`). Remove `import fs`, `readFitPower(path)`, `determineAnchor(cfg)`.
- `output/course.ts`: keep `buildCourseGpx`; remove `writeCourseGpx` + `import fs`.
- `output/fitWorkout.ts`: keep `buildSteps`; ADD `encodeWorkout(displaySegments, cfg): Uint8Array` (the encode body of `writeWorkout`, returning bytes instead of writing). Remove `writeWorkout` + `import fs`.
- `output/planJson.ts`: keep `buildPlanJson`; remove `writePlanJson` + `import fs`.
- `weather/openMeteo.ts`: keep `buildForecastUrl`, `buildEnsembleUrl`, `parseOpenMeteo`, and `fetchOpenMeteo` (uses global `fetch`, browser-safe; the browser calls it directly).
- `weather/smhi.ts`: keep `buildSmhiUrl`, `parseSmhi`; remove `fetchSmhi`.
- `weather/metNorway.ts`: keep `buildMetNorwayUrl`, `metNorwayHeaders`, `parseMetNorway`; remove `fetchMetNorway`.
- `ciq/generate.ts`: keep `buildLookupTable` and `generatePlanDeltaSource`, but make the latter PURE by reading the template from a new `ciq/template.ts` string constant instead of `fs.readFileSync`. Remove `writePlanDeltaSource`, `compilePlanDelta`, `generateCiq` + node imports.
- NEW `ciq/template.ts`: `export const PLAN_DELTA_TEMPLATE = String.raw\`...current PlanDelta.mc.tmpl contents...\`;`

**Move map (IO -> `packages/cli/src/`):**
- `cli.ts` (the pipeline) -> imports `@stp/core` + the cli IO modules below.
- NEW `loadConfig.ts`: `loadConfig(path='config.json'): Config` = `applyDefaults(JSON.parse(fs.readFileSync(...)))`.
- NEW `fileIo.ts`: `parseGpx(path)`, `ingestGpx(path, cfg)` (read file -> `ingestGpxString`), `readFitPower(path)` (read bytes -> `readFitPowerBytes`), `determineAnchor(cfg)` (existsSync + readFitPower -> `determineAnchorFromPower`), and `writeCourseGpx`, `writeWorkout` (calls `encodeWorkout` then writes), `writePlanJson`, `writeTempokort` wrappers.
- NEW `weatherFetch.ts`: `fetchSmhi`, `fetchMetNorway`, the multi-source `gatherWindSamples`/orchestration, and the `cache.ts` contents (`cachePath`, `readCache`, `writeCache`).
- NEW `ciqCompile.ts`: `writePlanDeltaSource`, `compilePlanDelta`, `generateCiq` (monkeyc via child_process, behavior unchanged).

**`packages/core/src/index.ts`** re-exports the public surface (types, physics, chaingang incl. NP additions from Task 3, planner, segmentation incl. `ControlPoint`/`VATTERN_CONTROLS`, config `applyDefaults`, ingest string/bytes fns, all output builders incl. `buildSplitTable` from Task 4, weather url/parse/ensemble/fetchOpenMeteo, ciq `buildLookupTable`/`generatePlanDeltaSource`, util geo/time).

**Test relocation (preserve `tests/ <-> src/` relative layout so `../src/x.js` imports survive):**
- To `packages/core/tests/`: `chaingang`, `physics`, `planner`, `scenarios`, `segmentation`, `geo`, `time`, `config`, `ensemble`, `tempokort`, `course`, `fitWorkout` (encode part), `planJson`, `openMeteo`, `smhi`, `metNorway`, `ciq` (source-gen part), `scaffold`, and the pure parts of `gpx`/`fit`.
- To `packages/cli/tests/`: `cli`, `cache`, and the path-based parts of `gpx`/`fit`/`course`/`fitWorkout`/`planJson` (file write + read-back). CLI tests import pure helpers from `@stp/core` and IO from `../src/...`.
- Tests that import `applyDefaults` from `../src/config.js` resolve because core keeps `config.ts` with `applyDefaults`.

**Acceptance Criteria:**
- [ ] `npm test` -> 252 passed (1 skipped) from `packages/*/tests`.
- [ ] `npm run typecheck` passes across workspaces.
- [ ] Legacy root `src/` and `tests/` removed; root `vitest.config.ts` trimmed to `packages/*` globs.
- [ ] No `import ... from 'node:*'` remains in any `packages/core/**` file.
- [ ] CLI still runs: `npm start -- --calm --offline` produces output with calm np 146 W and total 11:45 (manual check vs pre-extraction).

**Verify:** `npm test` -> `Tests 252 passed`; `grep -rl "node:" packages/core/src` -> empty.

**Steps:** (1) create core/cli src trees per move map; (2) split the five IO files; (3) embed mc template; (4) write `core/src/index.ts`; (5) move tests, fixing only the split-file imports; (6) trim vitest + tsconfig; (7) run suite, fix imports until green; (8) sanity-run CLI calm/offline.

---

### Task 3: NP optimization (precomputed quartic moments)

**Goal:** Replace the O(n) square-wave NP in `riderNpAtSpeed` with an O(1) closed form using five precomputed moments of the 30 s window occupancy, keeping the reference for an equivalence test.

**Files:**
- Modify: `packages/core/src/chaingang.ts`
- Test: `packages/core/tests/chaingang.test.ts` (add equivalence + perf-sanity), keep existing assertions.

**Background (verified against current code):** `circularRollingMean30` is a TRAILING 30-sample window with circular wrap over cycle length `n = n_riders * pull_seconds`; pull phase is indices `[0, pull_seconds)`. For index `i`, `a_i` = (count of `j in 0..29` with `((i-j) mod n) < pull_seconds`) / 30. Then `rolling[i] = a_i*Pp + (1-a_i)*Pd` and `NP^4 = mean_i(rolling[i]^4)`. Expanding gives the spec's coefficients.

**Acceptance Criteria:**
- [ ] `riderNpSquareWaveReference(...)` exported, byte-for-byte the current algorithm (keep `circularRollingMean30`).
- [ ] New `npFromMoments`/optimized `riderNpAtSpeed` agree with the reference: over a grid `Pp in {100..400 step 20}`, `Pd in {50..300 step 20}` (and default n_riders=12, pull_seconds=45, plus a second grid at n_riders=8, pull=30), `abs(NP_opt - NP_ref) < 1e-6`.
- [ ] Solo (`n_riders===1`) still returns `pullPower` directly.
- [ ] Existing chaingang tests still pass; planner calm solve still yields np 145.9 W and total 11:45 (guarded by planner/scenarios tests).
- [ ] Measured: one calm solve over the full course drops from ~33 s toward 1 to 2 s (record both numbers in build report).

**Verify:** `npm test -- chaingang planner scenarios` -> all pass.

**Implementation (full):**
```ts
// Precomputed moments of the 30 s window occupancy a_i for one (n_riders, pull_seconds) cycle.
interface NpMoments { c0: number; c1: number; c2: number; c3: number; c4: number; }

const momentCache = new Map<string, NpMoments>();

/** Occupancy a_i for index i: fraction of the trailing 30-sample window in the pull phase. */
function occupancyArray(nRiders: number, pullSeconds: number): number[] {
  const n = nRiders * pullSeconds;
  const window = 30;
  const a = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let inPull = 0;
    for (let j = 0; j < window; j++) {
      const idx = ((i - j) % n + n) % n;   // EXACT match to circularRollingMean30
      if (idx < pullSeconds) inPull++;
    }
    a[i] = inPull / window;
  }
  return a;
}

export function npMomentsFor(nRiders: number, pullSeconds: number): NpMoments {
  const key = `${nRiders}:${pullSeconds}`;
  const hit = momentCache.get(key);
  if (hit) return hit;
  const a = occupancyArray(nRiders, pullSeconds);
  const n = a.length;
  let c0 = 0, c1 = 0, c2 = 0, c3 = 0, c4 = 0;
  for (const ai of a) {
    const b = 1 - ai;
    c4 += ai * ai * ai * ai;
    c3 += ai * ai * ai * b;
    c2 += ai * ai * b * b;
    c1 += ai * b * b * b;
    c0 += b * b * b * b;
  }
  const m: NpMoments = {
    c4: c4 / n,
    c3: 4 * (c3 / n),
    c2: 6 * (c2 / n),
    c1: 4 * (c1 / n),
    c0: c0 / n,
  };
  momentCache.set(key, m);
  return m;
}

/** O(1) rider NP from pull/draft power using precomputed moments. */
export function npFromMoments(pPull: number, pDraft: number, nRiders: number, pullSeconds: number): number {
  const { c0, c1, c2, c3, c4 } = npMomentsFor(nRiders, pullSeconds);
  const Pp = pPull, Pd = pDraft;
  const np4 =
    c4 * Pp ** 4 +
    c3 * Pp ** 3 * Pd +
    c2 * Pp ** 2 * Pd ** 2 +
    c1 * Pp * Pd ** 3 +
    c0 * Pd ** 4;
  return np4 ** 0.25;
}
```
Rewrite `riderNpAtSpeed` to: compute `pPull`; if solo return it; else compute `pDraft` and `return npFromMoments(pPull, pDraft, cfg.n_riders, cfg.pull_seconds)`. Rename the current body to `riderNpSquareWaveReference` (same signature), keeping `circularRollingMean30`. Coordinator adds `npMomentsFor`, `npFromMoments`, `riderNpSquareWaveReference` to `index.ts`.

**Equivalence test (add):**
```ts
import { riderNpSquareWaveReference, npFromMoments, pullPower, draftPower } from '../src/chaingang.js';
// Reference NP directly from (Pp,Pd) via the square wave, to compare against npFromMoments.
function refNpFromPowers(Pp: number, Pd: number, n: number, pull: number): number {
  const cycle = n * pull;
  const arr = Array.from({ length: cycle }, (_, t) => (t < pull ? Pp : Pd));
  // replicate circularRollingMean30 + NP
  const w = 30; const roll = arr.map((_, i) => {
    let s = 0; for (let j = 0; j < w; j++) s += arr[((i - j) % cycle + cycle) % cycle]; return s / w;
  });
  return (roll.reduce((a, r) => a + r ** 4, 0) / roll.length) ** 0.25;
}
describe('NP moments equivalence', () => {
  it('matches the square-wave reference within 1e-6', () => {
    for (const [n, pull] of [[12, 45], [8, 30]] as const) {
      for (let Pp = 100; Pp <= 400; Pp += 20) {
        for (let Pd = 50; Pd <= 300; Pd += 20) {
          const a = npFromMoments(Pp, Pd, n, pull);
          const b = refNpFromPowers(Pp, Pd, n, pull);
          expect(Math.abs(a - b)).toBeLessThan(1e-6);
        }
      }
    }
  });
});
```

---

### Task 4: Depot split table (`output/splits.ts`)

**Goal:** New pure core module producing the depot split-time rows (mellantider), the primary verification surface.

**Files:**
- Create: `packages/core/src/output/splits.ts`
- Test: `packages/core/tests/splits.test.ts`

**Acceptance Criteria:**
- [ ] `buildSplitTable(plan, cfg, controls=VATTERN_CONTROLS): SplitRow[]` returns one row per leg between consecutive controls (start->C1, ..., ->finish).
- [ ] Arrival reconstructed from `sum(segments[].time_s)` to the boundary plus stops at controls strictly before (no eta_s double-count). `depart_s = arrive_s + stop_minutes*60`.
- [ ] `leg_time_s = arrive_s(to) - depart_s(from)`; sum of `leg_time_s` + sum of stops = `plan.total_time_s` within 1 s on the sample plan.
- [ ] `leg_distance_m` = boundary cum(to) - boundary cum(from); all rows non-negative.

**Verify:** `npm test -- splits` -> pass.

**Implementation (full):**
```ts
import type { PlanResult, Config } from '../types.js';
import { type ControlPoint, VATTERN_CONTROLS } from '../segmentation.js';

export interface SplitRow {
  fromControl: string;
  toControl: string;
  leg_distance_m: number;
  leg_time_s: number;
  arrive_s: number;       // cumulative seconds from start at arrival (stops before included, this stop excluded)
  stop_minutes: number;   // stop at toControl, 0 if none
  depart_s: number;       // arrive_s + stop_minutes*60
  cumulative_s: number;   // = depart_s (total elapsed leaving toControl)
}

function nearestBoundaryCum(targetM: number, plan: PlanResult): number {
  const segs = plan.segments;
  let best = segs[0].micro.cum_distance_m;
  let bestDiff = Math.abs(best - targetM);
  for (const s of segs) {
    const d = Math.abs(s.micro.cum_distance_m - targetM);
    if (d < bestDiff) { bestDiff = d; best = s.micro.cum_distance_m; }
  }
  return best;
}

function boundaryIndex(cum: number, plan: PlanResult): number {
  return plan.segments.findIndex(s => s.micro.cum_distance_m === cum);
}

export function buildSplitTable(
  plan: PlanResult,
  cfg: Config,
  controls: ControlPoint[] = VATTERN_CONTROLS,
): SplitRow[] {
  const segs = plan.segments;
  if (segs.length === 0) return [];

  // Rolling time (no stops) to the end of each segment via prefix sum of time_s.
  const prefix: number[] = new Array(segs.length);
  let acc = 0;
  for (let i = 0; i < segs.length; i++) { acc += segs[i].time_s; prefix[i] = acc; }

  const stopByName = new Map<string, number>();
  for (const s of cfg.stops) stopByName.set(s.control, s.minutes);

  // Arrival at a control km: rolling time to its boundary + stops at controls strictly before it.
  const arrivalAt = (km: number): { arrive: number; cum: number } => {
    const cum = nearestBoundaryCum(km * 1000, plan);
    const idx = boundaryIndex(cum, plan);
    const rolling = idx >= 0 ? prefix[idx] : 0;
    let stopsBefore = 0;
    for (const s of cfg.stops) if (s.km < km) stopsBefore += s.minutes * 60;
    return { arrive: rolling + stopsBefore, cum };
  };

  const rows: SplitRow[] = [];
  for (let i = 0; i < controls.length - 1; i++) {
    const from = controls[i];
    const to = controls[i + 1];
    const a = arrivalAt(from.km);
    const b = arrivalAt(to.km);
    const fromStop = stopByName.get(from.name) ?? 0;
    const toStop = stopByName.get(to.name) ?? 0;
    const fromDepart = a.arrive + fromStop * 60;
    const arrive_s = b.arrive;
    const depart_s = arrive_s + toStop * 60;
    rows.push({
      fromControl: from.name,
      toControl: to.name,
      leg_distance_m: Math.max(0, b.cum - a.cum),
      leg_time_s: Math.max(0, arrive_s - fromDepart),
      arrive_s,
      stop_minutes: toStop,
      depart_s,
      cumulative_s: depart_s,
    });
  }
  return rows;
}
```
Coordinator adds `buildSplitTable`/`SplitRow` to `index.ts`. Commit Phase 1 after Tasks 3+4 land and full suite (now 253+ tests) green.

---

## PHASE 2: Web app

### Task 5: SPIKE - @garmin/fitsdk under Vite

**Goal:** Confirm `@garmin/fitsdk` bundles and runs in a browser context via Vite BEFORE building the app. De-risk #1.

**Files:**
- Create: `apps/web/` minimal Vite scaffold + `apps/web/tests/fitsdk-spike.test.ts` (jsdom env).

**Acceptance Criteria:**
- [ ] In a Vite/jsdom Vitest, `readFitPowerBytes` decodes a tiny in-repo FIT byte fixture, and `encodeWorkout` returns a non-empty `Uint8Array` whose decode round-trips the 1000-offset watt target.
- [ ] If decode fails in-browser, document the mitigation (wrap/polyfill, or make FIT upload optional while keeping encode) in the build report and proceed.

**Verify:** `npm test -- fitsdk-spike` -> pass (or documented mitigation).

---

### Task 6: Scaffold apps/web + Web Worker

**Goal:** Vite + React + TS app shell with a Web Worker that imports core and runs the compute pipeline off the main thread.

**Files:** `apps/web/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/worker/solve.worker.ts`, add web project to root `vitest.config.ts` (jsdom).

**`apps/web/package.json` deps:** `@stp/core: "*"`, `react: "^19"`, `react-dom: "^19"`; dev: `vite: "^6"`, `@vitejs/plugin-react: "^4"`, `@types/react: "^19"`, `@types/react-dom: "^19"`, `jsdom: "^25"`, `@testing-library/react: "^16"`.

**`vite.config.ts`:** `react()` plugin; ensure worker format `es`; do not externalize `@stp/core` (let Vite transpile the workspace TS).

**Worker pipeline (`solve.worker.ts`):** receives `{ gpxText, fitBytes?, form, weatherMode }`; runs `ingestGpxString` -> optional `readFitPowerBytes`+`determineAnchorFromPower` -> build `Config` via `applyDefaults` -> weather (`calmWeather`, or open-meteo via `fetchOpenMeteo`+`buildEnsemble`+`makeWeatherFn`) -> `solveThreeScenarios` (or single calm `solveForTargetTime`) -> `segment` -> `buildSplitTable`; posts `{ scenarios, displaySegments, splits, anchor }`.

**Acceptance Criteria:**
- [ ] `npm run build -w apps/web` succeeds; `@stp/core` resolves and bundles.
- [ ] Worker compiles and imports core without Node polyfills.

**Verify:** `npm run build -w apps/web` -> dist emitted.

---

### Task 7: Upload + form UI + run wiring

**Goal:** Inputs and the run flow.

**Files:** `apps/web/src/components/UploadForm.tsx`, `useSolver.ts` (worker hook), wire into `App.tsx`.

**Acceptance Criteria:**
- [ ] GPX upload (required, read as text); FIT upload (optional, ArrayBuffer). Form: `target_total_hm`, `ftp`, `n_riders`, `m`, editable stops list (`control`,`km`,`minutes`), `watch_target` (pull/avg), weather mode (calm / open-meteo with race date).
- [ ] Run button posts to the worker; progress indicator shows while solving; results delivered to state.
- [ ] FIT absent -> `np_target` falls back to `0.60*ftp`.

**Verify:** component renders inputs (covered by Task 10 render test) + manual sample run (Task 10/Phase 3 gate).

---

### Task 8: Results rendering (splits + tempokort + scenarios)

**Goal:** Render the verification surfaces.

**Files:** `apps/web/src/components/SplitTable.tsx`, `TempokortTable.tsx`, `ScenarioSummary.tsx`.

**Acceptance Criteria:**
- [ ] Scenario summary line: optimistic/expected/pessimistic totals + required NP.
- [ ] Depot split table from `SplitRow[]`: leg (from->to), distance, leg time, arrival clock, stop minutes, departure clock, cumulative; clocks via core `secondsToClock` against `start_time`.
- [ ] Full tempokort table rendered from `DisplaySegment[]` (not the markdown string).

**Verify:** Task 10 render test asserts the split table renders rows.

---

### Task 9: Download buttons + privacy note + load-sample

**Goal:** Client-side file downloads from core builders.

**Files:** `apps/web/src/components/Downloads.tsx`, `lib/download.ts`, privacy note + load-sample action in `App.tsx`.

**Acceptance Criteria:**
- [ ] Buttons: `workout.fit` (from `encodeWorkout` Uint8Array), `course.gpx` (`buildCourseGpx`), `plan.json` (`buildPlanJson` -> JSON string), `PlanDelta.mc` (`generatePlanDeltaSource`); each triggers a Blob download.
- [ ] Note by the `.mc` button: `.prg` requires local compilation, link to CLI instructions.
- [ ] Privacy note shown (files processed in-browser, only coords+date sent in open-meteo mode).
- [ ] "Load sample" fetches `examples/sample-route.gpx` (served as a static asset) and populates the form.

**Verify:** `npm run build -w apps/web` succeeds; manual download check in Phase 3 gate.

---

### Task 10: Web tests (smoke + component)

**Goal:** Lock the worker pipeline and split table.

**Files:** `apps/web/tests/solve.smoke.test.ts`, `apps/web/tests/SplitTable.test.tsx`.

**Acceptance Criteria:**
- [ ] Smoke: invoking the worker's pipeline function on the sample GPX (calm mode) yields a non-empty `SplitRow[]`. (Test the exported pipeline fn directly, not via a real Worker.)
- [ ] Render: `SplitTable` given fixture rows renders one `<tr>` per leg (jsdom + @testing-library/react).

**Verify:** `npm test -- solve.smoke SplitTable` -> pass. Commit Phase 2.

---

## PHASE 3: Open source + deploy

### Task 11: Synthetic sample route + generator + sample config

**Goal:** A committed, copyright-safe sample route the web app can load.

**Files:** `examples/scripts/gen-sample-route.mjs`, `examples/sample-route.gpx` (generated, committed), `examples/sample-config.json`, edit `.gitignore`.

**Acceptance Criteria:**
- [ ] Generator emits a synthetic ~60-80 km loop with a few climbs (deterministic, no external data). Re-running reproduces the file.
- [ ] `.gitignore` gains `!examples/` negations so `examples/sample-route.gpx` is committed despite the global `*.gpx` ignore (verify `git check-ignore -v examples/sample-route.gpx` reports the negation wins / file is tracked).
- [ ] `ingestGpxString` parses it to a non-empty `MicroSegment[]`.

**Verify:** `node examples/scripts/gen-sample-route.mjs && git add -n examples/sample-route.gpx` shows it would be added.

---

### Task 12: LICENSE + README + MODELL.md

**Goal:** OSS docs.

**Files:** `LICENSE` (MIT, 2026, holder `timcv`), `README.md` (rewrite), `MODELL.md`.

**Acceptance Criteria:**
- [ ] MIT license text, year 2026.
- [ ] README: what it is, hosted link placeholder, web quick start, CLI quick start (`npm install`, `npm start -w @stp/cli`, `--calm`, `--offline`, bring-your-own GPX/FIT), model summary linking MODELL.md, license, privacy note, chosen Vercel config documented.
- [ ] MODELL.md: end-to-end split computation (NP anchor -> per-segment physics+chaingang -> leg time -> depot ETA -> splits), validation numbers (314.89 km conservation, calm 11:45 and 10:55, sanity table), references. No personal data.

**Verify:** manual read; confirm README.md, MODELL.md, and LICENSE contain no personal email addresses or home-directory paths.

---

### Task 13: De-personalization

**Goal:** Remove personal identifiers from committed files; make MET Norway UA configurable.

**Files:** `packages/core/src/weather/metNorway.ts` (UA contact configurable, default a generic repo URL), scrub `docs/build-report.md` and any other committed file containing home-directory paths or the maintainer's personal email.

**Acceptance Criteria:**
- [ ] `metNorwayHeaders()` uses a configurable contact, default `https://github.com/timcv/StickToThePlan` (not a personal email).
- [ ] `grep -rn "tim@haus.se\|/Users/tim" --include=*.ts --include=*.md --include=*.json .` returns nothing in committed files (node_modules/.git excluded).
- [ ] Tests referencing the old UA updated; suite green.

**Verify:** the grep above -> empty; `npm test` green.

---

### Task 14: GitHub Actions CI

**Goal:** CI on push + PR.

**Files:** `.github/workflows/ci.yml`.

**Acceptance Criteria:**
- [ ] Node 22, `npm ci`, `npm run typecheck`, `npm test` (vitest run), `npm run build:web`.
- [ ] Workflow triggers on push and pull_request.

**Verify:** `yaml` parses; locally run the same commands successfully.

**`.github/workflows/ci.yml`:**
```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build:web
```

---

### Task 15: Vercel deploy config

**Goal:** Deployable static SPA from the monorepo.

**Files:** `vercel.json` (root) or documented dashboard settings; README note.

**Acceptance Criteria:**
- [ ] Build installs at repo root (workspaces), builds `apps/web`, output `apps/web/dist`.
- [ ] Chosen approach documented in README.

**Verify:** `npx vite build` of the web app produces `apps/web/dist/index.html`; config JSON valid.

**`vercel.json` (root):**
```json
{
  "buildCommand": "npm run build:web",
  "outputDirectory": "apps/web/dist",
  "installCommand": "npm install"
}
```

---

## Final: build report

Write `docs/build-report-oss.md`: assumptions, decisions (Phase 0 no-merge rationale, lib versions, fetchOpenMeteo-in-core, template embedding, gitignore negation), the before/after calm-solve timings, NP equivalence result, and any BLOCKERS.

---

## Validation (spec section 10, the overall gate)

- [ ] All relocated tests green (252 baseline + NP equivalence + splits + web smoke/render).
- [ ] NP equivalence < 1e-6.
- [ ] Planner unchanged: calm np 145.9/146 W, total 11:45.
- [ ] Calm solve on full course ~1 to 2 s after optimization (report before/after).
- [ ] CI config runs the full pipeline green locally.
- [ ] Vercel build produces `apps/web/dist`; sample run works in-browser; four files download; FIT round-trips with 1000 offset.
- [ ] No home-directory paths or personal email addresses in committed files.
