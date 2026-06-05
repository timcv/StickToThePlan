# The model

This document explains, end to end, how StickToThePlan turns a route, a stop schedule, and a target finish time into per-depot split times and watch files. It is written for a skeptical reader who wants to judge the calculation rather than trust it. Every concrete number cited here comes from the repository's own test suite or its build report, and the source is named inline. Nothing is invented. A fuller reference, with every formula, sign convention, default, and file reference laid out for an external reviewer, is in [docs/calculation-model.md](docs/calculation-model.md).

The whole model is one idea: hold the rider's effort constant (a fixed normalized power) and let ground speed vary with gradient and wind, then adjust that single effort number until the predicted total time equals the target. Speed, not effort, absorbs the terrain.

## 1. The NP anchor

The model is anchored on one physiological number, the rider's target normalized power, `np_target` (watts). It is the effort the rider intends to hold for the whole event, averaged the way training software averages power (the fourth-root rolling mean, see section 2).

`np_target` is determined in `packages/core/src/ingest/fit.ts`:

- If you supply a representative FIT ride longer than 7200 s (two hours), the ride is classified `long_representative` and its rolling normalized power, computed by `normalizedPower` in `packages/core/src/physics.ts`, is used directly as the anchor (`analyzePass`).
- Otherwise (a short test ride, or no FIT at all) the anchor falls back to `0.60 x FTP`, rounded (`determineAnchorFromPower`).

The key modelling decision is that the rider's NP is treated as a group-size-independent physiological anchor. A rider who held a given NP in an 8-rider bunch is expected to be able to hold the same NP in a 12-rider bunch. The group size changes how that NP is split between hard pulls and easy drafting (section 2), not the rider's sustainable NP itself. The FIT note in the code states this explicitly: the reference ride was an 8-rider bunch (duty cycle 1/8), the plan uses 12 (1/12), and the rider NP carries across.

A subtlety worth flagging: in the calm-wind solve the anchor that finally hits the target is not necessarily the FIT anchor. The FIT gives a candidate anchor, but the outer bisection (section 3) is free to pick whatever NP hits the target time. In the build report's real run the FIT pass gave 164.2 W from 13547 power samples (3.76 h, classified `long_representative`), while the calm-wind plan only needed 145.9 W to hit 11:45, leaving headroom for wind. Both numbers are reported in `docs/build-report.md`.

## 2. Per-segment speed

For each microsegment the model computes the ground speed the rider can hold at the current effort, given the segment's gradient and the wind.

### Physics (`packages/core/src/physics.ts`, `pedalPower`)

Steady-state pedal power for a given ground speed `v`, grade, and headwind is the sum of three resistances times speed, divided by drivetrain efficiency:

- Gravity: `F_grav = m * g * sin(atan(grade))`.
- Rolling resistance: `F_roll = m * g * cos(atan(grade)) * crr`.
- Aerodynamic drag: `F_aero = 0.5 * rho * CdA * v_air * |v_air|`, where `v_air = v_ground + headwind`. The signed form handles a tailwind stronger than ground speed.
- `P_wheel = (F_grav + F_roll + F_aero) * v_ground`, and `P_pedal = P_wheel / eta`.

Air density `rho` is computed from temperature and pressure (`airDensity`): dry air `rho = p / (Rd * T)` with `Rd = 287.058 J/(kg K)`, with an optional moist-air virtual-temperature correction. CdA is yaw-adjusted (`yawCdaFactor`): the yaw angle is `atan2(crosswind, v_air)` and the effective CdA rises by `k_yaw * |yaw_deg| / 10`. Wind is split into headwind and crosswind components by `decomposeWind` using the angle between the meteorological wind-from direction and the road bearing.

### Chaingang (`packages/core/src/chaingang.ts`)

A rider in a rotating paceline does not hold one steady power. They spend a fraction `f_front = 1/n_riders` of the time on the front, paying the full pull aero cost (`cda_pull`), and the rest of the time drafting at a much lower aero cost (`cda_draft`). With `n_riders = 1` (solo) the rotation collapses and the rider is always on the front. The instantaneous power over one rotation cycle is therefore a square wave: high during the pull, low during the draft, with duty cycle `1/n_riders`.

The rider's normalized power is the fourth-root rolling mean of that square wave: `NP = (mean(rolling_30s(P)^4))^(1/4)`. Because of the fourth power, NP sits above the time-average mean power: the variability of the pull/draft step is penalized. The reference implementation (`riderNpSquareWaveReference`) literally builds the per-second cycle, applies a circular 30-second rolling mean (circular because the cycle repeats), and takes the fourth-root mean.

Doing that on every speed evaluation inside two nested solvers is expensive, so the production path computes the same quantity in closed form. Each 30-second rolling-mean sample is a convex combination of the pull and draft powers, `rolling_i = a_i * P_pull + (1 - a_i) * P_draft`, where the occupancy `a_i` is the fraction of the trailing 30-second window that lies in the pull phase. Expanding `rolling_i^4` by the binomial theorem and averaging over the cycle gives five moments `c0..c4` that depend only on `(n_riders, pull_seconds)`. These moments are precomputed and cached (`npMomentsFor`), after which NP is an O(1) quartic in `(P_pull, P_draft)` (`npFromMoments`). The closed form is asserted equivalent to the explicit square-wave reference to within `1e-6` across a grid of powers (see `packages/core/tests`, referenced in the chaingang source comments).

Given `np_target`, the ground speed for a segment is found by an inner bisection (`solveSpeedForRiderNp`) that searches `v` in `[0.5, 25] m/s` for the speed whose rider NP equals the target, to a tolerance of 0.1 W.

## 3. From speed to time

Once each microsegment has a ground speed, its time is `distance / speed`, and the route is time-marched segment by segment (`runInnerSolve` in `packages/core/src/planner.ts`). The march accumulates elapsed seconds from the start.

- **Neutral start block.** The first kilometre (segments flagged `neutral`) is ridden at a fixed neutral speed (`neutral_speed_kmh`, default 20 km/h) and is excluded from the NP accounting entirely. The planner test asserts neutral segments carry `rider_np_w === 0`.
- **Power caps.** On the front the pull power can spike on climbs and in headwind. Three caps apply. The hard cap is `pull_cap_hard = round(pull_cap_mult x FTP)`, `pull_cap_mult` default 1.3, so the front may run a short 45-second pull up to about 1.3x FTP; if the uncapped pull would exceed it the speed is reduced so the pull sits at the cap. (Earlier the hard cap was FTP itself, which throttled most headwind segments and bounded sustainability twice. Sustainability is bounded by the rider's NP, not by holding every individual pull under FTP, so the cap was raised and the two concerns separated.) The soft cap is `pull_cap_soft = round(0.92 x FTP)` and applies only on climbs steeper than `climb_threshold` (default 3 percent) when `climb_discount` is on. The spin-out cap is a planning ceiling: no effort segment is planned faster than `max_plan_speed_kmh` (default 50 km/h); above it the rider eases (the steady pull/draft power is clamped at zero on descents) and the extra tailwind or descent is buffer, not banked time. Caps adjust the segment speed (and time), which the outer solver then rebalances elsewhere on the route.
- **Stops.** Each stop sits at the first segment boundary whose cumulative distance reaches the stop's km marker. The stop adds `minutes * 60` seconds to that segment's ETA and to every later segment's ETA. The planner test asserts a stop's `depart_s - arrive_s` equals exactly `minutes * 60`, and that `rolling_time_s === total_time_s - stop_time_s`.
- **Outer bisection.** The total time is monotone decreasing in `np_target` (more power, more speed, less time). `solveForTargetTime` first checks the fastest sustainable plan at `np = FTP`; if even that is slower than the target, the target is unreachable and the fastest plan is returned with `reachable = false`. Otherwise it bisects `np_target` in `[60, FTP]`, up to 45 iterations, to a tolerance of 20 s on the total, and returns the plan that hits the target finish time.
- **Sustainability check.** After the march the ride-level rider NP is the time-weighted fourth-power mean of the per-segment rider NPs, and the intensity factor is `IF = ride_NP / FTP` (both carried on `PlanResult`, surfaced in the UI and `plan.json`). When `IF` exceeds `sustain_if_warn` (default 0.75) the plan adds a note flagging the time as a hard day's effort. This lets a plan be reachable yet honestly labelled hard: with a 10 m/s wind the 315 km target hits 11:45 at rider NP about 219 W (IF 0.80) rather than being reported unreachable, while the spin-out cap keeps the tailwind splits near 46 km/h instead of 52 to 54.

The three time scenarios (optimistic, expected, pessimistic) re-run this whole solve against the same weather ensemble at different wind percentiles (`solveThreeScenarios`). Each scenario hits the same target total time, so they differ in the NP they required: less headwind needs less NP. The percentile-to-scenario mapping depends on the route's net exposure to the mean wind direction: on a net-headwind route or a balanced loop more wind is slower, so pessimistic uses the high percentile (p90) and optimistic the low (p10); on a net-downwind route more wind is faster, so the mapping inverts. `routeIsNetDownwind` decides this by projecting each segment's travel onto the mean wind direction and summing the signed headwind exposure, with a 5-percent-of-distance deadband that keeps a balanced loop (such as Vätternrundan) on the convex default. Manual constant wind has p10 = p90, so the mapping is moot.

## 4. Depot ETAs and splits

Arrival and departure clocks come straight out of the time march. For each segment, `eta_s` is the elapsed seconds from the start at the segment end, already including any earlier stops. A clock time is `start_time + eta_s`.

The per-depot split table is built by `buildSplitTable` in `packages/core/src/output/splits.ts`. For each control it computes arrival as the rolling segment time at the nearest segment boundary plus the duration of stops at controls strictly before this one (`s.km < km`). The strict inequality is what prevents double counting: a control's own stop is added on departure, not on arrival, so a stop is never counted both before and at the same control. Each split row carries the leg distance, the leg rolling time, the arrival and departure clocks, the stop minutes, and the cumulative time. The km-0 start is treated as the implicit origin (cum 0, elapsed 0) so the opening leg includes the first segment.

## 4a. Effektiv vind, exponering och osakekerhetsspann

Prognosvind ges pa 10 m hojd (WMO-standard), men cyklisten sitter pa ungefar 1.2 m. Med logaritmisk vindprofil skalar modellen ned vindhastigheten till rytternivan med faktorn `k = ln(1.2/z0) / ln(10/z0)`, dar `z0` ar terrangens aerodynamiska kastrighet. Over blandad mark (z0 = 0.05, standard) reduceras en 6 m/s-prognos till ungefar 3.6 m/s pa rytternivan. Pa Vatternrundan 315 km ger det en skillnad pa knappt 19 W i krav-NP for att na samma maltid, allt annat lika.

Kastrighet (z0) kan sattes globalt via `exposure_terrain` (open 0.03, mixed 0.05, sheltered 0.30) eller per segment via inbakad exponeringsdata fran OpenStreetMap. Sju klasser anvands: Vattennara, Bro, Oppet, Halvoppet, Skog, Bebyggt och Skyddat, med z0-varden fran litteraturen. For Vatternrundans rutt ar exponeringsdata inbakad offline (se `scripts/bake-exposure.mjs`) och lagrad i `data/vatternrundan-exposure.json`. Denna data gar att ta bort och beraknas om nar terrangkartor uppdateras. Observera att z0-vardena ar litteratur-startpunkter, inte kalibrerade mot verkliga akter; exponeringsklassificeringen talar om var pa rutten vinden dampar mer eller mindre, men inte exakt hur mycket.

Osakekerhetsspanet i tempokort-rubriken ("rimligt spann H:MM-H:MM") visar skillnaden i total tid nar forarvens NP halls fast pa forvantat scenario och rutten beraknas om under optimistisk respektive pessimistisk vindprofil. Spannet aterspeglar vindosakekerhet, inte rytterprestation, och kollapsar till "spann saknas" nar spridningen understiger en minut (t.ex. vid manuell vind eller lugnt).

## 5. Validation numbers

All figures below come from the repository's own test suite or its build report. The source file is named for each.

### Distance conservation

The sum of microsegment distances matches the GPX total for the real course: 314.892 km computed versus 314.89 km from the GPX, conserved. Source: `docs/build-report.md`, validation table ("Microsegment sum vs GPX total").

### Calm-wind solve hits 11:45

With calm wind on the real 315 km course (start 04:22, FTP 272 W, 12 riders, the four stops totalling 50 minutes), the outer bisection lands the total at 42300 s = 11:45:00, with rolling time 39300 s = 10:55:00 and stop time 3000 s = 50 min. The required rider NP is 145.9 W, comfortably below FTP. Sources: `packages/core/tests/planner.test.ts` (the "real GPX" block asserts total within 90 s of 42300 s, stop time exactly 3000 s, rolling within 150 s of 39300 s, `np_target_used` between 120 and 272 W, mean rolling speed between 27.5 and 30.0 km/h, and the finish clock within 3 min of 11:45); the exact 145.9 W and the 28.89 km/h mean rolling speed are from `docs/build-report.md` (which records 28.89 km/h against a calc-sheet target of 28.85 km/h).

### Headwind raises the required NP (synthetic scenario test)

On a synthetic 20 km flat route into three wind percentiles (a pure headwind), all three scenarios hit the 1:00 target within 90 s and the required NP rises strictly with headwind: optimistic about 81.5 W (p10, 3 m/s) < expected about 129.6 W (mean, 6 m/s) < pessimistic about 192.5 W (p90, 9 m/s). The test asserts the strict ordering and that pessimistic exceeds optimistic by more than 20 W. Source: `packages/core/tests/scenarios.test.ts` (synthetic block; the watt figures are the values documented in the test's own header comment).

### Air density sanity

`airDensity(15 C, 101325 Pa) = 1.2255`, within 0.1 percent of the ISA standard 1.225 kg/m^3. The calm-weather provider returns exactly 0 wind, 15 C, and 101325 Pa, which the planner test confirms. Sources: `docs/build-report.md` (air density row) and `packages/core/tests/planner.test.ts` (`calmWeather` test).

### Control split clocks (calm wind, real course)

The planner test carries a soft control-clock reference table (report-only, except the finish, which is a hard gate). It is the constant-speed reference from the design doc, not the model's target. Because the model holds constant rider NP, it rides the southern climbs slower and the flats faster than a constant-speed table, so mid-course controls drift while the total and finish stay pinned. The build report records the largest drift as +11.6 min at Fagerhult (km 134), right after the climbing sector, with the finish at 16:07 exact. The reference table, summarized:

| Control km      | Reference clock |
| --------------- | --------------- |
| 40              | 05:45           |
| 77 (Gränna)     | 07:12           |
| 105             | 08:10           |
| 134 (Fagerhult) | 09:20           |
| 173             | 10:41           |
| 204             | 11:46           |
| 226 (Boviken)   | 12:47           |
| 256 (Askersund) | 14:04           |
| 284             | 15:02           |
| 315 (finish)    | 16:07           |

The finish clock 16:07 (42300 s after the 04:22 start) is the only hard gate in this table, asserted within +/- 3 min. Source: `packages/core/tests/planner.test.ts` (control clock table and finish gate); drift commentary from `docs/build-report.md`.

### Test suite scope

The full Vätternrundan build reported 252 passed and 1 skipped, with `tsc --noEmit` clean (`docs/build-report.md`). After the wind-realism work the suite is 309 passed and 10 skipped, with `tsc` and `eslint` clean; the skipped tests are the slow real-course solves, gated behind `SLOW_TESTS=1` or a committed-GPX guard because one full solve over roughly 4760 microsegments is compute-heavy. The added coverage exercises the spin-out ceiling, supra-FTP pulls, the IF sustainability warning, and the net-downwind scenario inversion (`packages/core/tests/headwind-caps.test.ts`, `packages/core/tests/scenarios.test.ts`).

## 6. References and default assumptions

These are the default parameter values from `packages/core/src/config.ts` (overridable via config). They are the assumptions the numbers above rest on.

| Parameter             | Default    | Meaning                                                           |
| --------------------- | ---------- | ----------------------------------------------------------------- |
| `m`                   | 96 kg      | total system mass (rider plus bike plus kit)                      |
| `cda_pull`            | 0.32 m^2   | drag area on the front (pulling)                                  |
| `cda_draft`           | 0.21 m^2   | drag area while drafting                                          |
| `crr`                 | 0.0045     | coefficient of rolling resistance                                 |
| `eta`                 | 0.97       | drivetrain efficiency                                             |
| `g`                   | 9.81 m/s^2 | gravity                                                           |
| `rho_fallback`        | 1.2 kg/m^3 | air density fallback when no weather is available                 |
| `pull_seconds`        | 45 s       | length of one front pull                                          |
| `pull_cap_mult`       | 1.3        | hard pull cap as a multiple of FTP (a short supra-threshold pull) |
| `max_plan_speed_kmh`  | 50         | planning / spin-out speed ceiling for tailwind and descents       |
| `sustain_if_warn`     | 0.75       | intensity factor above which a sustainability note fires          |
| `climb_threshold`     | 0.03       | grade above which the soft climb cap applies                      |
| `climb_discount`      | true       | whether the soft climb cap is active                              |
| `k_yaw`               | 0.04       | yaw drag coefficient (about 8 percent CdA rise at 20 deg yaw)     |
| `neutral_speed_kmh`   | 20         | fixed speed through the neutral start                             |
| `neutral_distance_km` | 1          | length of the neutral start block                                 |
| `max_grade`           | 0.18       | gradient clip during ingest                                       |
| `ele_smooth_window`   | 5          | elevation smoothing window                                        |

Two derived defaults are not in this table because they come from FTP: `pull_cap_hard = round(pull_cap_mult x FTP)` (1.3 x FTP by default, so 354 W at FTP 272) and `pull_cap_soft = round(0.92 x FTP)`. The example race uses `FTP = 272 W`, `n_riders = 12`, start 04:22, target 11:45, and the four stops in `config.json`. Where a number above is not stated as a config default or a named test/report figure, it should be treated as run-specific (for example, the live-forecast scenario watts vary every time the forecast is fetched).
