# Weather model fidelity fixes (design)

Date: 2026-06-12
Status: approved

Three deferred roadmap items in `docs/roadmap.md` (wind-model section), all logic
correctness gaps rather than crashes. Built together because fix 2 reuses fix 1's
absolute-time cell matching.

## Decisions (locked)

- **Default atmosphere:** ISA, 15 C / 101325 Pa, `rho ~= 1.2250`.
- **Fix 1 scope:** solver match + multi-day fetch; make `summarizeHourly`
  window-aware to avoid a web display regression. No broader web rework.
- **Fix 2 method:** drop the global cell average; per-segment local wind with a
  rough distance-proportional time march (no extra full solve).

## Shared primitives

### `nearestCell(cells, lat, lon, queryEpochMs)` (weather/ensemble.ts)

Pick the best cell by the existing space+time score, but time-distance is
**absolute milliseconds**, not hour-of-day:

```
score = haversine(query, cell)/SPACE_REF_M + abs(Date.parse(cell.time_iso) - queryEpochMs)/3.6e6 / TIME_REF_H
```

`SPACE_REF_M = 100_000`, `TIME_REF_H = 12` unchanged. Returns `undefined` for an
empty field. Consumed by both `makeWeatherFn` and `routeIsNetDownwind`.

### `raceStartEpochMs(date, hhmm, timeZone)` (util/time.ts)

Absolute UTC epoch (ms) of the local wall-clock race start. Factor the absolute
`utcMs` already computed inside `utcStartClockSeconds` into this helper; the
existing function then derives seconds-of-day from it (behavior unchanged).

## Fix 1: date-aware matching + multi-day fetch

- **Fetch (weather/openMeteo.ts):** `buildForecastUrl`, `buildEnsembleUrl`,
  `buildForecastUrlMulti` set `end_date = nextDay(date)` (one request, 48 hourly
  rows). Add `nextDay(dateIso)` helper (UTC date + 1). `parseOpenMeteo` already
  handles arbitrary row counts; `buildEnsemble` already keys on full date+hour, so
  it yields ~2x cells. `gatherWindSamples` signature unchanged -> `api/handler.ts`
  and CLI untouched.
- **Match (weather/ensemble.ts):** `makeWeatherFn(field, scenario, startEpochMs,
favorableWind)` replaces the `startClockS` param. `queryEpochMs = startEpochMs +
timeS*1000`; pick via `nearestCell`. Memo key -> absolute hour index
  `floor(queryEpochMs/3.6e6)`. Empty-field fallback returns calm at the standard
  atmosphere (see fix 3). A ride past UTC midnight now matches the correct day; the
  wrong-day duplicate loses on absolute time (24 h diff adds 2.0 to score).
- **Web no-regression (weather/hourly.ts + App.tsx):** `summarizeHourly(field,
hours, startEpochMs?)` gains an optional reference epoch. When present, each
  requested hour-of-day resolves to its **ride-window occurrence** (first cell
  at-or-after start whose UTC hour matches) so day-1/day-2 cells stop merging. When
  omitted, current behavior. `App.tsx` passes `raceStartEpochMs(...)`.
  `WindHourTable` and the override path are unchanged: overrides key by hour-of-day
  and apply to both days, but the solver's absolute match reads the correct-day
  cell, so edits still land right.

## Fix 2: `routeIsNetDownwind` weights by ridden hours

`routeIsNetDownwind(microsegments, field, startEpochMs, totalTimeS)` with
`totalTimeS = hmToSeconds(cfg.target_total_hm)`. Per effort microsegment:

```
approxElapsedS = (m.cum_distance_m / totalDistance) * totalTimeS
cell = nearestCell(field.cells, m.lat, m.lon, startEpochMs + approxElapsedS*1000)
exposure += cos(rad(cell.winddir_from_deg - m.bearing_deg)) * m.distance_m
total    += m.distance_m
```

Same `exposure < -0.05 * total` deadband. Uses each segment's **local** wind
direction instead of one global vector mean, so a wind that veers during the day no
longer flips the optimistic/pessimistic percentile mapping. Distance-proportional
time is hour-resolution, which is all the hourly cell bins need.

## Fix 3: unify default atmosphere

Add to physics.ts:

```
export const STANDARD_ATMOSPHERE = { temp_c: 15, pressure_pa: 101_325 } as const;
export const STANDARD_RHO = airDensity(STANDARD_ATMOSPHERE.temp_c, STANDARD_ATMOSPHERE.pressure_pa); // ~1.2250
```

Repoint all four fallbacks:

- `calmWeather` (planner.ts) -> reference `STANDARD_ATMOSPHERE` (already 15/101325).
- empty-field `WeatherFn` (ensemble.ts): temp 10 -> 15 via the constant.
- `buildManualField` (hourly.ts): temp 10 -> 15 via the constant.
- `config.ts` default `rho_fallback: 1.2 -> STANDARD_RHO`.

The magic `1.2` and `10` disappear; one ISA atmosphere everywhere.

## Testing

New unit tests:

- `nearestCell`: cross-midnight pick selects the correct-day cell over a same-hour
  wrong-day duplicate.
- `raceStartEpochMs`: known local start -> expected UTC epoch (incl. tz offset).
- `routeIsNetDownwind`: a wind that veers during the ride flips the verdict vs a
  flat-averaged field.
- `STANDARD_RHO` value pinned.

Update existing tests that hardcode 10 C / `1.2` or call `makeWeatherFn` /
`routeIsNetDownwind` with the old signatures.

Gate: `npm test` and `npm run typecheck` green. All work in the worktree.

## Out of scope (stays in roadmap)

- Coherent ensemble members, GPX fixed-distance resampling, manual-wind uncertainty
  band, full multi-day web hourly rework, speed-weighting the downwind exposure.
