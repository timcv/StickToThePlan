# Math review and improvement plan (2026-06-11)

> **Status (2026-06-11): all items M1–M11 implemented** in one pass (weather clock
> incl. UTC conversion + inline stops, scalar mean wind, ensemble members, yaw-consistent
> cap solve, time-weighted aggregation, band carry, humidity, slow-target guard, FIT 1 Hz
> resample + full-window NP, weather-cell memoization, NaN guards). Spec updated in
> `docs/calculation-model.md`; new/updated tests cover each item.

Scope: the mathematical model end to end. `physics.ts`, `chaingang.ts`, `planner.ts`,
`segmentation.ts`, `ingest/gpx.ts`, `ingest/fit.ts`, `util/geo.ts`, `weather/*`.
Baseline at review time: 48 test files, 361 passing, 10 skipped.

## What is sound

These were checked and need no change:

- **Aero projection** (`physics.ts:23-38`): `F_aero = 0.5*rho*CdA*v_app*u` is the correct
  axial projection of drag with apparent-wind magnitude `v_app = hypot(u, crosswind)`.
- **Grade trig** (`physics.ts:30-32`): `theta = atan(grade)` with `sin`/`cos` split between
  gravity and rolling resistance is exact for grade = rise/run, and `gpx.ts` computes grade
  as smoothed rise over haversine run, so the conventions are consistent.
- **Air density** (`physics.ts:97-113`): dry-air ideal gas plus virtual-temperature moist
  correction (Tetens) is textbook-correct. Open-Meteo `surface_pressure` (station level,
  not MSL) is the right variable for it.
- **Closed-form rider NP** (`chaingang.ts:183-304`): the occupancy-moment expansion of the
  square wave is exact w.r.t. the reference implementation and is pinned by tests. The
  braking clamp that restores monotonicity for the bisection is in place (the deep-review
  descent wrong-root is fixed).
- **Bisection solvers**: brackets and monotonicity arguments hold given the clamps; the
  spin-out cap catches the runaway branch on descents/strong tailwind.
- **Geodesy** (`util/geo.ts`): haversine + spherical bearing, fine at this scale.
- **Log wind profile** (`weather/effective.ts`): standard neutral profile with sane
  floor/cap; guards reject non-positive inputs.

## Findings

### M1. Weather clock is wrong three ways (HIGH, affects every forecast plan)

The contract (`types.ts:162-163`) says `WeatherFn(lat, lon, timeS)` takes **seconds from
race start**. Three inconsistencies stack:

1. **Double-added start clock.** `planner.ts:159` passes `startClockS + elapsed` (clock
   seconds since midnight), and `makeWeatherFn` (`ensemble.ts:237`) adds `startClockS`
   again: `queryHour = floor(((startClockS + timeS) % 86400) / 3600)`. A 06:00 start
   queries the **12:00** cell at km 0. The unit tests pass because they call the
   `WeatherFn` directly with `timeS = 0`; no test covers the planner-to-weather path.
2. **Local vs UTC.** `start_time` is local (CEST = UTC+2 in June) while cells are fetched
   with `timezone: 'UTC'` (`openMeteo.ts:42`). Known from the 2026-06-10 deep review
   (Phase B item 8), still open. Adds another 2 h shift.
3. **Stops excluded from the march clock.** `runInnerSolve` adds stop minutes after the
   loop (`planner.ts:254-272`), so a segment ridden after N stops queries wind up to the
   total stop time too early (30-45 min late in the race).

Net: with a 06:00 CEST start the solver prices km 0 with the 14:00-local forecast.
Morning-calm vs midday-wind difference makes this the largest pure-correctness error in
the model. Calm and manual-wind modes are time-constant, which is why validation numbers
never caught it.

**Fix:** pick one time contract (suggest: `timeS` = seconds from race start; planner
passes `elapsed` only), convert the local start to UTC once at the boundary using
`Intl.DateTimeFormat` with a configurable IANA zone (default `Europe/Stockholm`,
resolved at `race_date`), and add stop minutes to `elapsed` inline during the march.
Pin with an integration test: 06:00 CEST start must select the 04 UTC cell at km 0, and
a segment after a 20-min stop must select the correspondingly later hour.

### M2. Ensemble mean wind speed uses |vector mean| (MEDIUM-HIGH)

`buildEnsemble` (`ensemble.ts:157-162`) sets `windspeed_mean_ms = hypot(meanU, meanV)`.
When sources disagree on direction, components cancel and the expected wind speed is
biased low (two equal-speed opposite forecasts average to zero wind). Standard practice:
**scalar mean** of speeds for magnitude, vector mean only for direction. p10/p90 are
already scalar, so today the "expected" value can sit below p10.

### M3. Open-Meteo ensemble members are dropped (MEDIUM-HIGH)

`buildEnsembleUrl` requests `models=icon_seamless` but `parseOpenMeteo`
(`openMeteo.ts:81`) reads only `h.windspeed_10m`. The ensemble API returns per-member
arrays (`windspeed_10m_member01`...); only the control member is ingested. The p10/p90
spread therefore reflects 3-4 deterministic sources, not the ~40-member ensemble, so the
finish-time uncertainty band is structurally too narrow on agreeing days and noisy
otherwise. Parse member fields into `WindSample`s (one synthetic source per member or a
member count on the sample).

### M4. Pull-cap speed solve freezes the yaw factor (MEDIUM)

`speedAtPull` (`planner.ts:61-85`) fixes `cda = yawCdaFactor(crosswind, vRef + headwind)`
at the **uncapped** speed and solves with it. The capped speed is lower, the true yaw
angle larger, so the recomputed `p_pull_w` at the final speed (`planner.ts:215`) can
exceed the cap it was supposedly capped to. The NP solve does this correctly
(`riderNpAtSpeed` re-evaluates yaw per iteration). Fix: bisect on `pullPower(v) = cap`
directly (yaw inside the objective), e.g. a `solveSpeedForPullPower` in `chaingang.ts`;
then a capped segment shows pull power exactly at the cap.

### M5. Display aggregation uses unweighted micro means (MEDIUM)

`aggregateGroup` averages `p_pull_w`/`p_mean_w` per microsegment without weights
(`segmentation.ts:118-119`); `windLabel` and `meanHead` likewise
(`segmentation.ts:71-72,125`). Microsegment lengths follow GPX point density, so dense
clusters dominate the row's displayed watts and wind label. Fix: time-weighted means
(power is a per-time quantity; time weighting also matches how `avg_speed_kmh` is built).

### M6. Merged-row power band collapses when the left row coasts (LOW)

`mergeDisplaySegs` recovers `band_pct` from row `a` only
(`segmentation.ts:202-210`); if `aPullMid` is 0 (clamped descent row) the merged band is
0 even when `b` had a real band. Fix: store the numeric pull mean (or pass `cfg.band_pct`)
instead of reverse-engineering it from rounded display values.

### M7. Humidity correction exists but is never fed (LOW)

`airDensity` supports RH but `planner.ts:160` calls it without, and no provider fetches
`relativehumidity_2m`. Effect ~0.3-0.5% on density (more in warm rain). Cheap to thread:
add the field to `HOURLY_PARAMS`, average it in `buildEnsemble`, optional field on
`WindCond`, pass through in the planner.

### M8. Outer solver is silent when the target is slower than the easiest plan (LOW)

`solveForTargetTime` (`planner.ts:354-375`) handles "target too fast" with
`reachable=false` and a note, but if the target time is **slower** than the np=60 plan the
bisection pins to 60 W and returns a plan that beats the target by a margin, without any
note. Add the symmetric guard ("plan is X min faster even at minimum effort; add stop
time or lower the target").

### M9. FIT NP anchor: timing and window assumptions (LOW)

`analyzePass` (`fit.ts:36-39`) sets `duration_s = sample_count` (assumes 1 Hz, contiguous)
and filters null-power records, compressing time across gaps; with Garmin smart recording
a >2 h ride can land under the 7200-sample threshold and silently fall back to 0.6*FTP.
`normalizedPower` (`physics.ts:146-163`) also uses prefix windows for the first 29
samples, where standard NP uses only full 30 s windows, and is O(n*30) with per-sample
slice allocations. Fix: derive duration from record timestamps, resample to 1 Hz over
gaps, use full windows only, compute with a prefix sum.

### M10. Weather lookup is O(cells) per query (PERF)

`makeWeatherFn` scans every cell with haversine per microsegment query
(`ensemble.ts:249-262`). The deep review measured this as the dominant solver cost
(~59M haversine evals, ~8.8 s for three scenarios). Cells are already binned to 0.1
degrees and hour: precompute each microsegment's nearest spatial cell once (geometry does
not change between bisection iterations), leaving only the per-hour pick at query time.
Behavior-preserving; pin with a before/after plan snapshot.

### M11. NaN sanitation still missing at the weather and FIT boundaries (carryover)

Deep-review Phase B item 12 remains open: `buildEnsemble` (`ensemble.ts:128-180`),
`parseOpenMeteo`, and the FIT power stream have no finiteness guards; one NaN sample
poisons a cell's mean/percentiles and flows into physics. Not a formula error, but it
invalidates all downstream math when it happens.

## Plan

Order chosen so result-changing fixes land first and re-baselining happens once.

**Phase 1, correctness (changes forecast-mode outputs; re-baseline `docs/validation.md`
after):**

1. M1 weather clock: one time contract + UTC conversion + stops in the march clock.
   Integration tests pinning planner-to-hour selection. (M)
2. M2 scalar mean wind speed in `buildEnsemble`, direction stays vector-mean. (S)
3. M11 finiteness filtering in `parseOpenMeteo`/`buildEnsemble`/FIT power. (S)

**Phase 2, model consistency (small numeric shifts, visible in display values):**

4. M4 `solveSpeedForPullPower` with yaw inside the objective; capped rows show pull == cap. (S)
5. M5 time-weighted aggregation in `aggregateGroup`/`windLabel`. (S)
6. M3 parse ensemble members; uncertainty band reflects real spread. (M)
7. M8 slow-target note in the outer solver. (S)

**Phase 3, polish and performance (no plan-output changes expected):**

8. M10 precomputed cell index for `makeWeatherFn`; snapshot-pinned. (M)
9. M9 FIT duration from timestamps, 1 Hz resample, full-window prefix-sum NP. (M)
10. M7 humidity through to `airDensity`. (S)
11. M6 carry numeric pull mean through `DisplaySegment` merges. (S)

Each item is a separate PR with tests written first. Phase 1 items 1-2 are the only ones
expected to move headline plan numbers in forecast mode; calm-mode validation results
should be byte-identical throughout, which doubles as a regression gate.

Already tracked on the roadmap and intentionally not duplicated here: parameter
calibration from a reference ride (largest long-term accuracy lever), fixed-distance GPX
resampling before elevation smoothing, coherent ensemble members through the solver,
echelon/group drafting model.
