# Server-side weather fetch + hourly wind editor

Date: 2026-06-04
Status: Approved (brainstorming locked)
Branch: `worktree-weather-server-fetch`

## Problem

The web app fetches wind **only from Open-Meteo, client-side, inside the solve
worker**. Consequences:

1. SMHI and MET Norway are never used in the browser (CORS + the met.no
   User-Agent requirement block them). Only the CLI gets the full 3-source
   ensemble.
2. No shared cache. Every solve re-fetches from the user's browser, risking
   API quota / rate-limit burn.
3. Weather is locked inside the solve step, so the user cannot **see** which
   wind values are used, cannot **edit** them, and cannot enter wind
   **manually**.
4. Sampling grabs only ~10 points along the route, while the 315 km
   Vatternrundan loop crosses **44 distinct 0.1 deg ensemble cells**. 34 of 44
   cells get no direct data; the ensemble stretches 10 samples across the gaps.

## Goals

- Fetch weather **server-side against all 3 sources** (Open-Meteo, SMHI, MET
  Norway), build the ensemble once, return it to the client.
- **Cache** the result so API quota is never burned per-user. Must be **free**
  (Vercel Hobby, no paid storage product, no API keys).
- A **UI showing the wind used hour by hour** (direction + strength) that the
  user can **edit**.
- Let the user **enter wind manually** (a quick constant, or fill the table).
- **More sampling points** along the route for better spatial fidelity.

## Non-goals (YAGNI)

- Per-zone / per-cell editable grids (the editable view is per clock hour, route
  wide).
- Persistent server storage (KV / Blob / Redis). CDN edge cache only.
- Weather maps / charts / wind-rose visualisations.
- Auth, accounts, server-side persistence of user edits.
- Commercial-tier API usage. Personal / non-commercial OSS only.

## Decisions (locked during brainstorming)

| Question | Decision |
|----------|----------|
| Cache backend | **Vercel CDN edge cache** via `Cache-Control: s-maxage` (free, no product, no key) |
| Hourly editor granularity | **Per clock hour, whole route** (matches "timme for timme") |
| Manual wind | **Both**: quick constant + editable hourly table |
| Sampling | **One point per distinct 0.1 deg cell the route crosses** (~44 for Vattern, route-agnostic) |
| Cost | All free: 3 keyless APIs + Vercel Hobby CDN/functions |

## Architecture

Decoupled 3-step flow (was: one-shot solve that fetches internally):

```
GPX ingest (worker/main) --> sample 0.1deg cells --> GET /api/weather (cached)
        --> EnsembleField --> WindHourTable (view + edit) --> apply overrides
        --> post field to worker --> solve (worker is now PURE, zero network)
```

### 1. Server endpoint: `/api/weather.ts` (Vercel Node function, repo root `/api`)

- `GET /api/weather?date=YYYY-MM-DD&pts=lat,lon|lat,lon|...`
  - `pts` are rounded to 0.1 deg (matches the ensemble grid -> no fidelity loss)
    and sorted (canonical -> maximal cache sharing).
- Fetches all 3 sources server-side using core's pure URL builders + parsers:
  - **Open-Meteo**: batched multi-coordinate request (comma-separated lat/lon
    lists) -> **1 request per endpoint** (forecast + ensemble = 2 total), not
    one-per-point.
  - **SMHI**: per-point, **parallel** with bounded concurrency (~10).
  - **MET Norway**: per-point, **parallel** bounded, with the required
    User-Agent header (`metNorwayHeaders()`).
  - Per-source isolation preserved: a dead source contributes nothing, never
    fails the request.
- `buildEnsemble(samples)` -> returns `EnsembleField` JSON
  (`{ cells, sources, reduced }`).
- **Cache header**: `Cache-Control: public, s-maxage=10800, stale-while-revalidate=86400`
  (3 h fresh, 1 day SWR). Vercel CDN keys by full URL = date + sorted rounded
  points. Every user on the same race/route/date hits the same cached entry.
  The function executes only on cache miss/revalidate (~handful/day). Free.
- Errors: if every source fails, return `{ cells: [], sources: [], reduced: true }`
  with HTTP 200 (client falls back to calm). Malformed query -> HTTP 400.

### 2. Core changes (`packages/core`, pure + testable)

- **Relocate** `gatherWindSamples` / `fetchSmhi` / `fetchMetNorway` from
  `packages/cli/src/weatherFetch.ts` into `packages/core/src/weather/` (fetch is
  universal; the only Node-specific concern was runtime CORS/UA, fine on a
  server). The CLI re-imports from core. The function imports from core. One
  shared path.
  - Add **bounded-concurrency parallelism** for the per-point sources, and
    **Open-Meteo multi-coordinate batching**.
- **New sampling helper** `sampleCellPoints(micro)`: walk microsegments in route
  order, emit the segment-start coord the first time each distinct 0.1 deg bin
  is seen. Returns <= one point per crossed cell (~44 for Vattern), route order
  preserved. Replaces the fixed ~10 `sampleWeatherPoints` in both web and CLI.
- **New pure helpers** (own module, e.g. `weather/hourly.ts`):
  - `summarizeHourly(field, hours)` -> `[{ hour, dir_from_deg, speed_ms }]`:
    vector-mean wind per clock hour across all route cells of that hour. Feeds
    the table. `hours` is the list of clock hours to show.
  - `applyHourlyOverrides(field, overrides)` -> new `EnsembleField`: for each
    overridden hour, replace `winddir_from_deg` + `windspeed_mean_ms` on every
    cell of that hour and collapse `windspeed_p10_ms = windspeed_p90_ms = speed`
    (edited hour has no spread). Unedited hours untouched.
  - `buildManualField(input, hours, centroid)` -> synthetic `EnsembleField`: one
    cell per hour at the route centroid carrying the constant or per-hour manual
    values. `makeWeatherFn`'s nearest-cell-in-time picks the right hour (single
    spatial point -> spatial term constant). `sources = ['manual']`,
    `reduced = true`.

### 3. Web data flow (`apps/web`)

- `weatherMode: 'calm' | 'fetched' | 'manual'` (was `'calm' | 'open-meteo'`).
- `PipelineInput` gains `field: EnsembleField | null`.
- **Worker (`solve.worker.ts` / `pipeline.ts`) no longer fetches.** `runPipeline`:
  - `field` present -> `solveThreeScenarios(micro, field, cfg)`.
  - `field` null -> calm (`calmThreeScenarios`).
  - Remove the `fetchOpenMeteo` branch from the worker. The worker becomes fully
    deterministic / network-free.
- **Main thread** orchestrates fetch + edit:
  1. Ingest GPX to get `micro` (lightweight ingest on main thread, or have the
     worker return `micro` first; implementation detail in the plan).
  2. `sampleCellPoints(micro)` -> points.
  3. `GET /api/weather` -> `EnsembleField`.
  4. `summarizeHourly` -> render `WindHourTable`.
  5. On edit -> `applyHourlyOverrides`; on manual -> `buildManualField`.
  6. Post `{ ...input, field }` to the worker -> solve.

### 4. UI components (`apps/web/src/components`)

- **`WeatherPanel`**: mode toggle (Lugnt / Hamta / Manuell), "Hamta vader"
  button, fetch status, source list + a "reducerad" badge when `< 3` sources
  answered.
- **`WindHourTable`**: one row per race clock hour
  (`start_time` .. `start_time + target_total_hm`), columns
  **Tid | Riktning** (degrees + a compass arrow glyph) **| Styrka (m/s)**.
  - Editable inputs per cell. Edited rows visibly marked. Per-row "aterstall" +
    a global reset to the fetched values.
- **Manual entry**: a constant dir + speed pair with "Applicera pa alla timmar",
  and/or direct editing of the table rows (same `WindHourTable`, starting from
  empty/zero in pure-manual mode).
- Hours window derived from `start_time` + `target_total_hm` (ceil). For fetched
  mode the summary pulls the nearest available cell per hour.

### 5. Privacy note (`App.tsx`)

Update: in **fetched** mode, only the route's ~44 rounded sample coordinates and
the date are sent to our serverless function, which queries SMHI, MET Norway and
Open-Meteo. Calm and manual modes send nothing. GPX/FIT files are still never
uploaded.

## Build / deploy integration risk + mitigation

`@stp/core` has **no build step**: `package.json main` points at raw
`./src/index.ts`, consumed via Vite (web) and tsx (CLI), using NodeNext `.js`
import specifiers that resolve to `.ts` files. A Vercel `/api` function bundled
by esbuild may fail to resolve `./foo.js` -> `foo.ts` across the workspace.

**Mitigation (first task = de-risk spike):**

1. Add `/api/weather.ts` importing `@stp/core`; run `vercel dev` locally and
   confirm the import + fetch + ensemble works.
2. **Fallback if esbuild fails the `.js`->`.ts` resolution**: add a minimal
   esbuild/tsc prebuild of `@stp/core` to `dist` consumed **only** by the
   function (web + CLI stay on source). Wire it into the Vercel build command.

`vercel.json` keeps `outputDirectory: apps/web/dist`; the `/api` directory is
auto-detected by Vercel and deployed as a function alongside the static SPA.

## Testing

- **core**: unit tests for relocated fetchers (mock `fetch`, assert per-source
  isolation + parallelism + Open-Meteo batching), `sampleCellPoints` (dedupe by
  0.1 deg, route order), `summarizeHourly`, `applyHourlyOverrides`,
  `buildManualField`. All pure / deterministic with sample fixtures.
- **api**: handler test - mock `fetch`, call the handler with a fake req,
  assert it merges sources, builds the ensemble, sets the `Cache-Control`
  header, and handles all-sources-fail (empty field, 200) + bad query (400).
- **web**: `WindHourTable` component test (edit a row -> correct override map),
  `WeatherPanel` mode switching, pipeline test (injected `field` bypasses fetch;
  null `field` -> calm).

## Acceptance criteria

- [ ] `GET /api/weather` returns a 3-source `EnsembleField` and sets the
      `s-maxage` cache header; repeat calls for the same date+points hit the CDN
      cache (verified via `age`/`x-vercel-cache` header in a preview deploy).
- [ ] Web fetched mode shows an hourly wind table (dir + strength) from the
      server ensemble; the worker performs zero network I/O.
- [ ] Editing an hour changes the wind the solver uses (split table / tempokort
      reflect it).
- [ ] Manual mode: a constant wind applies to all hours; the table is editable.
- [ ] Sampling covers every 0.1 deg cell the route crosses (44 for the
      Vattern example).
- [ ] CLI still produces the same plan (relocated fetchers, no regression).
- [ ] All free: no API keys, no env vars, no paid Vercel product.
- [ ] `npm test` green; `npm run typecheck` clean.
```
