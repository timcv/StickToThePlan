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

### Phase 2 (in progress): web app
- SPIKE PASSED (the de-risk gate). @garmin/fitsdk is browser-safe: its runtime src is pure ESM with no Node builtins (only .d.ts type files mention Buffer). `vite build` of apps/web bundles core + fitsdk with zero Node-builtin warnings; the Web Worker bundles into its own clean chunk. A jsdom Vitest spike encodes a workout via encodeWorkout, decodes it with the SDK Decoder/Stream and round-trips the +1000 watt offset, and builds an activity FIT via the SDK Encoder that readFitPowerBytes decodes back. No mitigation needed.
- apps/web scaffolded: Vite 6 + React 19 + @vitejs/plugin-react, jsdom + @testing-library/react for tests. Worker (solve.worker.ts) exposes a plain `runPipeline(input)` (testable without a real Worker) plus the worker message wiring; calm mode is fully offline (solveForTargetTime reused across scenarios), open-meteo mode fetches via core fetchOpenMeteo then buildEnsemble + solveThreeScenarios.
- apps/web tsconfig uses module ESNext + moduleResolution Bundler (Vite owns emit, bare React imports). To make output/fitWorkout.ts compile under BOTH NodeNext (core/cli) and Bundler (web), a small `writeFitMesg` typing wrapper was added (type-only, runtime identical; the SDK's hand-written writeMesg type is narrower than the encoder accepts).
- vitest.config.ts converted to projects: `unit` (node, packages/*) and `web` (jsdom, apps/web). 263 passed | 1 skipped.
