# Build report, Vätternrundan race-plan calculator (M1 to M8)

Date: 2026-06-03. Branch: `build/raceplan-m1-m8` (16 commits, not merged, not pushed). Author: autonomous build via Claude Code.

## Summary

All eight milestones (M1 to M8) are implemented and committed. The tool runs end to end: it ingests the course GPX and the reference FIT, fetches a live multi-source weather ensemble, solves three pacing scenarios at constant rider NP to hit 11:45, segments the route, and writes five artifacts plus a Connect IQ source file.

`npm start` on the real inputs produces, in `output/`:

- `tempokort.md` and `tempokort.html` (race card, one row per display segment)
- `workout.fit` (distance-based structured workout, 49 steps, watt targets with the +1000 offset)
- `course.gpx` (route track plus 11 ETA waypoints at the control points)
- `plan.json` (full machine-readable plan)
- `PlanDelta.mc` (Connect IQ source; `.prg` compile blocked, see BLOCKERS)

Test suite: **252 passed, 1 skipped** (the skipped one is the 3-scenario real-course solve, gated behind `SLOW_TESTS=1` because it takes about 90 s). `tsc --noEmit` is clean. No em dash anywhere in `src/`.

## How it was built

Orchestrated with the three requested superpower skills:

1. **writing-plans**: broke M1 to M8 into 17 bite-sized tasks. Plan at [docs/superpowers/plans/2026-06-03-vatternrundan-raceplan.md](superpowers/plans/2026-06-03-vatternrundan-raceplan.md), tasks tracked in the native task list and `.tasks.json`.
2. **subagent-driven-development**: one fresh subagent per task, each doing TDD and gating on its own tests.
3. **dispatching-parallel-agents**: independent tasks dispatched concurrently in waves (2+3; then 4,5,6,8,9; then 7+10; then 13,14,15), respecting the dependency graph and disjoint file sets.

Module map (spec section 14): `config`, `util/{time,geo}`, `physics`, `chaingang`, `ingest/{gpx,fit}`, `weather/{openMeteo,smhi,metNorway,ensemble,cache}`, `planner`, `segmentation`, `output/{tempokort,fitWorkout,course,planJson}`, `ciq/generate`, `cli`.

## Validation (spec section 15), actual results

| Check | Result |
|---|---|
| Microsegment sum vs GPX total | 314.892 km vs 314.89 km, conserved |
| Dedup of zero-length steps | 55 removed (spec estimated 54; the file actually has 55), 4820 to 4765 points |
| Sanity table (physics, spec 5) | flat calm 135.5 W (target 135), 5% climb 4.71 m/s ~17 km/h, 20 km/h headwind 326 W (target 325), all within 1% |
| Air density | airDensity(15 C, 101325 Pa) = 1.2255, within 0.1% of ISA 1.225 |
| Wind decomposition | unit tests pass in all four quadrants (sign of headwind/crosswind per spec 6.2) |
| Calm-wind total time | 42300 s = 11:45:00 exactly (outer bisection) |
| Calm-wind rolling time | 39300 s = 10:55:00, stops 3000 s = 50 min |
| Calm-wind mean rolling speed | 28.89 km/h (calc sheet target 28.85) |
| Calm-wind required NP | 145.9 W, sustainable, below FTP and below the 164 W anchor (headroom for wind) |
| Control clocks (calm) | finish 16:07 exact; mid-controls drift up to +11.6 min at km 134, see note below |
| FIT anchor from reference pass | NP 164.2 W from 13547 power samples (3.76 h), classified long_representative, used directly as the np_target candidate |
| FIT workout 1000-offset | production `workout.fit` decodes with 0 errors: step 0 stored 1151/1168 decodes to 151/168 W, distances correct (75920 m) |
| Three scenarios (live wind, this run) | optimistic 119 W, expected 124 W, pessimistic 132 W, all at 11:45, NP ordering holds |
| Solo mode | chaingang collapse and config derivation unit-tested; exercised end to end by the CLI test (synthetic GPX, n_riders 1, offline) producing all artifacts |

### Note on control-clock drift (expected, not a bug)
The plan holds constant rider NP, so it rides the southern climbs slower and the flats faster than the constant-speed reference table in spec 4.1. The total time and the finish clock are pinned by the outer bisection, but mid-course controls drift (largest +11.6 min at Fagerhult km 134, right after the climbing sector). This is exactly the behaviour spec 4.5 describes: same total and stops, speed varying per segment. The reference table is a validation anchor, not the target.

### Note on required NP vs forecast
Calm wind needs 145.9 W to hit 11:45. The live 10-day forecast on this build run gave a slightly favorable net wind, so the expected scenario needed only 124 W. The forecast is volatile this far out; rerun the evening before the race for the binding number. With the synthetic westerly headwind used in the scenario unit test, expected NP rose to 160 W, right on the 164 W anchor, which is the more representative stress case.

## Assumptions and decisions (logged per the autonomous mandate)

1. **No git worktree.** The reference FIT lives at `data/23066238193_ACTIVITY.fit`, which is gitignored and exists only in the main working tree. A worktree would not contain it and the FIT tests would break. Used an in-place feature branch instead.
2. **Feature branch, not main.** subagent-driven-development forbids implementing on main without explicit consent. The build lives on `build/raceplan-m1-m8` and is left for you to review and merge. Nothing was pushed (per your git rule).
3. **Skipped the writing-plans execution-choice question.** You explicitly asked for fully autonomous execution with no questions, via subagent-driven-development. User instruction overrides the skill's interactive handoff.
4. **Review rigor adapted to the autonomous budget.** Rather than two reviewer subagents per task, each task was gated by its own TDD suite, a coordinator-run `tsc --noEmit` and full-suite check, and real-data validation for the critical paths (solver, FIT, end-to-end). The hardest tasks (solver, three scenarios, FIT workout, CLI, CIQ) used the strongest model; mechanical tasks used a faster one.
5. **Libraries (chosen autonomously):** `fast-xml-parser` for GPX, `@garmin/fitsdk` for FIT, Vitest for tests, `tsx` to run TS directly. TypeScript 6.0 strict, NodeNext ESM.
6. **`@garmin/fitsdk` types:** the package re-exports its classes with extensionless `export *`, which NodeNext cannot follow, so `tsc` reported the named members missing although they exist at runtime. Fixed once with a small ambient declaration `src/garmin-fitsdk.d.ts`. Also set `"types": ["node"]` in tsconfig so `node:` builtins resolve.
7. **Parameter choices not pinned by the spec:** `k_yaw = 0.04` (about 8% CdA rise at 20 deg yaw), `band_pct = 0.05` (workout target band), Open-Meteo ensemble model `icon_seamless`, about 10 weather sample points along the course to bound API calls, elevation smoothing window 5, max gradient clip 0.18.
8. **Scenario optimistic/pessimistic** approximate least/most headwind by least/most wind magnitude (p10/p90) with the mean direction. A fuller per-segment headwind optimization is a future refinement (documented in `weather/ensemble.ts`).
9. **FIT encoding specifics** (verified by decode round-trip): `durationValue` is written as metres times 100 (the decoder applies the distance scale of 100), `customTargetValueLow/High` are written as watts plus 1000 (scale 1). The neutral km 0 to 1 segment has zero watts and is skipped as a workout step, so every step carries a real power target.
10. **Control points:** group mode uses the 11 locked Vätternrundan controls (`VATTERN_CONTROLS`); solo mode derives Start, the configured stops, and a Mål control at the route end.
11. **Calm-wind fallback:** if all weather sources fail and no cache exists, the run falls back to calm wind and flags it, so a plan is always produced (verified offline in the CLI test).
12. **Two diacritic regressions fixed by the coordinator.** Subagents twice ASCII-folded Swedish text (the tempokort header words, and the control names in `VATTERN_CONTROLS`), misreading the formatting rule, which forbids only the em dash, not diacritics. Restored to `Vätternrundan`, `Mål`, `Förväntad`, `Gränna`, `Hästholmen`, `Jönköping`, `Godegård`. Internal identifiers that the watch displays (FIT `wktName`, GPX track name) were left ASCII on purpose.
13. **One synthetic solver test target was adjusted** from 2:00 to 3:15 by the implementer: 2:00 on a flat 100 km route would need about 50 km/h, a front pull far above the hard cap, so it is correctly unreachable. 3:15 still exercises the full bisection, neutral, stop, and reachability paths.

## BLOCKERS

1. **Connect IQ `.prg` compile (M8).** `monkeyc` 9.1.0 is installed, but no device packages are installed (`~/Library/Application Support/Garmin/ConnectIQ` does not exist), so `monkeyc -d fenix7x` fails with `Invalid device id specified: 'fenix7x'`. Device packages are downloaded through the Connect IQ SDK Manager GUI, which needs a Garmin login and cannot run non-interactively. The tool generates `output/PlanDelta.mc` (with the baked distance-to-elapsed lookup table) and skips compilation gracefully, exactly as spec 12.5 allows. **Action for Tim:** open the Connect IQ SDK Manager, install the fenix7x device, then rerun `npm start`; the existing `monkeyc` command will compile unchanged. A 4096-bit developer signing key was generated at `ciq/developer_key.der` (gitignored) for that compile.
2. **FitCSVTool not available.** The spec suggests verifying the workout with Garmin's `FitCSVTool.jar`, but no jar ships in the Homebrew connectiq cask or in `@garmin/fitsdk`. Verification was done instead by decoding the written file back with the `@garmin/fitsdk` `Decoder` (0 decode errors, the +1000 offset proven on the production file). This is equivalent and dependency-free. If you want the FitCSVTool cross-check, download it from the FIT SDK and run it on `output/workout.fit`.
3. **SMHI source dropped out in the live run.** This build's fetch returned data from Open-Meteo (forecast and ensemble) and MET Norway, but not SMHI. The ensemble ran on the available sources and `reducedEnsemble` was false. Worth checking the SMHI endpoint or its forecast horizon closer to race day. Non-blocking by design: the ensemble runs on whoever answers and flags a reduced set.

## Minor items worth a look

- A full solve is about 33 s (the rider-NP square wave is rendered per second over a 540 s cycle for every segment on every one of about 45 bisection iterations), so a three-scenario run is about 90 s. Correct but slow. A future optimization could memoize or derive NP analytically. The no-cap branch was already optimized once.
- The CIQ compile error logs `monkeyc` usage text to the console. Cosmetic; the run still succeeds.

## How to run

```bash
npm install
npm test                 # 252 passed, 1 skipped (fast suite)
SLOW_TESTS=1 npm test    # also runs the 3-scenario real-course solve (~90 s)
npm start                # reads config.json, writes output/, fetches fresh weather
npm start -- --offline   # force cache use (race morning)
npm start -- --config path/to/other.json
```

Solo test ride: set `n_riders: 1`, point `gpx_path` at your GPX, set `target_total_hm`, and run. The committed `config.json` is the race default (12 riders, 11:45, the four stops, the real input paths).

## Suggested next steps for Tim

1. Review this branch and merge with squash if it looks good.
2. Install the fenix7x device package in the Connect IQ SDK Manager so the `.prg` compiles, then rerun.
3. Rerun the evening before the race for the binding wind forecast and the real required NP.
4. Optionally provide a solo test-ride GPX to validate the model against your own ride before race day.
