# Vätternrundan race-plan calculator, design doc

Date: 2026-06-03
Status: Design approved in principle (handover spec by Tim), locked with control points and stop plan below. Race date 2026-06-13.

Formatting rule for the whole codebase and all output: never use em dash. Use commas or new sentences. Code, field and API names in English, reasoning in Swedish where natural.

The authoritative requirements are Tim's handover (sections 1 to 20). This document is the implementation design: it restates the model compactly so an implementer can work from it alone, records the decisions made this session, locks the race structure from Tim's calc sheet, captures findings from the real input files, and lays out the build plan.

---

## 1. Purpose and deliverables

A local TypeScript/Node CLI run the day before the race that takes the course GPX, a historical Garmin FIT power ride, a live weather forecast and rider parameters, and produces:

1. A **raceplan (tempokort)** with display segments, clock time (ETA), target watts (pull and rider-average) and note keywords. Markdown plus print-friendly HTML/PDF.
2. A **distance-based structured FIT workout** for the Fenix 7X, one step per display segment, each with a power target band, so the watch drives effort in real time.
3. The **course** as GPX or FIT Course for navigation and ClimbPro.
4. **Three time scenarios** (optimistic, expected, pessimistic) from the weather ensemble spread.
5. A machine-readable **plan-JSON** capturing the full plan for reproducibility and review.

### Core principle
Total time 11 h 45 min, of which 50 min stopped, so about 10 h 55 min rolling over 314.9 km, about 28.85 km/h rolling. This is **not** constant speed. The plan holds **even effort** (constant rider normalized power, NP) and lets speed vary with gradient and wind, with caps so pulls never become unsustainable.

### The one insight that drives the design
For an eleven-hour effort the anchor is not FTP but the rider's sustainable NP, well below FTP. With FTP 272 W a reasonable default NP is about 0.60 x FTP, about 163 W. On flat ground in calm wind 28.85 km/h is trivially easy. The whole time budget is spent in two places: the climbing in the south and any headwind. The model is therefore precise around climbs and wind, and coarse elsewhere.

---

## 2. Decisions locked this session

| Decision | Value |
|---|---|
| Stack | TypeScript + Node (Node 22.22 confirmed). CLI first, thin local web view possible later. |
| Session scope | Spec + build plan only. No code written this session. |
| Input data | Real files provided (paths in section 3). |
| Stop plan | Locked from Tim's calc sheet (section 4), replaces handover 9.4 default. |
| Watch target | `pull` (dragwatt band drives the watch), `avg` switchable. |
| CdA | `cda_pull` 0.32, `cda_draft` 0.21. No wheel/helmet/clothing fine-tune until Tim gives specifics. |
| Climb policy | `pull_cap_soft` 0.92 x FTP = 250 W, `climb_threshold` 3% for backrabatt. |
| Group target | Rider-centric (Tim's numbers). `group_target_np` exposed but off by default. |
| Pull length | `pull_seconds` 45 s default. |
| n_riders (plan) | 12. Reference ride was 8 (see section 8). |

Race date locked to 2026-06-13 (Saturday), start time 04:22 confirmed by the timing table. Confirm the historical FIT is a long representative ride once decoded (section 8).

---

## 3. Input files (verified)

### Course GPX
`/Users/tim/Downloads/Vätternrundan 315 km (1).gpx`

- 4820 track points, single `<trkseg>`, creator `togpx`, GPX 1.1.
- Total distance 314.89 km (haversine over raw points). Matches the 315 km target and Tim's 315 km sum.
- Elevation present on every point. Raw min/max 90.9 / 208.3 m. Raw cumulative gain 1597 m, loss 1610 m. Raw is GPS-noisy, so smoothing will lower the gain. It already sits inside the handover's 1300 to 2000 m band.
- No `<time>`, no `<wpt>` waypoints. So control-point km markers come from Tim's table (section 4), matched to the route by cumulative distance, not from GPX metadata.
- 54 zero-length steps (duplicate consecutive points). Ingest must dedup before computing bearing and gradient.
- Bounding box lat 57.78 to 58.89, lon 14.10 to 15.16. Correct Vättern region.
- Start point near Motala, start-to-end gap 292 m, so the loop closes within GPS tolerance.

### Historical FIT power ride
`/Users/tim/Downloads/Referens pass med gruppen - 8 personer i klungan.zip` containing `23066238193_ACTIVITY.fit` (1.3 MB).

- Reference ride with the group, 8 riders in the bunch. Decode at implementation to read the power stream, duration, NP, mean power and (if present) GPS terrain.
- Anchor consequence: the reference rotation duty cycle was 1/8, the plan is 1/12. The rider's NP is the group-size-independent physiological anchor. See section 8.

---

## 4. Locked race structure (from Tim's calc sheet)

This replaces handover sections 2.2 specifics and 9.4. The timing table is a **validation reference**, not the target. The tool keeps start time, total time and stop plan exact, and redistributes rolling speed between segments by gradient and wind at constant effort.

### 4.1 Control points and legs

| Control point | km | Leg (km) | Stop | Cumulative time | Clock |
|---|---|---|---|---|---|
| Motala (start) | 0 | - | | 0:00 | 04:22 |
| MC release | 1 | 1 (neutral) | | 0:03 | 04:25 |
| Hästholmen | 40 | 39 | 0 | 1:23 | 05:45 |
| Gränna | 77 | 37 | 0:10 | 2:50 | 07:12 |
| Jönköping | 105 | 28 | 0 | 3:48 | 08:10 |
| Fagerhult | 134 | 29 | 0:10 | 4:58 | 09:20 |
| Hjo | 173 | 39 | 0 | 6:19 | 10:41 |
| Karlsborg | 204 | 31 | 0 | 7:24 | 11:46 |
| Boviken | 226 | 22 | 0:15 | 8:25 | 12:47 |
| Askersund | 256 | 30 | 0:15 | 9:42 | 14:04 |
| Godegård | 284 | 28 | 0 | 10:40 | 15:02 |
| Motala (finish) | 315 | 31 | | 11:45 | 16:07 |

Sum of legs 315 km. Sum of stops 0:50.

### 4.2 Stop plan (locked)
The 50 minutes sit at four towns: **Gränna 10 min, Fagerhult 10 min, Boviken 15 min, Askersund 15 min.** All other depots (Hästholmen, Jönköping, Hjo, Karlsborg, Godegård) are pass-through, 0 min. The big food depots Jönköping and Hjo are passed without stopping, the stops sit instead around the heavy southern climbing and in the second half.

Represent as a list of `{ control, km, minutes }`. Map each stop to the route by its km marker (nearest microsegment boundary by cumulative distance).

### 4.3 Time parameters
- Start time 04:22.
- Target total time 11:45.
- Target stop time 0:50.
- Target rolling time 10:55.
- Overall average including stops 26.81 km/h.
- Rolling average excluding stops 28.85 km/h.
- Rolling average after MC release 28.88 km/h.

### 4.4 Neutralized start (new requirement)
The first kilometre runs behind a lead motorcycle at controlled speed, about 3 minutes at about 20 km/h, then the speed is released. Model km 0 to 1 as a **fixed neutral segment with given speed, not from the power model**. This is why there are two rolling averages: 28.85 over the whole rolling distance and 28.88 after the MC release. The neutral segment is excluded from the effort solver and from NP accounting, but its 3 minutes count toward total time and ETA.

### 4.5 Validation reference
The base plan holds near-constant rolling speed about 28.6 to 29.0 km/h on every segment except the neutral kilometre. The tool's redistributed plan must still sum to total time 11:45 and rolling 10:55 with exactly the same stop plan, but with speed varying per segment. Use total time 11:45 and the fixed clock times at the stops as the control checks (section 15).

---

## 5. Parameters and defaults

All configurable. Defaults below.

| Parameter | Symbol | Default | Comment |
|---|---|---|---|
| System mass | `m` | 96 kg | 84 rider + 3 water + 9 bike, treated constant |
| FTP | `ftp` | 272 W | Verify against historical pass |
| Target NP (effort anchor) | `np_target` | 0.60 x ftp = 163 W | Scaled by the solver to hit target time |
| CdA on the front | `cda_pull` | 0.32 m^2 | Hoods, normal posture. Can drop to 0.31 (leader gets 2 to 3% draft in a long line) |
| CdA in draft | `cda_draft` | 0.21 m^2 | About 0.65 x solo (about 35% reduction) |
| Rolling resistance | `crr` | 0.0045 | Good road tyres, range 0.004 to 0.005 |
| Drivetrain efficiency | `eta` | 0.97 | Pedal power to wheel |
| Gravity | `g` | 9.81 m/s^2 | |
| Air density | `rho` | computed | From temp, pressure, height, humidity. Fallback 1.2 kg/m^3 |
| Riders (plan) | `n_riders` | 12 | |
| Pull length | `pull_seconds` | 45 s | Range 30 to 60 |
| Pull cap, hard | `pull_cap_hard` | = ftp (272 W) | Never exceeded in the plan |
| Pull cap, soft (climb) | `pull_cap_soft` | 0.92 x ftp = 250 W | Target in longer climbs |
| Climb threshold | `climb_threshold` | 3% | Above this, backrabatt and soft cap apply |
| Climb discount | `climb_discount` | on | Ride steep gradients a touch easier to save matches |
| Start time | `start_time` | 04:22 | Local race-day time |
| Race date | `race_date` | 2026-06-13 | Saturday. Inside Open-Meteo forecast horizon from about 2026-05-28 |
| Target total | `target_total` | 11:45 | Including stops |
| Stop total | `stop_total` | 50 min | Distributed per the locked stop plan (4.2) |
| Watch target type | `watch_target` | `pull` | `pull` or `avg`, switchable |
| Crosswind CdA factor | `k_yaw` | small, calibrated | Raises effective CdA with yaw angle |
| Target band width | `band` | +/- 5% or fixed watts | Workout step low/high around target, configurable |
| Neutral segment speed | `neutral_speed` | 20 km/h over km 0 to 1 | Fixed, outside power model (4.4) |

Sanity values (solo on the front, rho 1.2, cda_pull 0.32, crr 0.0045, eta 0.97, m 96): flat calm 28.8 km/h about 135 W (50% FTP), 5% climb about 17 km/h about 270 W (99%), flat with 20 km/h headwind 28.8 km/h about 325 W (120%). In draft on the flat the watts drop to about 90 W at 28.8 km/h, in the 5% climb only to about 260 W, so almost no draft gain when slow. That is why the bunch rides two-abreast uphill and does not push there.

---

## 6. Physics model

Steady-state power per microsegment. Signs handled so tailwind truly becomes negative headwind.

```text
# grade = dz/dx as a decimal, e.g. 0.05 for 5%
theta   = atan(grade)
F_grav  = m * g * sin(theta)
F_roll  = m * g * cos(theta) * crr
v_air   = v_ground + headwind            # headwind > 0 into the wind, < 0 tailwind
F_aero  = 0.5 * rho * CdA * v_air * abs(v_air)   # signed, handles tailwind > ground speed
P_wheel = (F_grav + F_roll + F_aero) * v_ground
P_pedal = P_wheel / eta
```

### 6.1 Solve speed given power
`P_pedal(v_ground)` is monotonic increasing in `v_ground` except in extreme tailwind. Solve `P_pedal(v) = P_target` with bisection (robust) or Newton-Raphson on about `v in [1, 25] m/s`. Handle edge cases: very steep climb, strong tailwind below ground speed.

### 6.2 Wind decomposition
Road bearing `beta` (direction of travel, degrees) from successive GPX points. Meteorological wind direction `phi_from` is where the wind comes from.

```text
delta     = radians(phi_from - beta)
headwind  = W * cos(delta)      # + headwind, - tailwind
crosswind = W * sin(delta)      # signed crosswind
```

Check: wind from the west (phi_from 270) and travel west (beta 270) gives cos(0) = 1, pure headwind. Travel north (beta 0) gives cos(270) = 0, pure crosswind.

### 6.3 Crosswind and yaw
```text
yaw     = atan2(crosswind, v_ground + headwind)
cda_eff = CdA * (1 + k_yaw * abs(yaw_deg) / 10)   # a 20 deg yaw should raise effective CdA about 5 to 10%
```
On `narrow`-flagged segments, additionally raise `cda_draft` toward `cda_pull` (no echelon possible) and add a small fixed time margin.

### 6.4 Air density
```text
# dry air: rho = p / (Rd * T), Rd = 287.058 J/(kg*K), T in kelvin, p in pascal
# humidity correction via virtual temperature or full moist-air formula
```
Compute `rho` per segment from forecast temperature and pressure and segment height. Fallback 1.2 kg/m^3.

### 6.5 Normalized power (NP)
```text
NP = (mean(rolling_30s(P)^4))^(1/4)
```

---

## 7. Chaingang and chain model

At a given speed `v` on a segment, two powers:

```text
P_pull(v)  = P_pedal(v; CdA = cda_pull_eff)     # on the front
P_draft(v) = P_pedal(v; CdA = cda_draft_eff)    # in the draft
```

Front time fraction with fixed pulls and n riders:
```text
f_front   = pull_seconds / (n_riders * pull_seconds) = 1 / n_riders   # about 0.083 at 12
P_mean(v) = f_front * P_pull(v) + (1 - f_front) * P_draft(v)
```

### 7.1 Rider NP in the chain
A rider's power profile is a square wave: `P_pull` for `pull_seconds`, then `P_draft` for the rest of the rotation (cycle time = `n_riders * pull_seconds`). Render this square wave per second over one cycle and apply the NP formula. NP is higher than `P_mean` because variability is penalized. This is the physiologically binding quantity, not the mean.

### 7.2 Constant effort
Even effort means **constant rider NP across all segments**, not constant mean power and not constant speed.

---

## 8. Anchor determination from the historical pass

1. Read the FIT pass power stream.
2. Compute the pass NP, duration, mean power and (if GPS present) terrain.
3. Classify:
   - **Long and representative** (duration in the same order as the planned effort, steady hard intensity): use the pass NP directly as the `np_target` candidate.
   - **Short test** (e.g. 20-minute test): estimate FTP as 0.95 x best 20-minute, compare with 272 W, set `np_target` = sustainability factor x FTP (default 0.60 for about 11 hours).
4. Log how the anchor was determined and which value is used so Tim can verify.

### 8.1 Group-size adjustment (8 in reference, 12 in plan)
The reference ride had 8 in the bunch, the plan has 12. The rider's NP from the reference ride is the physiological anchor and is group-size independent as a target. But the reference NP was produced under a 1/8 duty cycle. When translating the anchor into per-segment pull and draft watts the plan uses the 1/12 duty cycle, so the same rider NP yields slightly different pull and draft watts. Verify on decode that the reference NP reflects steady chaingang effort, not solo surges, before using it directly. `np_target` is only the starting value, the solver scales it to hit the target time.

---

## 9. Pacing solver

### 9.1 Control structure
Input: microsegments with distance, gradient, bearing, plus weather per time and place. The neutral kilometre (4.4) is inserted as a fixed 3-minute segment and skipped by the effort solver.

Inner solution (given effort level np_target):
```text
t = start_time
insert neutral segment km 0 to 1 at fixed neutral_speed, advance t by its time, no NP accounting
for each microsegment i after km 1 (in travel order):
    weather at (lat_i, lon_i, t)            # wind speed/dir, temp, pressure
    rho_i = air_density(...)
    headwind_i, crosswind_i = decompose(W, phi_from, beta_i)
    v_i = solve_speed_for_np(np_target, grade_i, headwind_i, crosswind_i, rho_i, narrow_i)
    if P_pull(v_i) > pull_cap_hard:
        v_i = speed_at_pull_power(pull_cap_hard, ...)        # clamp speed down
    if grade_i > climb_threshold and P_pull(v_i) > pull_cap_soft and climb_discount:
        v_i = speed_at_pull_power(pull_cap_soft, ...)
    dt_i = distance_i / v_i
    t += dt_i
    accumulate time, power, NP contribution
insert stop times per the locked stop plan (4.2)
total = t - start_time   # including stops
```

Outer solution: bisection on `np_target` until `total == target_total` (11:45).

Report the required `np_target`, and warn if it exceeds a sustainable level (e.g. implied NP fraction of FTP too high, or the pull cap binding over too much of the course). If the target time is not reachable sustainably: propose more time or shorter pulls and present the fastest sustainable time instead.

### 9.2 Time-dependent wind (mild circularity)
Speed depends on wind, wind on clock time, clock time on speed. Wind changes slowly (hourly), so one forward pass suffices. Optionally iterate once more to stabilize per-segment ETA.

### 9.3 Headwind handling
A sustained 20 km/h headwind at 28.8 km/h ground needs about 325 W on the front and about 235 W rider-mean (about 86% FTP), not holdable for eleven hours. The solver lowers speed in the headwind sector (pull cap binds) and banks the time back in tailwind and flat sectors. This falls out of the cap plus the outer bisection automatically, but must be logged clearly: which sectors were speed-limited and how much time was moved.

### 9.4 Stop plan
Locked at Gränna 10, Fagerhult 10, Boviken 15, Askersund 15 (section 4.2). Insert at each stop's km marker.

### 9.5 Three scenarios
Run the full solver three times with the wind field's ensemble mean, lower and upper percentile (section 10). Output optimistic, expected and pessimistic total time and the three anchor NPs they required.

---

## 10. Weather layer

Goal: robust wind per place and time, with uncertainty.

### 10.1 Sources
- **Open-Meteo (backbone).** Free, no key, many models. Forecast API for multi-model, Ensemble API for members plus mean and spread. Pull 10 m wind: `windspeed_10m`, `winddirection_10m`, plus `temperature_2m`, `surface_pressure`, hourly. Attribution CC BY 4.0.
- **SMHI Open Data (point forecast).** National Swedish model. Endpoint `api.smhi.se/api/category/pmp3g/version/2/geotype/point/lon/{lon}/lat/{lat}/data.json`. Verify version at implementation.
- **MET Norway / YR (Locationforecast 2.0).** Third independent source. Requires a descriptive `User-Agent` header.

### 10.2 Normalization and aggregation
1. For each (lat, lon, hour) pull wind speed, direction, temp, pressure from each source.
2. Convert to common units (m/s, degrees meteorological, kelvin, pascal).
3. Build an ensemble of all models and members.
4. Plan value = ensemble mean. Uncertainty band = spread (e.g. 10th and 90th percentile, or mean +/- one stdev). Average wind direction vectorially (mean of u and v components, not degrees directly).
5. Store per segment and time: plan wind plus optimistic and pessimistic wind, where "optimistic" is least headwind along the whole course, not least wind speed.

### 10.3 Time resolution
Aim each segment's wind lookup at the segment's ETA (from the solver) and the right geographic point. Wind rises through the day, so this matters.

### 10.4 Cache and offline
Fetch and cache the whole forecast locally on run (the day before). The tool must re-run offline against the cached forecast. Handle dead sources: run on whoever answers and flag in the output that the ensemble was reduced.

If `race_date` is outside Open-Meteo's roughly 16-day horizon, fall back to climatology or cached data and flag it, until the date is inside the window.

---

## 11. Segmentation

Two levels:
- **Microsegment:** point to point from the GPX (about 4820 points, dedup the 54 zero-length steps first). All physics happens here. Smooth the elevation first (moving average or simple low-pass), clip implausible gradients.
- **Display segment:** aggregate of microsegments, for the tempokort and FIT workout. Break at meaningful changes (start and end of climb, flat to headwind transition, depots, narrow sections), not rigidly every 10 km. Align display-segment boundaries with the locked control-point km markers (section 4.1) so the tempokort rows line up with the validation table.

Garmin limit: keep workout steps under about 50. Climb and wind based segmentation lands Vätternrundan typically at 25 to 45 steps.

---

## 12. Outputs

### 12.1 Raceplan (tempokort)
Markdown plus print-friendly HTML/PDF. Header with date, start time, target time and the three scenarios. One row per display segment:

| Column | Content |
|---|---|
| From-to (km) | Segment span |
| Town | Control town if any |
| ETA | Clock at segment end |
| Distance | km |
| Height | Net height metres |
| Gradient | Average gradient |
| Wind | Head/tail/cross plus m/s |
| Pull watts | Target band on the front |
| Avg watts | Rider mean |
| Note | Keyword |
| Stop | Min at depot plus departure time |

Note keywords like the original card: `JÄMN FART`, `TA DET LUGNT`, `KLÄTTRING`, `ÖKA`, `DEPÅ`, `BACKAR`, `SISTA UPPFÖR`. Derive from gradient, wind and position.

### 12.2 Garmin FIT workout (drives the watch)
Distance-based structured workout, one step per display segment. Verify field names and enums against the official Garmin FIT SDK and Profile.xlsx.

- `file_id`: `type = workout`, `manufacturer`, `product`, `time_created`, `serial_number`.
- `workout`: `wkt_name`, `sport = cycling`, `num_valid_steps`.
- `workout_step` per segment: `message_index` from 0, optional `wkt_step_name`, `duration_type = distance`, `duration_distance` in metres, `target_type = power`, `custom_target_value_low` and `custom_target_value_high` = watt targets.

**Power encoding, critical:** absolute watts are offset by 1000 in Garmin's workout encoding. 250 W is stored as 1250. Values 0 to 1000 are percent of FTP, values over 1000 are absolute watts minus 1000. Use absolute watts with the 1000 offset. Example: 240 to 260 W gives `custom_target_value_low = 1240`, `custom_target_value_high = 1260`. Verify against developer.garmin.com/fit/cookbook/encoding-workout-files/.

Step target per `watch_target`: `pull` (default) uses the segment's pull-watt band, `avg` uses the rider mean. Band width configurable, default +/- 5% or fixed watts.

### 12.3 Course (navigation and ClimbPro)
Export the course as GPX (simplest, Garmin converts to a Course on import) or as FIT Course (`file_id type = course`, `course`, `lap`, `record` with position, altitude, distance, plus `course_point` for towns and depots). ClimbPro on the Fenix 7X detects climbs from the course elevation.

### 12.4 Plan-JSON
Machine-readable file with the whole plan: segments, microsegment data, wind per segment, speeds, watts, NP contributions, ETA, stops and the three scenarios.

---

## 13. Operation on the Fenix 7X

Do not use the built-in Power Guide (it builds its own watt targets from FTP and the course, ignores wind, cannot take your segment targets). The mechanism that lets the model drive the watch is the structured workout (12.2).

On race day: load both Course and workout via NewFiles over USB the day before, start an outdoor cycling activity, follow the course (navigation plus ClimbPro) and run the workout (watt targets). If the device struggles to run navigation and workout together, the workout is what must work. Set up a data screen with target watts (workout target), 3-second power and lap power. Power-meter pedals paired (ANT+ or BLE), weight and FTP filled in the watch profile, firmware current.

---

## 14. Architecture and modules

TypeScript + Node, CLI default. Libraries: `@garmin/fitsdk` for FIT read and write, a robust GPX parser (e.g. `@tmcw/togeojson` or a small XML parser), native `fetch` for weather, markdown render plus an HTML template to PDF for the card.

Modules:
- `config`: load and validate parameters and defaults.
- `ingest`: GPX to route points (distance, smoothed elevation, bearing, dedup), FIT to power stream and pass metrics.
- `weather`: clients for Open-Meteo (forecast and ensemble), SMHI, MET Norway, plus normalization and ensemble aggregation, cache.
- `physics`: forces, `P_pedal(v)`, solve v from P, air density, NP, wind decomposition.
- `chaingang`: duty cycle, `P_pull`, `P_draft`, `P_mean`, rider-NP square wave.
- `planner`: time march, neutral start, outer bisection to target time, caps and backrabatt, headwind handling, stop insertion, three scenarios.
- `segmentation`: micro to display segments, step-count limit, note keywords.
- `output`: tempokort (md, html, pdf), FIT workout writer, course export, plan-JSON.

Each module has one clear purpose, a well-defined interface, and is unit-testable in isolation.

---

## 15. Validation and tests

- **Conservation:** sum of microsegment distances matches the GPX total (314.89 km) within tolerance.
- **Sanity vs section 5 table:** model reproduces the illustrative watts on flat, in a 5% climb and in 20 km/h headwind, within a few percent.
- **Cross-validation of the power model:** compare `P_pedal(v)` against a known calculator (gribble.org or raceyourtrack) for a few exact test cases.
- **Time control (locked references, section 4):** with calm wind, total time lands near 11:45 and rolling near 10:55 with the locked stop plan, and the clock at each control matches the table within tolerance. Reported anchor NP is sustainable. Per-segment rolling speed in the base (calm) case stays within about 28.6 to 29.0 km/h except the neutral kilometre.
- **Wind sign:** unit tests on wind decomposition (the four quadrants in 6.2).
- **FIT verification:** read the written workout back with Garmin's `FitCSVTool` and confirm the watt targets decode correctly (1000 offset right). Test-load on the watch if possible before the race.
- **Reality check:** compare with known Vätternrundan times and the original card logic (easy in climbs, push on the flat).

---

## 16. Error handling and robustness

- Missing power in the historical pass: fall back to FTP-based `np_target`, flag it.
- Noisy GPX elevation: smooth before gradient, clip implausible gradients, dedup zero-length steps.
- Missing or dead weather source: run on remaining sources, flag reduced ensemble.
- Target time not reachable sustainably: present the fastest sustainable time and where the caps bind, do not silently produce an impossible plan.
- Too many steps for Garmin: merge adjacent display segments with similar targets until under the limit.
- Device differences: keep FIT writing against the SDK and verify against Profile.xlsx, do not assume undocumented secondary targets.

---

## 17. Build plan (milestones)

1. **Physics core:** `physics` plus `chaingang`, with sanity tests against section 5 and an external calculator. No wind, no GPX yet.
2. **Ingest:** GPX to microsegments with smoothed elevation, dedup and bearing, FIT to anchor NP (including the 8-vs-12 duty-cycle note). Verify distance 314.89 km and a sensible smoothed gain.
3. **Solver without wind:** time march, neutral start, outer bisection to target time, caps and stop insertion. Verify total 11:45, rolling 10:55, and the control clock times against section 4.1.
4. **Weather layer:** Open-Meteo first (forecast plus ensemble), then SMHI and MET Norway, normalization and aggregation, cache. Wire wind into the solver, enable three scenarios.
5. **Segmentation and tempokort:** micro to display segments aligned to control km markers, note keywords, md and print.
6. **Garmin export:** FIT workout writer with correct 1000 offset, course export, FitCSVTool verification and test-load.
7. **Polish:** error handling, cache and offline re-run, plan-JSON, docs.

Each milestone is gated by its tests before the next starts. Detailed bite-sized tasks are produced in the implementation plan (writing-plans step).

---

## 18. Open items

1. Resolved: race_date 2026-06-13, start 04:22. From about 2026-05-28 the date is inside Open-Meteo's forecast horizon, before that use cached or climatology.
2. Confirm on decode that the historical FIT is a long representative chaingang ride (section 8), so the anchor comes from its NP rather than an FTP estimate.
3. Optional CdA fine-tune for wheels, helmet and clothing if Tim wants more than the 0.32 / 0.21 defaults.
4. Optional `group_target_np` if the weakest of the 12 cannot hold Tim's NP.
