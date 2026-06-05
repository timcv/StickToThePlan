# Validation report, Vätternrundan race-plan calculator

Records the numbers the model is validated against, from the M1–M8 build run on the real inputs (course GPX + reference FIT, 12 riders, FTP 272 W, start 04:22, target 11:45, four stops totalling 50 min). [MODELL.md](../MODELL.md) cites this report for its validation figures.

## What runs end to end

`npm start` on the real inputs ingests the course GPX and the reference FIT, fetches a multi-source weather ensemble, solves three pacing scenarios at constant rider NP to hit 11:45, segments the route, and writes to `output/`:

- `tempokort.md` / `tempokort.html` (race card, one row per display segment)
- `workout.fit` (distance-based structured workout, watt targets with the +1000 offset)
- `course.gpx` (route track plus ETA waypoints at the controls)
- `plan.json` (full machine-readable plan)
- `PlanDelta.mc` (Connect IQ source; the `.prg` compiles locally when a device package is installed)

Test suite at the original M1–M8 build run: **252 passed, 1 skipped** (the skipped one is the three-scenario real-course solve, gated behind `SLOW_TESTS=1`; one full solve over ~4760 microsegments is compute-heavy). `tsc --noEmit` clean.

After the wind-realism implementation (Tasks 1–8, see below): **354 passed, 4 skipped**, `tsc` and `eslint` clean. The calm-wind validation result (11:45:00 at 145.9 W) is unchanged: the height correction scales 0 wind to 0 wind, so all calm-air checks are bit-identical. The existing tests were written as orderings and inequalities and required no re-baselining.

## Validation results

| Check                                 | Result                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Microsegment sum vs GPX total         | 314.892 km vs 314.89 km, conserved                                                                                              |
| Dedup of zero-length steps            | 55 removed, 4820 → 4765 points                                                                                                  |
| Sanity table (physics)                | flat calm 135.5 W (target 135), 5% climb 4.71 m/s ~17 km/h, 20 km/h headwind 326 W (target 325), all within 1%                  |
| Air density                           | airDensity(15 C, 101325 Pa) = 1.2255, within 0.1% of ISA 1.225                                                                  |
| Wind decomposition                    | unit tests pass in all four quadrants (sign of headwind/crosswind)                                                              |
| Calm-wind total time                  | 42300 s = 11:45:00 exactly (outer bisection)                                                                                    |
| Calm-wind rolling time                | 39300 s = 10:55:00, stops 3000 s = 50 min                                                                                       |
| Calm-wind mean rolling speed          | 28.89 km/h (calc sheet target 28.85)                                                                                            |
| Calm-wind required NP                 | 145.9 W, sustainable, below FTP and below the 164 W anchor (headroom for wind)                                                  |
| Control clocks (calm)                 | finish 16:07 exact; mid-controls drift up to +11.6 min at km 134, see note                                                      |
| FIT anchor from reference pass        | NP 164.2 W from 13547 power samples (3.76 h), classified long_representative, used directly as the np_target candidate          |
| FIT workout 1000-offset               | production `workout.fit` decodes with 0 errors: step 0 stored 1151/1168 decodes to 151/168 W, distances correct (75920 m)       |
| Three scenarios (live wind, this run) | optimistic 119 W, expected 124 W, pessimistic 132 W, all at 11:45, NP ordering holds                                            |
| Solo mode                             | chaingang collapse and config derivation unit-tested; exercised end to end by the CLI test (synthetic GPX, n_riders 1, offline) |

### Control-clock drift (expected, not a bug)

The plan holds constant rider NP, so it rides the southern climbs slower and the flats faster than a constant-speed reference table. Total time and finish clock are pinned by the outer bisection, but mid-course controls drift (largest +11.6 min at Fagerhult km 134, right after the climbing sector). Same total and stops, speed varying per segment.

### Required NP vs forecast

Calm wind needs 145.9 W to hit 11:45. A favorable live forecast on the build run let the expected scenario need only 124 W; the forecast is volatile far out, so rerun the evening before the race for the binding number. With a synthetic westerly headwind in the scenario unit test, expected NP rose to 160 W, near the 164 W anchor, the more representative stress case.

### Wind height correction: before/after at 6 m/s westerly

Computed on the real 315 km route with a constant 6 m/s westerly wind (270 deg), baked OSM exposure, standard stops. Both runs target 11:45. This isolates the effect of `apply_wind_height_correction`:

| Setting                                | Required NP | Total time  |
| -------------------------------------- | ----------- | ----------- |
| Correction ON (default, mixed z0=0.05) | 159.0 W     | 11h 44m 49s |
| Correction OFF (raw 10 m wind)         | 177.8 W     | 11h 45m 01s |
| Delta (OFF minus ON)                   | +18.8 W     | ~12 s       |

Without correction the solver must find 18.8 W more NP to hit the same target, because the raw 10 m wind (6 m/s) is used directly rather than the physically appropriate rider-level effective wind (~3.6 m/s at 1.2 m over mixed terrain). The 12-second time difference between the two runs is a rounding artifact of the bisection tolerance (20 s); the two plans are equally fast at their respective NP. Source: throwaway script `/tmp/windy-demo3.mjs` using `packages/core/src` directly via `tsx`. See `docs/validation.md` for interpretation.

## How to reproduce

```bash
npm install
npm test                 # fast suite
SLOW_TESTS=1 npm test    # also the 3-scenario real-course solve (~90 s)
npm start                # reads config.json, writes output/, fetches fresh weather
npm start -- --offline   # force cache use (race morning)
```

The `data/` inputs are gitignored; point `config.json` at your own GPX/FIT. See [README.md](../README.md) for the full layout.
