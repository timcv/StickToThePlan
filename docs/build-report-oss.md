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

(updated per phase)
