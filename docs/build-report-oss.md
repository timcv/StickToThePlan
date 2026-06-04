# StickToThePlan OSS Web Frontend, Build Report

Date: 2026-06-04. Branch: feat/oss-web. Executed autonomously via writing-plans + subagent-driven-development.

This report is updated as the build progresses. Final summary at the bottom.

## Assumptions and decisions (logged as made)

1. **No Workflow tool / no ultracode.** The user wrote "Ingen ultracode, inget Workflow-verktyg". A session hook flagged the substring "ultracode" as an opt-in; that is a false positive. User explicit opt-out wins. Orchestration uses superpowers skills only.

2. **Phase 0 is a no-op merge.** `main` and `build/raceplan-m1-m8` have byte-identical source trees (verified via `git diff --name-status`). The only difference: `main` additionally carries the spec doc; merging `build` would *delete* it. `main`'s squashed commit `bcd441e` already IS the M1-M8 foundation. So we do NOT run `git merge`; we branch `feat/oss-web` off `main`. Phase 0 intent (foundation on main) already satisfied.

3. **Execution method not prompted.** writing-plans normally ends with an AskUserQuestion choosing the execution method. The user pre-chose ("subagent-driven-development", "implementera helt autonomt", "Inga frågor under bygget"), so the question was skipped per instruction priority.

4. **No git worktrees.** The skill recommends worktree isolation. The user specified working on `feat/oss-web` in the main checkout with parallel subagents on disjoint files (and the coordinator doing all commits). Worktrees skipped.

5. **Coordinator executes the core extraction (Task 2) directly.** It rewrites imports across every file (shared state), so it is not parallelizable and is done in-context rather than delegated. Additive, file-disjoint work (NP opt, splits, web, docs) is delegated to subagents.

6. **Library versions (chosen autonomously):** Vite ^6, React ^19, react-dom ^19, @vitejs/plugin-react ^4, @types/react ^19, jsdom ^25, @testing-library/react ^16. Kept from baseline: TypeScript ^6.0.3, Vitest ^4.1.8, tsx ^4, @types/node ^25, @garmin/fitsdk ^21.205.0, fast-xml-parser ^5.8.0.

7. **`@stp/core` resolution.** Core exposes TS source directly via package.json `main`/`types`/`exports` = `./src/index.ts`. tsconfig path mapping resolves it for `tsc --noEmit` and Vitest without a build step; Vite transpiles the linked workspace TS; the CLI runs via tsx. No core prebuild needed.

8. **`fetchOpenMeteo` lives in core** (uses the universal `fetch`, browser-safe). SMHI and MET Norway fetchers and the multi-source orchestration + disk cache stay in cli.

9. **Connect IQ `.mc` template embedded in core** as a string constant (`ciq/template.ts`) so `generatePlanDeltaSource` is pure (no `fs.readFileSync`). The monkeyc compile path stays in cli, unchanged.

10. **`.gitignore` negation for the sample route.** The global `*.gpx` / `*.fit` ignore would exclude the committed synthetic `examples/sample-route.gpx`; a negation pattern is added so it is tracked.

## Baseline (pre-work, on main)

- Node 22.22.2, npm 10.9.7.
- `npm test` -> 252 passed, 1 skipped (22 files). Suite ~39 s (slow due to the square-wave NP, the Phase 1 target).
- monkeyc present at `/opt/homebrew/bin/monkeyc`.

## Progress log

### Phase 0 (done)
Branched feat/oss-web off main (no merge, see decision 2). Planning docs committed (6ccf7c7).

### Phase 1 (done): shared core + NP optimization
- Monorepo scaffold committed (dcbca7c): workspaces, tsconfig.base.json with @stp/core path mapping, transitional vitest. TS 6 needed paths without baseUrl and with leading `./`.
- Core/cli extraction committed (73b691e): 53 files, all moves tracked as git renames (history preserved). packages/core is pure (verified: no node:/fs/child_process/fileURLToPath). packages/cli holds loadConfig, fileIo, weatherFetch, cache, ciqCompile, cli. The .mc template is embedded as a string in core/src/ciq/template.ts.
- NP optimization committed (adc6585): precomputed quartic moments, O(1) riderNpAtSpeed. Equivalence vs the square-wave reference < 1e-6 over a (Pp,Pd) grid. **Calm solve on the full course: 34.6 s -> 0.31 s (~110x).** The whole test suite dropped 39.5 s -> 1.14 s.
- buildSplitTable committed (a505f63): depot split rows, arrival from rolling time + stops-before (no double count), km 0 is the implicit start.
- Gates: 261 passed | 1 skipped (the SLOW_TESTS-gated scenarios real-course smoke), typecheck clean. Planner unchanged: np 145.9 W, total 11:45 (verified via the data/-gated planner real-course test, which prints `np_target_used=145.9 W, total_time_s=42300 (11:45)`).
- Known minor wart: per-package `tsc --noEmit -w <pkg>` fails standalone (rootDir/project-reference artifact); the root `npm run typecheck` (used by CI) is clean. The redundant PlanDelta.mc.tmpl still sits in core next to template.ts (template.ts is the source of truth).

### Phase 2 (done): web app
- SPIKE PASSED (the de-risk gate). @garmin/fitsdk is browser-safe: its runtime src is pure ESM with no Node builtins (only .d.ts type files mention Buffer). `vite build` of apps/web bundles core + fitsdk with zero Node-builtin warnings; the Web Worker bundles into its own clean chunk. A jsdom Vitest spike encodes a workout via encodeWorkout, decodes it with the SDK Decoder/Stream and round-trips the +1000 watt offset, and builds an activity FIT via the SDK Encoder that readFitPowerBytes decodes back. No mitigation needed.
- apps/web scaffolded: Vite 6 + React 19 + @vitejs/plugin-react, jsdom + @testing-library/react for tests. Worker (solve.worker.ts) exposes a plain `runPipeline(input)` (testable without a real Worker) plus the worker message wiring; calm mode is fully offline (solveForTargetTime reused across scenarios), open-meteo mode fetches via core fetchOpenMeteo then buildEnsemble + solveThreeScenarios.
- apps/web tsconfig uses module ESNext + moduleResolution Bundler (Vite owns emit, bare React imports). To make output/fitWorkout.ts compile under BOTH NodeNext (core/cli) and Bundler (web), a small `writeFitMesg` typing wrapper was added (type-only, runtime identical; the SDK's hand-written writeMesg type is narrower than the encoder accepts).
- vitest.config.ts converted to projects: `unit` (node, packages/*) and `web` (jsdom, apps/web). 263 passed | 1 skipped.
- Full UI committed (8259ead): useSolver hook driving the worker, upload + parameter form with an editable stops list and load-sample, the depot split table (hero), scenario summary, tempokort from DisplaySegment data, and four Blob download buttons calling the pure core builders on the main thread, plus the privacy note. The pipeline was extracted to apps/web/src/lib/pipeline.ts so it is testable without a real Worker. Added a calm-mode smoke test and a SplitTable render test. Root typecheck now also runs the web workspace (it uses bundler resolution, so the NodeNext root tsc does not cover it otherwise).
- Controls fix committed (12d91d0): the worker hard-coded VATTERN_CONTROLS, which collapsed every control past the route end for any route shorter than 315 km. Now the depot controls are built generically as start + the user's stops (km order) + finish at the route end, passed to both segment and buildSplitTable, and the course.gpx download uses the same controls. This is the correct behavior for a route-agnostic tool. The CLI keeps the fixed VATTERN_CONTROLS for the Vatternrundan example.
- BROWSER VERIFIED (real Chromium via the preview harness, not just jsdom): the app loads with no console errors, "Load sample route" + "Run" produces a correct four-leg split table (Start, Depå 1, Krönet, Depå 2, Mål) summing to 74.7 km and hitting the 2:30 target with consistent arrival/departure clocks, and all four downloads produce valid blobs (workout.fit 348 B, course.gpx 82.6 KB, plan.json 504 KB, PlanDelta.mc 5.4 KB). The worker keeps the UI responsive (results arrive asynchronously).

### Phase 3 (done): open source and deploy
- Synthetic sample route committed (fc15408): deterministic generator (examples/scripts/gen-sample-route.mjs, seeded LCG, no deps), examples/sample-route.gpx (901 points, 74.8 km, 309 m ascent), examples/sample-config.json, and a .gitignore negation so the synthetic .gpx is tracked past the global *.gpx rule.
- Docs committed (5b67a6b): LICENSE (MIT 2026 timcv), README (hosted-app placeholder, web + CLI quick starts, monorepo layout, development, deployment, privacy), MODELL.md (the model end to end with validation numbers cited from the test suite and the M1-M8 report: 314.89 km conservation, calm 11:45 at np 145.9 W, rolling 10:55, plus the config-defaults table).
- CI committed (4850779): .github/workflows/ci.yml runs npm ci, typecheck, test, build:web on Node 22 for push and pull_request.
- De-personalization committed (8061372): MET Norway User-Agent contact is now configurable, defaulting to the public project URL (the personal email is gone). Home-directory paths and the personal email were scrubbed from the committed design and plan docs. A repo-wide grep for the personal email and /Users paths returns nothing.
- Vercel config (vercel.json): installCommand npm install (workspaces), buildCommand npm run build:web, outputDirectory apps/web/dist. Validated as JSON; the build is confirmed to emit apps/web/dist/index.html.

## Final validation (spec section 10)

| Item | Result |
|---|---|
| All relocated tests green | 268 passed, 1 skipped (the SLOW_TESTS-gated scenarios real-course smoke), 26 files, suite ~1.2 s |
| NP equivalence < 1e-6 | PASS (grid over Pp 100..400, Pd 50..300, two cycle shapes) |
| Planner unchanged | np 145.9 W, total 11:45 on the full 315 km course (data/-gated planner test) |
| Calm solve speed | 34.6 s -> 0.31 s (target was 1 to 2 s; far exceeded) |
| Web smoke + component | pipeline smoke on the sample route yields a non-empty split table; SplitTable renders one row per leg |
| No personal data | repo-wide grep for tim's email and /Users paths returns nothing |
| CI | workflow authored; the four steps (npm ci, typecheck, test, build:web) all pass locally; the lockfile is in sync so npm ci will install cleanly. Actual green-on-GitHub requires a push (not done; push is not authorized without an explicit request). |
| Vercel deploy | DEPLOYED to team demo-team1 (project sticktotheplan). Live and public at https://sticktotheplan.vercel.app (HTTP 200, serves the app HTML + the 661 KB JS bundle + CSS). The build ran on Vercel from vercel.json (npm install workspaces, build:web, apps/web/dist). The first CLI deploy went to production, which gave the clean public alias; deployment-specific URLs are behind Vercel's standard SSO protection, the production alias is public. The identical build was verified end to end in a local browser (sample run, correct split table, four downloads). |
| FIT round-trip with the 1000 offset | confirmed in the fitsdk spike (encode -> decode round-trips the +1000 watt target) under Vite/jsdom |

## Blockers

None. The two items that originally awaited the user (push for CI, and the Vercel deploy) were authorized and are done: PR #1 is open and CI is running, and the app is live on demo-team1 at https://sticktotheplan.vercel.app. The only remaining steps are discretionary (merge the PR, make the repo public).

## Out of scope (as specified)

Phase 4 (serverless weather proxy for the full SMHI + MET Norway ensemble) was skipped per the brief. The browser uses calm mode or the CORS-friendly Open-Meteo client directly.

## Notes and minor warts

- Per-package `tsc --noEmit -w <pkg>` for cli/web can fail in isolation (rootDir / module-resolution artifacts of standalone invocation). The root `npm run typecheck` (what CI runs) covers core + cli (NodeNext) and chains the web workspace (bundler resolution) and is clean.
- A redundant copy of PlanDelta.mc.tmpl remains in packages/core/src/ciq next to template.ts; template.ts (the embedded string) is the source of truth and the only one used.
- The main web bundle is ~660 KB (gzip ~137 KB), dominated by @garmin/fitsdk on the main thread for the downloads. Acceptable for an SPA; could be lazy-loaded later if desired.

## Publish status

1. DONE: pushed `feat/oss-web` and opened PR #1 (https://github.com/timcv/StickToThePlan/pull/1). CI runs on the push.
2. DONE: deployed to Vercel team demo-team1, live at https://sticktotheplan.vercel.app, and the README hosted-app link is filled.
3. REMAINING (user's call): merge PR #1 to main, and flip the GitHub repo from private to public.
