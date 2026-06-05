# Validation — wind model and uncertainty interval

This document records the before/after figures for the wind height-correction change, explains what the uncertainty interval means, and describes the intended reference-ride replay method for future calibration.

---

## 1. What the uncertainty interval means

The three pacing scenarios (optimistic, expected, pessimistic) each solve for a **different NP** to hit the **same target finish time**. Their total times are therefore equal by construction and the interval between them carries no information about time uncertainty.

The honest finish-time interval is computed differently: the expected scenario's NP is held fixed, and the route is re-marched under optimistic and pessimistic wind. This reveals the actual time spread caused by weather uncertainty at a fixed rider effort:

```
time_uncertainty_s = {
  expected: T (the target, e.g. 42300 s = 11:45),
  low:      min(T, T_under_optimistic_wind),    // faster under lucky wind
  high:     max(T, T_under_pessimistic_wind),   // slower under bad wind
  source:   'scenario'
}
```

**Shown in the UI** as "rimligt spann H:MM-H:MM" in the tempokort headline. When the spread is less than 60 seconds (e.g. manual wind or calm) it collapses to "spann saknas" to avoid implying false precision.

**What it is not.** The interval only captures wind-speed uncertainty (p10/p90 of the forecast ensemble). It does not capture direction uncertainty, rider performance variability, mechanical failures, or nutrition.

**The interval is not symmetric around the target.** A purely symmetric forecast (balanced loop like Vatternrundan) will give a slightly asymmetric interval because more wind is slightly slower due to the convexity of aero drag (quadratic in speed). The optimistic side (lighter wind) saves less time than the pessimistic side loses.

---

## 2. Before/after: height correction on a real route

The following comparison was computed on the real Vatternrundan 315 km route with a constant 6 m/s westerly wind (from 270 deg), baked OSM exposure, target 11:45, FTP 272 W, 12 riders, standard stops. The comparison isolates the effect of `apply_wind_height_correction` with all other parameters identical.

**Script used:** `/tmp/windy-demo3.mjs` (throwaway, not committed), called via `tsx` with `packages/core/src` imported directly. The solve is a standard `solveForTargetTime` call; no approximations.

| Setting                               | Required NP | Total time  | Reachable |
| ------------------------------------- | ----------- | ----------- | --------- |
| Height correction ON (default)        | 159.0 W     | 11h 44m 49s | true      |
| Height correction OFF (raw 10 m wind) | 177.8 W     | 11h 45m 01s | true      |
| **Delta (OFF minus ON)**              | **+18.8 W** | ~12 s       | --        |

**Interpretation.** At 6 m/s forecast wind over mixed terrain (z0 = 0.05, default), the height correction reduces the effective rider-level headwind from 6 m/s to ~3.6 m/s. The route is a balanced loop so head and tailwind partially cancel; the net effect is that without correction the solver must find 18.8 W more NP to hit the same target time. That is a meaningful difference: it is a 12 % NP increase from a physically motivated correction, not a tuning parameter.

**Per-segment illustration (flat headwind, worst case).** On a flat segment at 35 km/h with a pure 6 m/s headwind into mixed terrain (z0 = 0.05):

|                               |              |
| ----------------------------- | ------------ |
| Height factor k               | 0.600        |
| Raw wind at 10 m              | 6.00 m/s     |
| Effective wind at 1.2 m       | 3.60 m/s     |
| Pedal power at raw wind       | 528 W        |
| Pedal power at effective wind | 391 W        |
| Power saving                  | 137 W (26 %) |

This illustrates that on a pure headwind segment the correction is large. The full-route delta (18.8 W NP) is smaller because Vatternrundan's balanced loop means roughly half the route benefits from tailwind, where the correction reduces the tailwind assist by the same factor, partly offsetting the headwind saving.

---

## 3. Illustrative factor table

Height factor k = ln(1.2/z0) / ln(10/z0), clamped to [0.15, 1]:

| Terrain         | z0   | k     | Effective wind (raw 6 m/s) |
| --------------- | ---- | ----- | -------------------------- |
| open            | 0.03 | 0.635 | 3.81 m/s                   |
| mixed (default) | 0.05 | 0.600 | 3.60 m/s                   |
| semi_open       | 0.08 | 0.561 | 3.37 m/s                   |
| sheltered       | 0.30 | 0.395 | 2.37 m/s                   |

---

## 4. Reference-ride replay (intended method)

The 2026-05-30 reference ride (NP 165 W, 99.8 km, 3.98 h, light wind 2-3 m/s southerly, Vasteras/Malaren area) is documented in `docs/research/2026-05-30-reference-pass-wind.md`. The FIT and GPX files are gitignored personal data.

A replay test would:

1. Ingest the reference FIT and GPX.
2. Build a per-hour `EnsembleField` from the historical wind data in the research doc (Open-Meteo best-match, ride-window mean ~1.9 m/s from 174 deg).
3. Solve `solveForTargetTime` targeting the actual elapsed time (3.98 h) and check that the required NP is near 165 W.
4. Because wind was light, the result should be close to the calm-air check; the test verifies the model does not blow up or over-correct for a low-wind ride.

**Why the test is not committed.** The replay requires the FIT and GPX files. Both are gitignored personal data and absent from the worktree and CI. A skeleton test was considered but omitted to avoid a permanently-skipped test that adds no value on CI. If the ride files are later added to a private fixture store, add `packages/core/tests/replay.reference.test.ts` gated on `process.env.SLOW_TESTS && existsSync(FIT_PATH)`.

---

## 5. Future calibration path

The current z0 values are literature starting points. To calibrate:

1. Collect a FIT from a ride on the Vatternrundan route (or a similar route with known exposure) in measured wind conditions.
2. Replay the ride segment by segment using the recorded GPS + recorded power.
3. Compare modelled speed (at the measured NP) to actual speed per segment.
4. Adjust z0 values per exposure class to minimize residuals.

This calibration cannot be done without a reference ride in meaningful wind. Until then, the exposure model makes directional sense but its magnitude should be treated as approximate. The primary value is "correctness of direction" (forest shields more than open farmland) rather than "exact magnitude".
