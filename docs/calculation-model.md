# Calculation model and algorithm: StickToThePlan

A complete technical description of how the app computes a pacing plan (tempokort) for Vätternrundan and other road-cycling routes. The goal is that a reviewer (human or LLM) can check the physics, the algorithm, and the plausibility without reading the source, but with exact file references for going deeper.

All code lives in `packages/core/src/`. The web app (`apps/web`) and CLI (`packages/cli`) consume only this core.

---

## 0. Overview and data flow

```
GPX file ──► ingest ──► microsegment[]  ─┐
                                         ├─► pacing solver ─► PlanResult ─► segmentation ─► tempokort / FIT / plan.json
Weather (manual/fetched) ─► EnsembleField ┘
```

1. **Ingest** (`ingest/gpx.ts`): GPX → ordered list of `MicroSegment` (~66 m each, 4764 for Vätternrundan 315 km). Each microsegment has distance, grade, bearing, and a start lat/lon.
2. **Weather** (`weather/*`): either manual constant wind, a fetched ensemble, or calm. Represented as an `EnsembleField` (grid cells with wind speed/direction) plus a `WeatherFn` that answers the wind at (lat, lon, clock time).
3. **Pacing solver** (`planner.ts`, `physics.ts`, `chaingang.ts`): holds a constant rider NP over the whole route, solves ground speed per microsegment, applies power caps, inserts stops. An outer bisection adjusts NP to hit the target finish time.
4. **Segmentation** (`segmentation.ts`): merges microsegments into display segments (tempokort rows).
5. **Output** (`output/*`): markdown/HTML tempokort, FIT workout, course GPX, `plan.json`.

---

## 1. Units and sign conventions

| Quantity                          | Unit                       | Sign                                                     |
| --------------------------------- | -------------------------- | -------------------------------------------------------- |
| Speed `v`                         | m/s internally, km/h in UI | always ≥ 0                                               |
| Grade `grade`                     | decimal (0.05 = 5 %)       | + uphill, − downhill                                     |
| Headwind `headwind`               | m/s                        | **+ headwind (into the wind), − tailwind**               |
| Crosswind `crosswind`             | m/s                        | sign = side                                              |
| Wind direction `winddir_from_deg` | degrees, meteorological    | direction the wind comes **FROM** (0 = north, 90 = east) |
| Bearing `bearing_deg`             | degrees                    | direction of travel (0 = north, 90 = east)               |
| Power                             | W                          | pedal power unless stated otherwise                      |

The one easy pitfall: `headwind > 0` means **headwind**. So `v_air = v + headwind` is smaller than ground speed in a tailwind (negative headwind).

---

## 2. Input: route and microsegments

`ingestGpxString` (`ingest/gpx.ts:170`):

1. **Parse** GPX points (lat, lon, ele).
2. **Dedupe** (`dedupePoints`): drop a point if its haversine distance to the previous kept point is < 0.5 m.
3. **Smooth elevation** (`smoothElevation`): centered moving average, odd window `ele_smooth_window` (default 5), truncated symmetrically at the ends.
4. **Build microsegments** (`buildMicroSegments`): one segment per consecutive point pair.
   - `distance_m` = haversine (`util/geo.ts:18`).
   - `bearing_deg` = forward azimuth (`util/geo.ts:37`), `atan2(sin Δlon·cos lat2, cos lat1·sin lat2 − sin lat1·cos lat2·cos Δlon)`.
   - `grade` = (ele_end − ele_start) / distance, **clamped to ±`max_grade`** (default 0.18).
   - `neutral` = true if the segment's START cumulative distance < `neutral_distance_km`·1000 (default 1 km).
   - `lat/lon` = the start point's coordinates (used for weather lookup).

Microsegment length varies with GPX point density (no resampling). For Vätternrundan ~66 m on average.

---

## 3. Physics model (steady state)

`pedalPower(v, grade, headwind, p, crosswind)` in `physics.ts:20`. `p` is `{m, g, crr, eta, cda, rho}`.

```
theta    = atan(grade)
F_grav   = m · g · sin(theta)                              // gravity along the road
F_roll   = m · g · cos(theta) · crr                       // rolling resistance
u        = v + headwind                                   // axial apparent wind, + into wind
v_app    = hypot(u, crosswind)                            // true apparent-wind magnitude
F_aero   = 0.5 · rho · CdA · v_app · u                    // drag magnitude v_app, projected on axis, sign from u
P_wheel  = (F_grav + F_roll + F_aero) · v                 // power at the wheel (ground speed!)
P_pedal  = P_wheel / eta                                  // drivetrain efficiency
```

**Vector apparent wind.** The formula uses the true apparent-wind magnitude `v_app = hypot(u, crosswind)` in `F_aero`. Crosswind therefore raises drag in two compounding ways: it inflates `v_app` directly, and it raises the yaw angle which scales up CdA (section 3.2). With `crosswind = 0`, `v_app = |u|` and the formula is byte-identical to the legacy axial form.

Things to check:

- `F_aero` uses `v_app · u`: magnitude is the true apparent-wind speed, but the projection onto the travel axis uses `u`. Tailwind stronger than ground speed (`u < 0`) gives forward-assisting aero force. Correct.
- `P_wheel` is multiplied by **ground speed `v`**, not air speed. Correct (power = force × ground velocity).
- No acceleration/inertia (steady state per segment). Reasonable for planning.

**Inverse (speed given power)**: `solveSpeedForPower(target, grade, headwind, p, crosswind)` (`physics.ts:40`), bisection `v ∈ [0.5, 25] m/s` (= 1.8–90 km/h), 100 iterations, tolerance 0.01 W. Assumes a single crossing in the interval (holds for a positive target; the power curve crosses the target once in the positive region).

### 3.1 Air density

`airDensity(tempC, pressurePa, relHumidity=0)` (`physics.ts:91`):

```
Rd = 287.058 J/(kg·K),  T = tempC + 273.15
dry air:  rho = p / (Rd · T)
moist (if RH>0):  Tv = T / (1 − (e/p)(1 − Rd/Rv)),  rho = p / (Rd · Tv)
   es = 611.2 · exp(17.67·(T−273.15)/(T−29.65))   [Tetens],  e = RH · es,  Rv = 461.5
```

The planner calls `airDensity(temp, pressure)` without humidity (dry). Manual wind uses temp 10 °C, pressure 101325 Pa ⇒ rho ≈ 1.247. Neutral segments use `rho_fallback` (1.2) but carry 0 power anyway.

### 3.2 Yaw-adjusted CdA

`yawCdaFactor(crosswind, vAir, kYaw)` (`physics.ts:125`):

```
yaw    = atan2(crosswind, vAir)              // apparent wind angle
yaw    = clamp(yaw, -50°, +50°)              // wind-tunnel valid range; prevents u<0 blow-up
factor = 1 + kYaw · |yaw_deg| / 10           // ≥ 1
```

Multiplied onto CdA (both pull and draft). `k_yaw` default 0.04 ⇒ ~8 % CdA rise at 20° yaw. Models crosswind increasing the effective frontal area. The ±50° clamp prevents a spurious near-180° yaw angle when a tailwind is stronger than ground speed (`u < 0`), keeping the factor within its wind-tunnel-valid range. See `docs/aero-model.md` for a fuller explanation.

---

## 4. Wind decomposition

`decomposeWind(W, phiFrom, beta)` (`physics.ts:70`):

```
delta     = (phiFrom − beta) · π/180
headwind  = W · cos(delta)              // + headwind, − tailwind
crosswind = W · sin(delta)
```

`phiFrom` = the direction the wind comes from, `beta` = direction of travel. Check: travelling north (`beta=0`) with wind from the north (`phiFrom=0`) ⇒ `delta=0` ⇒ `headwind=+W` (headwind). Travelling north with wind from the south (`phiFrom=180`) ⇒ `headwind=−W` (tailwind). Correct.

**Important**: the decomposition happens **per microsegment** using that segment's own bearing (`planner.ts`, the call inside the inner solve). On a loop like Vätternrundan (south down the east shore, north up the west shore) a constant wind direction therefore yields the correct head/tail alternation with no extra logic.

---

## 4a. Effective wind (height correction and terrain exposure)

**Not a CFD model.** z0 values are literature starting points, not calibrated to real rides. Exposure sharpens where on the route wind is high or low; it does not claim to compute the exact amount.

### 4a.1 Height correction

Forecast wind is given at 10 m (WMO standard). A cyclist sits at ~1.2 m. The neutral logarithmic wind profile gives the scaling factor:

```
k = ln(riderH / z0) / ln(forecastH / z0)         // where z0 is aerodynamic roughness length
k = clamp(k, 0.15, 1)
effW = max(0, rawW * k)
```

Implemented in `adjustWindForHeight` (`weather/effective.ts`). Applied per microsegment in `runInnerSolve` when `apply_wind_height_correction = true` (the default).

For the default mixed terrain (z0 = 0.05), a 6 m/s forecast maps to ~3.6 m/s at rider level (k ≈ 0.600). On the full Vatternrundan route this reduces the required NP by ~19 W compared to using the raw 10 m wind directly (see `docs/validation.md`).

**Escape hatch.** Set `rider_wind_height_m = 10` (same as `forecast_wind_height_m`) for k = 1 (no correction). Or set `apply_wind_height_correction: false` to treat the wind input as a manually felt wind already at rider level.

### 4a.2 Terrain roughness z0

Three-level priority in `resolveZ0(micro, cfg)` (`planner.ts`):

1. `micro.z0_used` -- per-segment exposure from baked OSM data (most precise).
2. `cfg.wind_roughness_z0` -- explicit override for the whole route.
3. `terrainToZ0(cfg.exposure_terrain)` -- coarse selector: open 0.03, mixed 0.05 (default), sheltered 0.30.

### 4a.3 Per-segment exposure classes

Seven classes with literature z0 values (NOT calibrated):

| Class       | z0 (m) | Description                        |
| ----------- | ------ | ---------------------------------- |
| `water`     | 0.001  | Open water                         |
| `bridge`    | 0.002  | Bridge deck                        |
| `open`      | 0.03   | Open farmland                      |
| `semi_open` | 0.08   | Mixed scrub (unclassified default) |
| `forest`    | 0.30   | Dense forest                       |
| `urban`     | 0.40   | Residential / commercial           |
| `sheltered` | 0.50   | Enclosed roads                     |

For Vatternrundan, baked offline by `scripts/bake-exposure.mjs` (queries OpenStreetMap via Overpass, RLE-compresses to `data/vatternrundan-exposure.json`). The core never fetches; the app injects via `applyExposure(microsegments, runs)`. See `docs/exposure-model.md`.

---

## 5. Group model (chaingang / paceline)

`chaingang.ts`. The group rotates: each rider leads the front for `pull_seconds` (default 45) of every `n_riders · pull_seconds`-second cycle, drafting the rest.

```
f_front = 1 / n_riders                  (= 1.0 if solo, n_riders = 1)     [chaingang.ts:14]
CdA_pull  = yawFactor · cda_pull         (default cda_pull = 0.32)
CdA_draft = yawFactor · cda_draft        (default cda_draft = 0.21, i.e. ~34 % less drag)
pullPower  = pedalPower with CdA_pull     [chaingang.ts:56]
draftPower = pedalPower with CdA_draft    [chaingang.ts:71]
P_mean = f_front · pullPower + (1 − f_front) · draftPower                  [chaingang.ts:86]
```

### 5.1 The rider's normalized power (NP)

The rider's power over one rotation cycle is a square wave: `pullPower` for `pull_seconds`, then `draftPower` for the rest. NP is defined as usual:

```
NP = ( mean_over_time( rolling_30s_mean(P)^4 ) )^(1/4)
```

Reference implementation (`riderNpSquareWaveReference`, `chaingang.ts:135`): build a per-second array over one cycle, apply a **circular** (the cycle repeats) trailing 30-second rolling mean, take the fourth-root mean.

**Closed form** (`npFromMoments`, `chaingang.ts:240`) is used in the speed solver: each rolling-mean sample is a convex combination `a_i·Pp + (1−a_i)·Pd`, where `a_i` is the fraction of the 30 s window in the pull phase. `(…)^4` expands binomially; the moments `c0..c4` of the occupancy `a_i` are precomputed per `(n_riders, pull_seconds)` and cached. NP is then an O(1) function of `(Pp, Pd)`. Proven equivalent to the square-wave reference within 1e−6 (`tests/chaingang.test.ts`).

`riderNpAtSpeed(v, …)` (`chaingang.ts:266`) ⇒ NP at a given speed. Solo: NP = pullPower (constant series).

**Inverse**: `solveSpeedForRiderNp(npTarget, …)` (`chaingang.ts:290`), bisection `v ∈ [0.5, 25]`, 60 iterations, tolerance 0.1 W on NP. Assumes NP monotonically increasing in v.

---

## 6. Pacing solver

### 6.1 Inner solve: `runInnerSolve(micro, npTarget, weather, cfg, startClockS)` (`planner.ts:96`)

Marches the route at a **constant rider NP = `npTarget`**:

For each microsegment:

- **Neutral segment** (km 0–1): fixed speed `neutral_speed_kmh` (20), no power/NP accounting.
- **Effort segment**:
  1. `w = weather(lat, lon, startClockS + elapsed)` → wind at the right clock time.
  2. `rho = airDensity(temp, pressure)`; `(headwind, crosswind) = decomposeWind(W, dirFrom, bearing)`.
  3. `v = solveSpeedForRiderNp(npTarget, grade, headwind, crosswind, rho, cfg)` → uncapped speed.
  4. `pPull = pullPower(v, …)`.
  5. **Hard cap**: if `pPull > pull_cap_hard` ⇒ lower v so `pull = pull_cap_hard`; mark `cap='hard'`.
  6. **Soft cap (climbs only)**: else if `grade > climb_threshold` (3 %) and `pPull > pull_cap_soft` ⇒ lower to `pull = pull_cap_soft`; `cap='soft'`.
  7. **Spin-out cap**: `vMax = max_plan_speed_kmh / 3.6`; if `v > vMax` ⇒ `v = vMax`; `cap='spinout'`. Overrides a hard/soft classification (it is the binding constraint on the final speed).
  8. Final powers: if no cap bound ⇒ `p_pull = pPull`, `rider_np = npTarget`. Otherwise recompute exactly at the final v. On `spinout`, `p_pull`/`p_draft` are clamped to ≥ 0 (a descent can give negative pedal power = freewheel).
  9. `p_mean = meanPower(p_pull, p_draft, f_front)`; `time = distance / v`.

**Stops** (`planner.ts`, the stops loop): each stop sits at the first segment boundary whose cumulative distance ≥ `stop.km·1000`. The stop delays that segment's and all subsequent segments' arrival times (`eta_s`) by `minutes·60`.

**Totals**: `total_time` (incl. neutral + stops), `rolling_time = total − stop_time`.

### 6.2 Sustainability: ride NP and IF (`planner.ts`, totals)

```
ride_NP = ( Σ_eff  rider_np_w_i^4 · t_i  /  Σ_eff t_i )^(1/4)      // time-weighted fourth-power mean
IF      = ride_NP / ftp
```

If `IF > sustain_if_warn` (0.75) a note is added (in Swedish, to match the app UI). `rider_np_ride_w` and `intensity_factor` are returned on `PlanResult` (shown in the UI and `plan.json`).

### 6.3 Outer solve: `solveForTargetTime(micro, weather, cfg)` (`planner.ts:266`)

Bisection on `npTarget` to hit the target time `target_total_hm`:

```
loNp = 60,  hiNp = ftp
fastest = runInnerSolve(hiNp)                  // fastest sustainable
if fastest.total_time > target:
    reachable = false; return fastest + explanatory note
else: bisect npTarget ∈ [60, ftp], 45 iterations, tolerance 20 s on total_time
      (total_time is monotonically decreasing in npTarget)
```

So NP is bounded above by FTP. If even NP = FTP cannot hit the target, `reachable=false` is reported and the fastest plan is returned.

### 6.4 The power caps: design choices

- `pull_cap_hard = round(pull_cap_mult · ftp)`, default `pull_cap_mult = 1.3` ⇒ 354 W at FTP 272. **Rationale**: a 45 s front pull is a short supra-threshold effort (~1.3× FTP is realistic). Sustainability is bounded by the rider's **NP** (the outer solve's [60, ftp] range), not by holding every pull under FTP. The earlier cap = FTP throttled ~95 % of segments into a headwind and wrongly reported "unreachable".
- `pull_cap_soft = round(0.92 · ftp)` = 250 W. Climbs > 3 % only. Prevents the group redlining every ramp.
- `max_plan_speed_kmh = 50`: a planning ceiling. A group will not plan (and for safety should not plan) a paceline faster than this in a tailwind/descent; the surplus is buffer, not banked time. Keeps tailwind splits credible for a tempokort.

---

## 7. Weather and scenarios

### 7.1 EnsembleField

`buildEnsemble` (`weather/ensemble.ts:109`) groups wind samples by (lat rounded 0.1°, lon 0.1°, hour). Per cell: vector-mean direction (`u = −W·sin(dir)`, `v = −W·cos(dir)`, `dir = atan2(−ū, −v̄)`), p10/p90 of scalar wind speed, mean temp/pressure.

`makeWeatherFn(field, scenario, startClockS, favorableWind)` (`weather/ensemble.ts`): each lookup picks the nearest cell via `score = distance_m/100000 + |hourDiff|/12`. Wind speed per scenario:

```
expected     → windspeed_mean_ms
optimistic   → favorableWind ? p90 : p10
pessimistic  → favorableWind ? p10 : p90
```

### 7.2 Manual wind

`buildManualField` (`weather/hourly.ts:77`): one cell per hour at the route centroid, `p10 = p90 = mean = the user's wind speed`, direction = the user's. All cells at the same location ⇒ every microsegment gets the same wind ⇒ **uniform constant wind** over the whole route. The head/tail variation comes solely from each segment's bearing.

### 7.3 Optimistic/pessimistic: direction correction

Problem: always choosing p90 as "pessimistic" assumes more wind = worse. On a **downwind route** more wind is faster, so the labels invert.

`routeIsNetDownwind(micro, field)` (`planner.ts`): project the route onto the field's dominant (vector-mean) wind direction:

```
exposure = Σ_eff  cos(dirFrom − bearing) · distance      // + into the wind, − downwind
favorableWind = exposure < −0.05 · total_distance         // clearly net downwind
```

- Net headwind or a balanced loop (exposure ≈ 0, e.g. Vätternrundan): `favorableWind=false`, pessimistic = p90 (more wind = slightly slower due to convexity).
- Net downwind: `favorableWind=true`, pessimistic = p10 (least tailwind = slowest).

The 5 %-of-distance deadband keeps balanced loops on the convex-correct default. Manual wind is unaffected (p10=p90).

### 7.4 Uncertainty interval (time spread from weather)

The three scenarios all hit the same target time (they differ in required NP). The honest time spread is computed by holding the expected scenario's NP fixed and re-marching the route under optimistic/pessimistic wind:

```
np = expected.np_target_used
lowTime  = runInnerSolve(microsegments, np, optimisticWeather, ...).total_time_s
highTime = runInnerSolve(microsegments, np, pessimisticWeather, ...).total_time_s

time_uncertainty_s = { expected: T, low: min(T, lowTime), high: max(T, highTime), source: 'scenario' }
```

Shown in the tempokort headline as "rimligt spann H:MM–H:MM". Collapses to "spann saknas" when the spread is less than 60 s (manual/calm wind or a very tight ensemble). See `docs/validation.md` for interpretation.

### 7.5 Data quality

`solveThreeScenarios` returns a `data_quality` object:

```
data_quality = {
  exposureCoveragePct: number,        // 0–100: % of route distance with a known exposure class
  exposureSource: 'baked' | 'terrain', // 'baked' if any microsegment has exposure_class
  weatherSource: 'manual' | 'forecast' // 'manual' if field.sources includes 'manual'
}
```

The web UI shows exposure coverage and warns (< 60 %) when the baked data is sparse or absent.

---

## 8. Segmentation and display

`segment()` (`segmentation.ts:277`) merges microsegments into display rows at: control points, stops, grade transitions (flat↔climb at `climb_threshold`), wind-sign flips, then merges down to `≤ maxSegments` and away below `min_segment_km`.

Per display segment:

- **Speed** = total distance / total time (time-weighted).
- **`avg_w`** = mean of `p_mean_w` (the rider's rotation-mean power). **This is the W column in the tempokort.**
- **`pull_w_low/high`** = pull mean · (1 ± `band_pct`), default ±5 %.
- **Wind label** from the mean head/crosswind: `Mot`/`Med`/`Sido` X m/s (Swedish UI labels: into/with/cross wind).

Note the distinction: the tempokort W column = **mean power** (~190 W in the example), while the scenario's "target power / NP" = `np_target_used` (target NP). After capping the achieved ride NP can be lower; the UI now shows target NP, rider NP, and IF.

---

## 9. Constants and defaults (`config.ts`)

| Parameter                      | Default     | Role                                            |
| ------------------------------ | ----------- | ----------------------------------------------- |
| `m`                            | 96 kg       | rider + bike                                    |
| `cda_pull`                     | 0.32        | CdA on the front                                |
| `cda_draft`                    | 0.21        | CdA drafting (~34 % lower)                      |
| `crr`                          | 0.0045      | rolling resistance                              |
| `eta`                          | 0.97        | drivetrain                                      |
| `g`                            | 9.81        | gravity                                         |
| `pull_seconds`                 | 45          | pull length                                     |
| `pull_cap_mult`                | 1.3         | hard cap = mult · ftp                           |
| `max_plan_speed_kmh`           | 50          | spin-out / planning ceiling                     |
| `sustain_if_warn`              | 0.75        | IF warning threshold                            |
| `climb_threshold`              | 0.03        | flat/climb boundary                             |
| `k_yaw`                        | 0.04        | yaw-CdA sensitivity                             |
| `neutral_speed_kmh`            | 20          | neutralized km 0–1                              |
| `max_grade`                    | 0.18        | grade clip                                      |
| `ele_smooth_window`            | 5           | elevation smoothing                             |
| `band_pct`                     | 0.05        | power band ±5 %                                 |
| `rider_wind_height_m`          | 1.2         | height cyclist feels wind at (m)                |
| `forecast_wind_height_m`       | 10          | height forecast wind is given at (m)            |
| `exposure_terrain`             | `mixed`     | coarse terrain selector (open/mixed/sheltered)  |
| `wind_roughness_z0`            | (none)      | explicit z0 override; bypasses terrain selector |
| `apply_wind_height_correction` | `true`      | false = treat wind as already at rider level    |
| `ftp`                          | 272 (input) | threshold power                                 |
| `n_riders`                     | 12 (input)  | group size                                      |
| Derived: `pull_cap_hard`       | 354         | = round(1.3·272)                                |
| Derived: `pull_cap_soft`       | 250         | = round(0.92·272)                               |
| Derived: `solo`                | false       | n_riders === 1                                  |

The anchor `np_target` (FIT, or 0.60·FTP fallback, `ingest/fit.ts`) is informational; the time-driven solver bisects NP regardless.

---

## 10. Assumptions and known limitations

For the reviewer, these are deliberate simplifications:

1. **Steady state per segment**: no acceleration/inertia. Negligible at 66 m segments.
2. **Constant rider NP over the whole ride**: the model evens out effort. The head/tail asymmetry in speed is inherent (constant power ⇒ high tailwind speed, low headwind speed). The spin-out cap dampens the tailwind side.
3. **`f_front = 1/n_riders`** independent of `pull_seconds` (pull length affects only NP variability, not the mean front share).
4. **Draft model** = lower CdA (0.21 vs 0.32), not an explicit distance dependence. Gives ~34 % drag reduction while drafting.
5. **The pull cap (1.3·FTP)** is a coarse supra-threshold bound, not a power-duration curve. It does not scale with `pull_seconds`.
6. **The spin-out cap** is a planning limit (50 km/h), not a cadence/gearing model. It also caps steep descents (conservative; ~0.5 min over 315 km in calm).
7. **Optimistic/pessimistic** captures wind-speed uncertainty (p10/p90) + net direction, not full per-cell direction uncertainty.
8. **Grade clamped ±18 %**, elevation smoothed (window 5). GPX elevation noise would otherwise produce spurious steep segments.
9. **NP across segments**: ride NP is approximated as the time-weighted fourth-power mean of the per-segment NPs (30 s boundary effects between segments are ignored).
10. **Wind height correction uses a neutral log profile.** Stability corrections (Monin-Obukhov) are omitted. The neutral profile is a reasonable daytime assumption for a race day but may under-correct in strongly unstable conditions.
11. **z0 values are literature starting points, not calibrated.** Exposure classification sharpens where on the route wind is attenuated, not the exact magnitude. See `docs/validation.md` for the calibration roadmap.
12. **The uncertainty interval captures wind-speed uncertainty only.** Direction uncertainty, rider performance variability, and mechanical factors are not modelled.

---

## 11. Validation: what a reviewer should check

### 11.1 Physics vs textbook (flat, ρ = 1.225, m = 96, CdA = 0.32, Crr = 0.0045, η = 0.97)

At constant **pull power 272 W**, ground speed vs headwind:

| headwind | +10  | +5   | +3   | 0    | −3   | −5   | −10 (tailwind) |
| -------- | ---- | ---- | ---- | ---- | ---- | ---- | -------------- |
| km/h     | 19.0 | 27.1 | 31.0 | 37.4 | 44.5 | 49.5 | 62.8           |

These match standard cycling physics (`P = v·(Crr·m·g + 0.5·ρ·CdA·(v+hw)²)/η`) to the decimal. Verify the 0-wind point 37.4 km/h and the +10 point 19.0 km/h by hand.

### 11.2 Suggested test cases (beyond the existing 309)

- **Symmetry**: `decomposeWind(W, φ, β)` vs `decomposeWind(W, φ, β+180)` ⇒ headwind flips sign, |crosswind| equal.
- **Degrees/radians**: `pedalPower` with `grade = tan(5°)` ⇒ `F_grav = m·g·sin(atan(tan5°))`; verify against `m·g·sin(5°)`.
- **Spin-out**: strong tailwind + high NP ⇒ no effort segment > `max_plan_speed_kmh`, some `cap='spinout'`, no negative power. (exists: `tests/headwind-caps.test.ts`)
- **Supra-FTP pull**: headwind + NP near FTP ⇒ some `p_pull_w > ftp` but `≤ pull_cap_hard`. (exists)
- **IF warning**: a hard plan ⇒ `intensity_factor > sustain_if_warn` and a note containing "IF". (exists)
- **Net-downwind inversion**: a downwind route ⇒ pessimistic slower than optimistic. (exists: `tests/scenarios.test.ts`)
- **Monotonicity edge**: rider NP in a strong tailwind where `v_air` crosses 0 (pull can go negative, fourth power in NP). Today the cap/clamp handles it; should be covered by a test.

### 11.3 Plausibility limits the app already warns on

- `reachable = false` when the target is unsustainable even at NP = FTP.
- IF note when `ride_NP / ftp > 0.75`.
- Cap note with the count of hard/soft/spin-out-bound segments and the time moved.

### 11.4 Compare the effect of wind (0 / 3 / 5 / 10 m/s)

Run the same route/config across the wind speeds and review:

- Average speed per control leg and total time.
- That tailwind legs are ≤ `max_plan_speed_kmh`.
- That headwind legs do not collapse (Vätternrundan: ~20 km/h at 10 m/s, not ~0).
- That `np_target_used` and IF grow monotonically with wind speed.
- That 0/3/5 m/s are `reachable=true` at 11:45 and 10 m/s becomes reachable with an IF warning (~0.80).

---

## 12. File reference

| Area                                             | File                                     |
| ------------------------------------------------ | ---------------------------------------- |
| Physics (forces, density, yaw, wind, NP)         | `packages/core/src/physics.ts`           |
| Group model (pull/draft, NP closed form)         | `packages/core/src/chaingang.ts`         |
| Pacing solver (inner/outer, caps, IF, scenarios) | `packages/core/src/planner.ts`           |
| Configuration and defaults                       | `packages/core/src/config.ts`            |
| Types                                            | `packages/core/src/types.ts`             |
| Ingest GPX → microsegment                        | `packages/core/src/ingest/gpx.ts`        |
| Geo (haversine, bearing)                         | `packages/core/src/util/geo.ts`          |
| Weather ensemble + WeatherFn                     | `packages/core/src/weather/ensemble.ts`  |
| Manual/hourly wind                               | `packages/core/src/weather/hourly.ts`    |
| Effective wind (height correction, z0, CLASS_Z0) | `packages/core/src/weather/effective.ts` |
| Per-segment exposure (apply, coverage)           | `packages/core/src/weather/exposure.ts`  |
| Exposure bake script                             | `scripts/bake-exposure.mjs`              |
| Baked exposure data (Vatternrundan)              | `data/vatternrundan-exposure.json`       |
| Segmentation (tempokort rows)                    | `packages/core/src/segmentation.ts`      |
| Tests                                            | `packages/core/tests/*.test.ts`          |
| Wind model detail                                | `docs/wind-model.md`                     |
| Aero model detail                                | `docs/aero-model.md`                     |
| Exposure model detail                            | `docs/exposure-model.md`                 |
| Validation and before/after figures              | `docs/validation.md`                     |
