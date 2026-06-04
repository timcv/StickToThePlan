# StickToThePlan, open-source web frontend and shared-core monorepo, design doc

Date: 2026-06-04
Status: Design approved by Tim (this session). Builds on the completed M1 to M8 planner (branch `build/raceplan-m1-m8`). This spec is authoritative for the next build: a new session runs writing-plans against it, then subagent-driven-development.

Formatting rule (whole codebase and all output): never use an em dash. Use commas or new sentences. Field and API names in English, reasoning in Swedish where natural.

---

## 1. Purpose and goal

Publish StickToThePlan as MIT open source so anyone can, in a hosted browser app, input their own route plus stop schedule plus time goal and immediately see per-depot split times (mellantider) and download the watch files. The calculation code is shared between the web app and the Node CLI with no duplication.

The verification this serves (Tim's stated goal): others test their own stop schedules and time goals on a route, read the speed and time per depot leg, and judge whether the split times come out reasonably calculated. No real-ride post analysis, no required cycling by the verifier. The reality validation of the model stays Tim's own job via the existing solo mode and CLI.

### Deliverables
1. A monorepo with a pure shared `core` package (the math and output builders), a `cli` package (the existing Node app, refactored to use core), and a `web` app (React, runs core in the browser).
2. A Vercel-hosted React SPA: upload a GPX, set stops and target and parameters, see a live depot split-time table and the full tempokort, download workout.fit, course.gpx, plan.json and PlanDelta.mc.
3. An NP performance optimization in core that makes the solve fast enough for interactive browser use, with an equivalence test proving identical results.
4. Open-source hygiene: MIT license, README, a model explainer, a committed synthetic sample route, CI, and de-personalization of the repo.

### Decisions locked this session
| Decision | Value |
|---|---|
| License | MIT |
| Scope | Full browser app (compute runs client-side in a Web Worker) |
| NP optimization | Included (precomputed quartic moments, see section 4) |
| Hosting | Vercel, static SPA, client-side only for now |
| Weather in browser | Open-Meteo (has CORS) plus a calm toggle. Full 3-source ensemble via a serverless proxy is deferred to a later phase, OUT OF SCOPE here |
| Connect IQ `.prg` | Browser downloads the `.mc` source only. Compilation stays local via the CLI and SDK Manager |
| Code sharing | A single pure `core` package imported by both `cli` and `web`. No duplicated math |

### Out of scope (explicit)
- Serverless weather proxy for SMHI and MET Norway (later phase).
- `.prg` compilation in the browser (impossible, native binary).
- Rebrand or generalization away from the Vätternrundan example (optional, later).
- PWA or offline web caching, post-ride comparison loop.

---

## 2. Prerequisite

Merge `build/raceplan-m1-m8` into `main` first (it is the foundation and is currently unmerged). Do the open-source work on a fresh branch, for example `feat/oss-web`. Git identity timcv, conventional commits, no push without explicit OK.

---

## 3. Monorepo architecture (npm workspaces)

```
package.json                 # workspaces: ["packages/*", "apps/*"], root scripts, vitest
tsconfig.base.json
packages/
  core/                      # PURE TypeScript, no Node, no DOM
    package.json             # deps: fast-xml-parser, @garmin/fitsdk
    src/
      types.ts               # moved from current src/types.ts
      physics.ts
      chaingang.ts           # + NP optimization (section 4)
      planner.ts
      segmentation.ts
      config.ts              # applyDefaults only (pure). NO file IO here
      ingest/gpx.ts          # parseGpxString, dedupe, smooth, buildMicroSegments, ingestGpxString
      ingest/fit.ts          # readFitPowerBytes, analyzePass, determineAnchorFromPower
      weather/openMeteo.ts   # buildForecastUrl/buildEnsembleUrl, parseOpenMeteo (pure + universal fetch)
      weather/smhi.ts        # buildSmhiUrl, parseSmhi
      weather/metNorway.ts   # buildMetNorwayUrl, metNorwayHeaders, parseMetNorway
      weather/ensemble.ts    # buildEnsemble, makeWeatherFn
      output/tempokort.ts    # renderMarkdown, renderHtml
      output/splits.ts       # NEW buildSplitTable (depot splits / mellantider)
      output/fitWorkout.ts   # buildSteps, encodeWorkout(displaySegments,cfg): Uint8Array
      output/course.ts       # buildCourseGpx(...): string
      output/planJson.ts     # buildPlanJson(...): object
      ciq/generate.ts        # buildLookupTable, generatePlanDeltaSource (string only)
    index.ts                 # public surface re-exports
  cli/                       # Node app (the current src/, refactored onto core)
    package.json             # deps: @stp/core, plus Node-only bits
    src/
      loadConfig.ts          # fs read + applyDefaults from core
      weatherFetch.ts        # fetchOpenMeteo/fetchSmhi/fetchMetNorway orchestration + cache (fs)
      fileIo.ts              # ingestGpx(path), readFitPower(path), write* wrappers (fs)
      ciqCompile.ts          # compilePlanDelta (monkeyc via child_process)
      cli.ts                 # arg parse, runPlan pipeline
apps/
  web/                       # Vite + React + TypeScript SPA
    package.json             # deps: @stp/core, react, react-dom; dev: vite
    index.html
    vite.config.ts
    src/
      main.tsx, App.tsx
      worker/solve.worker.ts # imports core, runs the full compute off the main thread
      components/...          # form, split table, tempokort table, download buttons, progress
    vercel.json or project settings
examples/
  sample-route.gpx           # SYNTHETIC, committed (no privacy, no copyright)
  sample-config.json
docs/, README.md, MODELL.md, LICENSE, .github/workflows/ci.yml
```

Package name scope, for example `@stp/core`, `@stp/cli`. Web imports `@stp/core` directly (Vite resolves the workspace). The math exists once, in `core`.

### 3.1 Pure vs IO split (the refactor)
Move the pure modules into `core` unchanged. Split the three currently file-coupled modules so the pure part lives in core and the IO wrapper lives in cli (and the browser provides its own IO):

- `config`: `applyDefaults(raw): Config` is already pure, move to core. `loadConfig(path)` (reads JSON via fs) stays in cli and calls `applyDefaults`.
- `ingest/gpx`: add `parseGpxString(xml: string): RoutePoint[]` and `ingestGpxString(xml, cfg): MicroSegment[]` to core (pure, fast-xml-parser works in the browser). The path form `ingestGpx(path, cfg)` (fs.readFileSync then call core) stays in cli. The web worker reads the uploaded File as text and calls `ingestGpxString`.
- `ingest/fit`: add `readFitPowerBytes(bytes: Uint8Array | number[]): number[]` to core (uses `@garmin/fitsdk` `Stream.fromByteArray`, no fs), plus `analyzePass` and `determineAnchorFromPower(powerStream: number[] | null, cfg): FitPassMetrics` (pure). The path form `readFitPower(path)` and `determineAnchor(cfg)` (fs) stay in cli. The web worker reads the uploaded FIT as an ArrayBuffer and calls `readFitPowerBytes`.
- `output`: core exposes builders that RETURN data, `encodeWorkout(...): Uint8Array`, `buildCourseGpx(...): string`, `buildPlanJson(...): object`, `renderMarkdown/Html(...): string`, `generatePlanDeltaSource(...): string`, and the new `buildSplitTable(...)`. The cli keeps thin `write*` wrappers that call these and write to disk. The web triggers Blob downloads from the same builders.
- `weather`: parsers and URL builders and `buildEnsemble` and `makeWeatherFn` are pure, move to core. `fetch*` functions use the universal `fetch`, they can live in core, but the multi-source orchestration plus disk cache stays in cli. The browser calls Open-Meteo directly using core's URL builder and parser (Open-Meteo allows CORS).
- `ciq`: `generatePlanDeltaSource` and `buildLookupTable` are pure strings, move to core. `compilePlanDelta` (monkeyc, child_process) stays in cli.

All existing 252 tests move with their modules (to core or cli) and must stay green. Behavior must not change.

---

## 4. NP performance optimization (core/chaingang)

The dominant solve cost today is `riderNpAtSpeed`, which renders a per-second square wave of length `n_riders * pull_seconds` (for example 540 samples), applies a circular 30 second rolling mean, and computes NP, and this runs inside the inner speed bisection inside the outer NP bisection over thousands of segments.

The rider NP depends only on the two power levels `P_pull` and `P_draft` for a fixed `(n_riders, pull_seconds)`. The 30 second rolling mean of a two level square wave at second i is a convex combination `a_i * P_pull + (1 - a_i) * P_draft`, where `a_i` is the fraction of that second's 30 second window lying in the pull phase. Precompute, ONCE per `(n_riders, pull_seconds)`, five moments of `a` over one cycle:

```
NP^4 = c4*Pp^4 + c3*Pp^3*Pd + c2*Pp^2*Pd^2 + c1*Pp*Pd^3 + c0*Pd^4
c4 = E[a^4]
c3 = 4*E[a^3*(1-a)]
c2 = 6*E[a^2*(1-a)^2]
c1 = 4*E[a*(1-a)^3]
c0 = E[(1-a)^4]
```

Then `riderNpAtSpeed` computes `Pp = pullPower(v)`, `Pd = draftPower(v)`, and `NP = (c4*Pp^4 + c3*Pp^3*Pd + c2*Pp^2*Pd^2 + c1*Pp*Pd^3 + c0*Pd^4)^(1/4)`. This is O(1) per call. Solo mode returns `Pp` directly (unchanged).

Requirements:
- The implementer MUST read the current `chaingang.ts` and reproduce its EXACT 30 second windowing (trailing vs centered, the circular wrap over one cycle) when computing `a_i`, so results are identical to the current implementation.
- Keep the original square wave implementation available as `riderNpSquareWaveReference` (exported for tests, or kept in the test file).
- Equivalence test: over a grid of `(Pp, Pd)` pairs (for example Pp in 100..400, Pd in 50..300), assert `abs(NP_optimized - NP_reference) < 1e-6`.
- Regression check: the planner's calm-wind solve must still produce np 145.9 W and total 11:45 on the real course (unchanged numbers).

Target: one calm-wind solve over the 4764 segment course drops from about 33 s to roughly 1 to 2 s. The web app runs the solve in a Web Worker regardless, so the UI never freezes.

---

## 5. Web app (apps/web)

Vite plus React plus TypeScript single page app. All compute client-side.

### 5.1 Inputs
- GPX file upload (required). Read as text, `ingestGpxString`.
- FIT file upload (optional). Read as ArrayBuffer, `readFitPowerBytes` then `determineAnchorFromPower`. If absent, `np_target` falls back to 0.60 x ftp.
- Form: `target_total_hm`, `ftp`, `n_riders`, `m`, an editable stops list (`control`, `km`, `minutes`), `watch_target` (pull or avg), and a weather mode toggle: `calm` (deterministic, no network) or `open-meteo` (client fetch, needs a race date and the route coordinates).
- Run button.

### 5.2 Compute (Web Worker, apps/web/src/worker/solve.worker.ts)
Imports `@stp/core`. Pipeline: `ingestGpxString` to microsegments, optional anchor from FIT, build config from the form, build weather (calm: `calmWeather`; open-meteo: fetch via core builders and parsers, then `buildEnsemble` and `makeWeatherFn`), `solveThreeScenarios` (or a single calm solve), `segment`, `buildSplitTable`. Post results to the main thread. Show a progress indicator while it runs.

### 5.3 Output (render)
- Scenario summary line (optimistic, expected, pessimistic total times and required NP).
- Depot split table (the mellantider, the primary verification surface): one row per leg between depots, columns leg (from to), distance, leg time, arrival clock, stop minutes, departure clock, cumulative time. Plus the start and the finish.
- Full tempokort table (the display segments) rendered as a React table from the `DisplaySegment[]` data (no need to render the markdown string).
- Download buttons, each calling a core builder and a Blob download: `workout.fit` (Uint8Array), `course.gpx` (string), `plan.json` (string), `PlanDelta.mc` (string). Note next to the `.mc` button: the `.prg` requires local compilation, link to the CLI instructions.

### 5.4 Privacy note shown in the UI
Uploaded GPX and FIT files are processed entirely in your browser and never uploaded to a server. In open-meteo mode, only the route coordinates and the date are sent to the Open-Meteo API to fetch wind.

---

## 6. New core module: depot split table (output/splits.ts)

`buildSplitTable(plan: PlanResult, cfg: Config, controls: ControlPoint[]): SplitRow[]` where a `SplitRow` is `{ fromControl, toControl, leg_distance_m, leg_time_s, arrive_s, stop_minutes, depart_s, cumulative_s }`. Derive from the plan segments and the control km markers (reuse the nearest-boundary logic from segmentation). This is the artifact that most directly answers "are the split times reasonable" and is rendered prominently in the web UI and added to the tempokort header.

---

## 7. Hosting (Vercel)

`apps/web` is a static Vite SPA, deployed to Vercel, client-side only for now. Configure the Vercel project for the monorepo: install at the repo root using workspaces, build command `npm run build -w apps/web` (or framework preset Vite with the root directory set to `apps/web` and a root install), output directory `apps/web/dist`. No serverless functions in this phase. Open-Meteo is called from the client. Add a `vercel.json` if needed for the monorepo build, otherwise set it in the dashboard, document whichever is chosen in the README.

---

## 8. Open-source hygiene

- `LICENSE`: MIT, year 2026, holder the repo owner (confirm the name to use, default the GitHub handle timcv).
- `README.md`: what it is, the hosted Vercel link (fill after first deploy), quick start for the web app (open the URL, upload a route, set stops and target, read the splits, download files) and for the local CLI (`npm install`, `npm start`, `--calm`, `--offline`, bring your own GPX and FIT), a short model summary linking to MODELL.md, the MIT license, and the privacy note.
- `MODELL.md`: how split times are computed end to end (NP anchor, per-segment speed from physics and chaingang, leg time, depot ETA, splits), the validation numbers (314.89 km conservation, calm 11:45 and 10:55, sanity table), and references. This is the document a skeptic reads to judge the calculation.
- `examples/sample-route.gpx`: a SYNTHETIC route generated by a small committed script (a loop of roughly 50 to 100 km with a few climbs), plus `examples/sample-config.json`. Committed and not gitignored, since it is synthetic and safe. The web app links a "load the sample" action.
- `.github/workflows/ci.yml`: on push and pull request, `npm ci`, typecheck all workspaces, `vitest run`, and `npm run build -w apps/web`. Node 22.
- De-personalization before going public: make the MET Norway User-Agent contact configurable (default a generic project URL like the GitHub repo, not a personal email), and scrub `/Users/tim` paths and `tim@haus.se` from committed files (the current `build-report.md` and `weather/metNorway.ts`).
- Flip the GitHub repo from private to public under timcv after review.

---

## 9. Build plan (phases, for writing-plans to expand into bite-sized tasks)

**Phase 0, prerequisite.** Merge `build/raceplan-m1-m8` to main. Create `feat/oss-web`.

**Phase 1, shared core and NP optimization.** Set up the npm workspaces monorepo. Move the pure modules into `packages/core`, perform the pure vs IO split (section 3.1), refactor `packages/cli` to import core. Implement the NP optimization (section 4) with the equivalence test. Add `buildSplitTable` (section 6). Gate: all existing 252 tests pass (relocated), the NP equivalence test passes, the CLI still produces identical outputs (np 146 W calm, total 11:45), and one calm solve is measurably faster (target 1 to 2 s on the full course).

**Phase 2, web app.** First a short spike to confirm `@garmin/fitsdk` bundles and runs under Vite in the browser (decode a sample FIT, encode a workout to Uint8Array). If it fails, mitigate (wrap, polyfill, or make FIT upload optional and keep encode working). Then scaffold `apps/web` (Vite, React), the Web Worker running core, the upload and form UI, the split table and tempokort rendering, and the download buttons. Gate: loading the sample route in the browser produces a correct split table and downloadable files, the worker keeps the UI responsive.

**Phase 3, open source and deploy.** LICENSE, README, MODELL.md, the synthetic sample route and script, de-personalization, GitHub Actions CI, and the Vercel deploy configuration. Gate: CI green, a Vercel preview deploy loads and a sample run works end to end in the browser, no personal paths or email remain in committed files.

**Phase 4, later (out of scope now).** Serverless weather proxy for the full SMHI and MET Norway ensemble, optional rebrand and generalization, PWA and offline.

---

## 10. Validation and tests

- Core: all relocated tests pass with no behavior change. NP equivalence test (section 4). The planner still yields np 145.9 W and 11:45 calm on the real course.
- Performance: measure a calm solve on the 4764 segment course before and after the optimization, report both, target 1 to 2 s after.
- Web: a smoke test that the worker runs on the sample route and yields a non-empty split table, plus a light component render test of the split table.
- CI green on push and pull request.
- Manual: a Vercel preview deploy loads, the sample route runs in-browser, the four files download and the FIT decodes back with the 1000 offset intact.

---

## 11. Risks

1. `@garmin/fitsdk` in the browser via Vite. De-risk with the Phase 2 spike before building the rest of the web app. Mitigation: wrap or polyfill, or make FIT upload optional while keeping workout encode.
2. Vercel monorepo build configuration. Resolve early in Phase 3, document the chosen config.
3. Solve performance on very large routes even after the optimization. The Web Worker keeps the UI responsive, and the optimization makes typical routes fast.
4. Keeping CLI behavior identical through the core extraction. The existing test suite is the guard, run it continuously during Phase 1.
