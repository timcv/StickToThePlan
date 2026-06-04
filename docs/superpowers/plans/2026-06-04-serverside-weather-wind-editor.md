# Server-side weather fetch + hourly wind editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch wind from all 3 sources server-side (cached, free), let the user view/edit the hour-by-hour wind or enter it manually, and sample one point per 0.1° cell the route crosses.

**Architecture:** A Vercel `/api/weather` Node function fetches Open-Meteo + SMHI + MET Norway, builds the ensemble, and returns it with a CDN `s-maxage` cache header. The browser fetches the field on the main thread, renders an editable hourly table, applies overrides (or builds a manual field), then posts the final `EnsembleField` to a now-network-free solve worker.

**Tech Stack:** TypeScript (NodeNext ESM), React 19 + Vite, Vitest, Vercel Hobby (static SPA + `/api` function, CDN edge cache).

Spec: `docs/superpowers/specs/2026-06-04-serverside-weather-wind-editor-design.md`

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/core/src/weather/fetchAll.ts` (new) | Server/universal fetch of all 3 sources: `fetchSmhi`, `fetchMetNorway`, `gatherWindSamples`, bounded-concurrency `mapLimit`, batched Open-Meteo forecast | 1 |
| `packages/core/src/weather/openMeteo.ts` (mod) | Add `buildForecastUrlMulti` + `parseOpenMeteoBatch` + `fetchOpenMeteoForecastBatched` | 1 |
| `packages/cli/src/weatherFetch.ts` (mod) | Becomes a thin re-export from core (back-compat) | 1 |
| `packages/core/src/weather/sample.ts` (new) | `sampleCellPoints(micro)` — one point per 0.1° cell | 2 |
| `packages/core/src/weather/hourly.ts` (new) | `summarizeHourly`, `applyHourlyOverrides`, `buildManualField`, `HourlyWind` | 3 |
| `packages/core/src/index.ts` (mod) | Re-export the new weather surface | 1,2,3 |
| `api/weather.ts` (new) | Vercel adapter | 4 |
| `api/handler.ts` (new) | `parseWeatherQuery` + `handleWeather` (testable) | 4 |
| `api/tsconfig.json` (new) | Typecheck the function dir | 4 |
| `api/tests/handler.test.ts` (new) | Handler unit tests | 4 |
| `vitest.config.ts` (mod) | Include `api/tests` in the node project | 4 |
| `package.json` (mod) | `@vercel/node` devDep + typecheck includes api | 4 |
| `apps/web/src/lib/pipeline.ts` (mod) | Accept injected `field`; drop the fetch branch | 5 |
| `apps/web/src/lib/hours.ts` (new) | `raceHours(startTime, targetHm)`, `centroidOf(points)` | 5 |
| `apps/web/src/lib/weatherClient.ts` (new) | `fetchEnsemble(date, points)` → calls `/api/weather` | 5 |
| `apps/web/src/components/WindHourTable.tsx` (new) | Editable hour×(dir,speed) table | 6 |
| `apps/web/src/components/WeatherPanel.tsx` (new) | Mode toggle + fetch + manual + table host | 6 |
| `apps/web/src/App.tsx` (mod) | Host WeatherPanel, build final field, privacy note | 7 |
| `apps/web/src/components/UploadForm.tsx` (mod) | Remove the old weather-mode select | 7 |

---

### Task 1: Relocate + parallelize multi-source fetch into core

**Goal:** Move `gatherWindSamples`/`fetchSmhi`/`fetchMetNorway` into `@stp/core`, add bounded-concurrency parallelism and a batched Open-Meteo forecast fetch; the CLI re-exports from core.

**Files:**
- Create: `packages/core/src/weather/fetchAll.ts`
- Modify: `packages/core/src/weather/openMeteo.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/cli/src/weatherFetch.ts`
- Test: `packages/core/tests/fetchAll.test.ts`

**Acceptance Criteria:**
- [ ] `gatherWindSamples`, `fetchSmhi`, `fetchMetNorway`, `mapLimit` exported from `@stp/core`.
- [ ] Open-Meteo forecast fetched in ONE batched multi-coordinate request; `parseOpenMeteoBatch` maps array responses back to points.
- [ ] A dead source contributes nothing (per-source isolation preserved).
- [ ] Per-point sources run with bounded concurrency (≤ 10 in flight).
- [ ] `packages/cli/src/weatherFetch.ts` re-exports from core; CLI build/tests unaffected.

**Verify:** `npx vitest run packages/core/tests/fetchAll.test.ts` → PASS; `npm test` → all green.

**Steps:**

- [ ] **Step 1: Write the failing test** `packages/core/tests/fetchAll.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { gatherWindSamples, mapLimit } from '../src/weather/fetchAll.js';
import { parseOpenMeteoBatch, buildForecastUrlMulti } from '../src/weather/openMeteo.js';
import type { GeoPoint } from '../src/weather/openMeteo.js';

const points: GeoPoint[] = [
  { lat: 58.5, lon: 14.6 },
  { lat: 58.6, lon: 14.7 },
];

afterEach(() => vi.restoreAllMocks());

describe('buildForecastUrlMulti', () => {
  it('packs all coordinates into comma lists', () => {
    const url = buildForecastUrlMulti(points, '2026-06-13');
    expect(url).toContain('latitude=58.5,58.6');
    expect(url).toContain('longitude=14.6,14.7');
  });
});

describe('parseOpenMeteoBatch', () => {
  it('maps an array response element to each point', () => {
    const json = [
      { hourly: { time: ['2026-06-13T04:00'], windspeed_10m: [3], winddirection_10m: [270], temperature_2m: [9], surface_pressure: [1013] } },
      { hourly: { time: ['2026-06-13T04:00'], windspeed_10m: [5], winddirection_10m: [180], temperature_2m: [8], surface_pressure: [1012] } },
    ];
    const samples = parseOpenMeteoBatch(json, points, 'open-meteo-forecast');
    expect(samples).toHaveLength(2);
    expect(samples[0].lat).toBe(58.5);
    expect(samples[1].winddir_from_deg).toBe(180);
  });

  it('accepts a single-object response for one point', () => {
    const json = { hourly: { time: ['2026-06-13T04:00'], windspeed_10m: [3], winddirection_10m: [270], temperature_2m: [9], surface_pressure: [1013] } };
    const samples = parseOpenMeteoBatch(json, [points[0]], 'open-meteo-forecast');
    expect(samples).toHaveLength(1);
  });
});

describe('mapLimit', () => {
  it('never runs more than `limit` tasks at once', async () => {
    let active = 0, peak = 0;
    const work = Array.from({ length: 12 }, (_, i) => i);
    await mapLimit(work, 3, async (n) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe('gatherWindSamples', () => {
  it('isolates a dead source (all fetches reject -> empty array, no throw)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const out = await gatherWindSamples(points, '2026-06-13');
    expect(out).toEqual([]);
  });

  it('merges samples from sources that answer', async () => {
    const omForecast = [
      { hourly: { time: ['2026-06-13T04:00'], windspeed_10m: [3], winddirection_10m: [270], temperature_2m: [9], surface_pressure: [1013] } },
      { hourly: { time: ['2026-06-13T04:00'], windspeed_10m: [3], winddirection_10m: [270], temperature_2m: [9], surface_pressure: [1013] } },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('api.open-meteo.com')) return { ok: true, json: async () => omForecast } as Response;
      return { ok: false, json: async () => ({}) } as Response; // ensemble/smhi/met.no down
    }));
    const out = await gatherWindSamples(points, '2026-06-13');
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.source === 'open-meteo-forecast')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/tests/fetchAll.test.ts`
Expected: FAIL — cannot resolve `../src/weather/fetchAll.js` / exports undefined.

- [ ] **Step 3: Add batched Open-Meteo forecast to `packages/core/src/weather/openMeteo.ts`**

Append these exports (reuse the existing `buildQuery`, `HOURLY_PARAMS`, `parseOpenMeteo`):

```ts
/**
 * Build a single forecast URL covering many points via comma-separated
 * latitude/longitude lists. Open-Meteo returns an array of location objects in
 * the same order. Bounds the forecast endpoint to ONE request for the route.
 */
export function buildForecastUrlMulti(points: GeoPoint[], date: string): string {
  const q = buildQuery({
    latitude: points.map((p) => p.lat).join(','),
    longitude: points.map((p) => p.lon).join(','),
    hourly: HOURLY_PARAMS,
    windspeed_unit: 'ms',
    start_date: date,
    end_date: date,
    timezone: 'UTC',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/**
 * Parse a batched Open-Meteo response. When multiple coordinates are requested
 * the API returns an array (one element per point); a single coordinate returns
 * one object. Each element maps to points[i].
 */
export function parseOpenMeteoBatch(
  json: any,
  points: GeoPoint[],
  source = 'open-meteo-forecast',
): WindSample[] {
  const arr = Array.isArray(json) ? json : [json];
  const out: WindSample[] = [];
  for (let i = 0; i < arr.length && i < points.length; i++) {
    out.push(...parseOpenMeteo(arr[i], points[i], source));
  }
  return out;
}

/**
 * Fetch the batched forecast for all points in one request. Returns [] on error
 * so a dead source never blocks the rest of the pipeline.
 */
export async function fetchOpenMeteoForecastBatched(
  points: GeoPoint[],
  date: string,
): Promise<WindSample[]> {
  if (points.length === 0) return [];
  try {
    const res = await fetch(buildForecastUrlMulti(points, date));
    if (!res.ok) return [];
    const json = await res.json();
    return parseOpenMeteoBatch(json, points, 'open-meteo-forecast');
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Create `packages/core/src/weather/fetchAll.ts`**

```ts
/**
 * Multi-source wind fetch (universal fetch; runs on a server or in Node).
 *
 * The URL builders + parsers are pure and live alongside this module; this file
 * performs the requests and the per-source isolation. Each source is wrapped so
 * a rejection or partial failure contributes nothing instead of failing the run.
 *
 * Per-point sources (SMHI, MET Norway, Open-Meteo ensemble) run with bounded
 * concurrency. The Open-Meteo forecast endpoint is batched to a single request.
 */
import {
  buildEnsembleUrl,
  parseOpenMeteo,
  fetchOpenMeteoForecastBatched,
  type GeoPoint,
} from './openMeteo.js';
import { buildSmhiUrl, parseSmhi } from './smhi.js';
import { buildMetNorwayUrl, metNorwayHeaders, parseMetNorway } from './metNorway.js';
import type { WindSample } from '../types.js';

/** Run `fn` over `items` with at most `limit` concurrent in-flight calls. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

const CONCURRENCY = 10;

export async function fetchSmhi(point: GeoPoint): Promise<WindSample[]> {
  try {
    const res = await fetch(buildSmhiUrl(point));
    if (!res.ok) return [];
    return parseSmhi(await res.json(), point);
  } catch {
    return [];
  }
}

export async function fetchMetNorway(point: GeoPoint): Promise<WindSample[]> {
  try {
    const res = await fetch(buildMetNorwayUrl(point), { headers: metNorwayHeaders() });
    if (!res.ok) return [];
    return parseMetNorway(await res.json(), point);
  } catch {
    return [];
  }
}

async function fetchOpenMeteoEnsemblePoint(point: GeoPoint, date: string): Promise<WindSample[]> {
  try {
    const res = await fetch(buildEnsembleUrl(point, date));
    if (!res.ok) return [];
    return parseOpenMeteo(await res.json(), point, 'open-meteo-ensemble');
  } catch {
    return [];
  }
}

/**
 * Gather wind samples from all sources for the given points + date.
 * Sources are isolated: each contributes whatever it can; none can fail the run.
 */
export async function gatherWindSamples(points: GeoPoint[], date: string): Promise<WindSample[]> {
  if (points.length === 0) return [];

  const [forecast, ensemble, smhi, met] = await Promise.all([
    fetchOpenMeteoForecastBatched(points, date),
    mapLimit(points, CONCURRENCY, (p) => fetchOpenMeteoEnsemblePoint(p, date)),
    mapLimit(points, CONCURRENCY, (p) => fetchSmhi(p)),
    mapLimit(points, CONCURRENCY, (p) => fetchMetNorway(p)),
  ]);

  return [forecast, ...ensemble, ...smhi, ...met].flat();
}
```

- [ ] **Step 5: Re-export from `packages/core/src/index.ts`**

In the weather block, add:

```ts
export {
  buildForecastUrlMulti,
  parseOpenMeteoBatch,
  fetchOpenMeteoForecastBatched,
} from './weather/openMeteo.js';
export { gatherWindSamples, fetchSmhi, fetchMetNorway, mapLimit } from './weather/fetchAll.js';
```

- [ ] **Step 6: Make `packages/cli/src/weatherFetch.ts` a thin re-export**

Replace the whole file with:

```ts
/**
 * Back-compat shim. The multi-source fetch now lives in @stp/core
 * (weather/fetchAll.ts) so the Vercel function and the CLI share one path.
 */
export { gatherWindSamples, fetchSmhi, fetchMetNorway } from '@stp/core';
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run packages/core/tests/fetchAll.test.ts` → PASS.
Run: `npm test` → all green (CLI imports still resolve via the shim).
Run: `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/weather/fetchAll.ts packages/core/src/weather/openMeteo.ts packages/core/src/index.ts packages/cli/src/weatherFetch.ts packages/core/tests/fetchAll.test.ts
git commit -m "feat(core): universal multi-source wind fetch with batching + bounded concurrency"
```

---

### Task 2: `sampleCellPoints` — one point per 0.1° cell

**Goal:** Replace the fixed ~10-point sampling with one representative point per distinct 0.1° ensemble cell the route crosses (~44 for Vättern), in route order.

**Files:**
- Create: `packages/core/src/weather/sample.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/cli/src/cli.ts` (use `sampleCellPoints`)
- Test: `packages/core/tests/sample.test.ts`

**Acceptance Criteria:**
- [ ] `sampleCellPoints(micro)` emits the segment-start coord the first time each `(round(lat,1), round(lon,1))` bin is seen.
- [ ] Output is deduped by 0.1° bin, ordered by first appearance.
- [ ] Empty input → `[]`.
- [ ] CLI uses it (the old fixed-10 `sampleWeatherPoints` is removed/replaced).

**Verify:** `npx vitest run packages/core/tests/sample.test.ts` → PASS; `npm test` → green.

**Steps:**

- [ ] **Step 1: Write the failing test** `packages/core/tests/sample.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { sampleCellPoints } from '../src/weather/sample.js';
import type { MicroSegment } from '../src/types.js';

function seg(lat: number, lon: number): MicroSegment {
  return {
    index: 0, distance_m: 100, cum_distance_m: 100, grade: 0, bearing_deg: 0,
    lat, lon, ele_start_m: 0, ele_end_m: 0, neutral: false,
  };
}

describe('sampleCellPoints', () => {
  it('returns [] for empty input', () => {
    expect(sampleCellPoints([])).toEqual([]);
  });

  it('dedupes consecutive points within the same 0.1deg cell', () => {
    const micro = [seg(58.51, 14.61), seg(58.52, 14.62), seg(58.59, 14.69)];
    // first two round to (58.5,14.6); third to (58.6,14.7)
    const pts = sampleCellPoints(micro);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ lat: 58.51, lon: 14.61 });
    expect(pts[1]).toEqual({ lat: 58.59, lon: 14.69 });
  });

  it('preserves first-appearance order and re-emits a revisited bin only once', () => {
    const micro = [seg(58.51, 14.61), seg(58.59, 14.69), seg(58.52, 14.63)];
    const pts = sampleCellPoints(micro); // bin A, bin B, bin A again -> A,B
    expect(pts).toHaveLength(2);
    expect(pts[0].lat).toBe(58.51);
    expect(pts[1].lat).toBe(58.59);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/tests/sample.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `packages/core/src/weather/sample.ts`**

```ts
/**
 * Route -> weather sample points.
 *
 * The ensemble bins coordinates to 0.1deg (~11 km). The maximum-fidelity,
 * zero-waste sampling is therefore exactly one point per distinct 0.1deg cell
 * the route crosses: finer collapses into the same bin, coarser leaves gaps.
 * We walk the microsegments in route order and emit each segment-start coord the
 * first time its 0.1deg bin is seen.
 */
import type { MicroSegment } from '../types.js';
import type { GeoPoint } from './openMeteo.js';

function binKey(lat: number, lon: number): string {
  return `${Math.round(lat * 10) / 10}|${Math.round(lon * 10) / 10}`;
}

export function sampleCellPoints(micro: MicroSegment[]): GeoPoint[] {
  const seen = new Set<string>();
  const points: GeoPoint[] = [];
  for (const m of micro) {
    const key = binKey(m.lat, m.lon);
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ lat: m.lat, lon: m.lon });
  }
  return points;
}
```

- [ ] **Step 4: Export from `packages/core/src/index.ts`**

```ts
export { sampleCellPoints } from './weather/sample.js';
```

- [ ] **Step 5: Switch the CLI to `sampleCellPoints`**

In `packages/cli/src/cli.ts`: delete the local `sampleWeatherPoints` function (lines ~70-89), add `sampleCellPoints` to the `@stp/core` import, and replace the call site (`const points = sampleWeatherPoints(micro);`) with `const points = sampleCellPoints(micro);`. If any CLI test imports `sampleWeatherPoints`, update it to `sampleCellPoints`.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run packages/core/tests/sample.test.ts` → PASS.
Run: `npm test` → green. Run: `npm run typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/weather/sample.ts packages/core/src/index.ts packages/cli/src/cli.ts packages/core/tests/sample.test.ts
git commit -m "feat(core): sample one weather point per 0.1deg cell the route crosses"
```

---

### Task 3: Hourly summarize / override / manual field helpers

**Goal:** Pure helpers that (a) summarize an `EnsembleField` to per-clock-hour wind, (b) apply per-hour user overrides back onto a field, and (c) build a synthetic field from manual entries.

**Files:**
- Create: `packages/core/src/weather/hourly.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/hourly.test.ts`

**Acceptance Criteria:**
- [ ] `summarizeHourly(field, hours)` returns one `{ hour, dir_from_deg, speed_ms }` per requested hour via vector mean across that hour's cells; empty hour falls back to the nearest available hour.
- [ ] `applyHourlyOverrides(field, overrides)` replaces dir + mean speed and collapses p10/p90 = speed on overridden hours only; returns a NEW field (input untouched).
- [ ] `buildManualField(entries, raceDate, centroid)` returns one cell per entry at the centroid with `time_iso = \`${raceDate}T${HH}:00:00Z\``, `sources: ['manual']`, `reduced: true`.

**Verify:** `npx vitest run packages/core/tests/hourly.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test** `packages/core/tests/hourly.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  summarizeHourly,
  applyHourlyOverrides,
  buildManualField,
  type HourlyWind,
} from '../src/weather/hourly.js';
import type { EnsembleField } from '../src/weather/ensemble.js';

function cell(hour: number, dir: number, speed: number) {
  const HH = String(hour).padStart(2, '0');
  return {
    time_iso: `2026-06-13T${HH}:00:00Z`, lat: 58.5, lon: 14.6,
    windspeed_mean_ms: speed, winddir_from_deg: dir,
    windspeed_p10_ms: speed - 1, windspeed_p90_ms: speed + 1,
    temp_c: 10, pressure_pa: 101_325, n_sources: 3,
  };
}

const field: EnsembleField = {
  cells: [cell(6, 90, 4), cell(7, 180, 6)],
  sources: ['a', 'b', 'c'], reduced: false,
};

describe('summarizeHourly', () => {
  it('returns one row per requested hour', () => {
    const rows = summarizeHourly(field, [6, 7]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ hour: 6 });
    expect(Math.round(rows[0].dir_from_deg)).toBe(90);
    expect(Math.round(rows[0].speed_ms)).toBe(4);
  });

  it('falls back to the nearest hour when a requested hour has no cells', () => {
    const rows = summarizeHourly(field, [9]);
    expect(rows).toHaveLength(1);
    expect(Math.round(rows[0].speed_ms)).toBe(6); // hour 7 is nearest
  });
});

describe('applyHourlyOverrides', () => {
  it('overrides only the named hour and collapses its spread', () => {
    const overrides: HourlyWind[] = [{ hour: 6, dir_from_deg: 0, speed_ms: 10 }];
    const out = applyHourlyOverrides(field, overrides);
    const h6 = out.cells.find((c) => c.time_iso.includes('T06'))!;
    const h7 = out.cells.find((c) => c.time_iso.includes('T07'))!;
    expect(h6.winddir_from_deg).toBe(0);
    expect(h6.windspeed_mean_ms).toBe(10);
    expect(h6.windspeed_p10_ms).toBe(10);
    expect(h6.windspeed_p90_ms).toBe(10);
    expect(h7.winddir_from_deg).toBe(180); // untouched
    expect(field.cells[0].winddir_from_deg).toBe(90); // input not mutated
  });
});

describe('buildManualField', () => {
  it('creates one centroid cell per entry', () => {
    const entries: HourlyWind[] = [
      { hour: 6, dir_from_deg: 270, speed_ms: 5 },
      { hour: 7, dir_from_deg: 270, speed_ms: 5 },
    ];
    const out = buildManualField(entries, '2026-06-13', { lat: 58.4, lon: 14.5 });
    expect(out.cells).toHaveLength(2);
    expect(out.cells[0].time_iso).toBe('2026-06-13T06:00:00Z');
    expect(out.cells[0].lat).toBe(58.4);
    expect(out.sources).toEqual(['manual']);
    expect(out.reduced).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/tests/hourly.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `packages/core/src/weather/hourly.ts`**

```ts
/**
 * Per-clock-hour wind summary, user overrides, and manual field construction.
 *
 * The web UI shows wind "hour by hour" (route-wide). summarizeHourly collapses
 * the spatial ensemble to one vector-mean wind per hour for display.
 * applyHourlyOverrides folds the user's edits back onto the field;
 * buildManualField makes a field out of nothing but the user's numbers.
 */
import type { EnsembleField, EnsembleCell } from './ensemble.js';
import type { GeoPoint } from './openMeteo.js';

export interface HourlyWind {
  hour: number;          // hour of day 0..23
  dir_from_deg: number;  // meteorological from-direction
  speed_ms: number;
}

function hourOf(timeIso: string): number {
  return parseInt(timeIso.slice(11, 13), 10);
}

function vectorMean(cells: EnsembleCell[]): { dir: number; speed: number } {
  let u = 0, v = 0;
  for (const c of cells) {
    const rad = (c.winddir_from_deg * Math.PI) / 180;
    u += -c.windspeed_mean_ms * Math.sin(rad);
    v += -c.windspeed_mean_ms * Math.cos(rad);
  }
  const n = Math.max(1, cells.length);
  u /= n; v /= n;
  const speed = Math.hypot(u, v);
  const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { dir, speed };
}

/** One summary row per requested hour; empty hours fall back to the nearest. */
export function summarizeHourly(field: EnsembleField, hours: number[]): HourlyWind[] {
  const byHour = new Map<number, EnsembleCell[]>();
  for (const c of field.cells) {
    const h = hourOf(c.time_iso);
    (byHour.get(h) ?? byHour.set(h, []).get(h)!).push(c);
  }
  const available = [...byHour.keys()];
  return hours.map((hour) => {
    let cells = byHour.get(hour);
    if (!cells || cells.length === 0) {
      if (available.length === 0) return { hour, dir_from_deg: 0, speed_ms: 0 };
      const nearest = available.reduce((a, b) =>
        Math.abs(b - hour) < Math.abs(a - hour) ? b : a);
      cells = byHour.get(nearest)!;
    }
    const { dir, speed } = vectorMean(cells);
    return { hour, dir_from_deg: dir, speed_ms: speed };
  });
}

/** Return a new field with the given hours overridden (spread collapsed). */
export function applyHourlyOverrides(field: EnsembleField, overrides: HourlyWind[]): EnsembleField {
  const map = new Map(overrides.map((o) => [o.hour, o]));
  const cells = field.cells.map((c) => {
    const o = map.get(hourOf(c.time_iso));
    if (!o) return c;
    return {
      ...c,
      winddir_from_deg: o.dir_from_deg,
      windspeed_mean_ms: o.speed_ms,
      windspeed_p10_ms: o.speed_ms,
      windspeed_p90_ms: o.speed_ms,
    };
  });
  return { ...field, cells };
}

/** Build a synthetic field: one centroid cell per manual hourly entry. */
export function buildManualField(
  entries: HourlyWind[],
  raceDate: string,
  centroid: GeoPoint,
): EnsembleField {
  const cells: EnsembleCell[] = entries.map((e) => {
    const HH = String(e.hour).padStart(2, '0');
    return {
      time_iso: `${raceDate}T${HH}:00:00Z`,
      lat: centroid.lat, lon: centroid.lon,
      windspeed_mean_ms: e.speed_ms, winddir_from_deg: e.dir_from_deg,
      windspeed_p10_ms: e.speed_ms, windspeed_p90_ms: e.speed_ms,
      temp_c: 10, pressure_pa: 101_325, n_sources: 1,
    };
  });
  return { cells, sources: ['manual'], reduced: true };
}
```

- [ ] **Step 4: Export from `packages/core/src/index.ts`**

```ts
export {
  summarizeHourly,
  applyHourlyOverrides,
  buildManualField,
  type HourlyWind,
} from './weather/hourly.js';
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run packages/core/tests/hourly.test.ts` → PASS. Run: `npm test` → green. Run: `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/weather/hourly.ts packages/core/src/index.ts packages/core/tests/hourly.test.ts
git commit -m "feat(core): hourly wind summary, overrides, and manual field builder"
```

---

### Task 4: Vercel `/api/weather` endpoint + cache header

**Goal:** A cached serverless function that fetches all sources for the supplied points+date and returns the `EnsembleField`. Logic lives in a testable `handleWeather`; the function is a thin adapter.

**Files:**
- Create: `api/handler.ts`
- Create: `api/weather.ts`
- Create: `api/tsconfig.json`
- Create: `api/tests/handler.test.ts`
- Modify: `vitest.config.ts`
- Modify: `package.json`

**Acceptance Criteria:**
- [ ] `parseWeatherQuery` parses `date` + `pts` (`lat,lon|lat,lon|...`); rejects missing/malformed input.
- [ ] `handleWeather` returns `{ status, headers, body }` with the `EnsembleField` and `Cache-Control: public, s-maxage=10800, stale-while-revalidate=86400` on success.
- [ ] All sources failing → `status 200` with empty field `{ cells: [], sources: [], reduced: true }`.
- [ ] Bad query → `status 400`, no cache header.
- [ ] `npm run typecheck` covers `api/`; `npm test` runs `api/tests`.

**Verify:** `npx vitest run api/tests/handler.test.ts` → PASS; `npm run typecheck` → clean.

**Steps:**

- [ ] **Step 1: Add `@vercel/node` devDependency + typecheck wiring**

In `package.json`: add to `devDependencies`: `"@vercel/node": "^5"`. Change the `typecheck` script to also check the api dir:

```json
"typecheck": "tsc --noEmit && tsc --noEmit -p api/tsconfig.json && npm run typecheck -w apps/web"
```

Run: `npm install`.

- [ ] **Step 2: Create `api/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "rootDir": "..", "types": ["node"] },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: Include api tests in vitest** (`vitest.config.ts`, the `unit` project)

Change its `include` to:

```ts
include: ['packages/*/tests/**/*.test.ts', 'api/tests/**/*.test.ts'],
```

- [ ] **Step 4: Write the failing test** `api/tests/handler.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseWeatherQuery, handleWeather } from '../handler.js';

afterEach(() => vi.restoreAllMocks());

describe('parseWeatherQuery', () => {
  it('parses date + pipe-separated points', () => {
    const r = parseWeatherQuery({ date: '2026-06-13', pts: '58.5,14.6|58.6,14.7' });
    expect(r).toEqual({ date: '2026-06-13', points: [{ lat: 58.5, lon: 14.6 }, { lat: 58.6, lon: 14.7 }] });
  });
  it('returns null on missing date', () => {
    expect(parseWeatherQuery({ pts: '58.5,14.6' })).toBeNull();
  });
  it('returns null on malformed pts', () => {
    expect(parseWeatherQuery({ date: '2026-06-13', pts: 'garbage' })).toBeNull();
  });
});

describe('handleWeather', () => {
  it('400 on bad query', async () => {
    const res = await handleWeather({ date: '', pts: '' });
    expect(res.status).toBe(400);
    expect(res.headers['Cache-Control']).toBeUndefined();
  });

  it('200 + empty field + cache header when all sources fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const res = await handleWeather({ date: '2026-06-13', pts: '58.5,14.6' });
    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toContain('s-maxage=10800');
    expect(res.body).toEqual({ cells: [], sources: [], reduced: true });
  });

  it('200 + ensemble when a source answers', async () => {
    const om = [{ hourly: { time: ['2026-06-13T04:00'], windspeed_10m: [3], winddirection_10m: [270], temperature_2m: [9], surface_pressure: [1013] } }];
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('api.open-meteo.com')
        ? ({ ok: true, json: async () => om } as Response)
        : ({ ok: false, json: async () => ({}) } as Response)));
    const res = await handleWeather({ date: '2026-06-13', pts: '58.5,14.6' });
    expect(res.status).toBe(200);
    expect(res.body.cells.length).toBeGreaterThan(0);
    expect(res.body.sources).toContain('open-meteo-forecast');
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run api/tests/handler.test.ts`
Expected: FAIL — `../handler.js` not found.

- [ ] **Step 6: Create `api/handler.ts`**

```ts
/**
 * Pure-ish weather request handler, decoupled from the Vercel runtime so it can
 * be unit-tested with a mocked global fetch. api/weather.ts is the thin adapter.
 */
import { gatherWindSamples, buildEnsemble, type GeoPoint, type EnsembleField } from '@stp/core';

export interface WeatherQuery {
  date?: string | string[];
  pts?: string | string[];
}

export interface WeatherResult {
  status: number;
  headers: Record<string, string>;
  body: EnsembleField | { error: string };
}

const CACHE_HEADER = 'public, s-maxage=10800, stale-while-revalidate=86400';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse + validate the query. Returns null when invalid. */
export function parseWeatherQuery(q: WeatherQuery): { date: string; points: GeoPoint[] } | null {
  const date = first(q.date);
  const pts = first(q.pts);
  if (!date || !ISO_DATE.test(date) || !pts) return null;

  const points: GeoPoint[] = [];
  for (const pair of pts.split('|')) {
    const [latS, lonS] = pair.split(',');
    const lat = Number(latS), lon = Number(lonS);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    points.push({ lat, lon });
  }
  if (points.length === 0) return null;
  return { date, points };
}

export async function handleWeather(q: WeatherQuery): Promise<WeatherResult> {
  const parsed = parseWeatherQuery(q);
  if (!parsed) {
    return { status: 400, headers: {}, body: { error: 'bad query: require date=YYYY-MM-DD&pts=lat,lon|...' } };
  }
  const samples = await gatherWindSamples(parsed.points, parsed.date);
  const field = buildEnsemble(samples);
  return { status: 200, headers: { 'Cache-Control': CACHE_HEADER, 'Content-Type': 'application/json' }, body: field };
}
```

- [ ] **Step 7: Create `api/weather.ts` (Vercel adapter)**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleWeather } from './handler.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const result = await handleWeather(req.query as { date?: string | string[]; pts?: string | string[] });
  for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
  res.status(result.status).json(result.body);
}
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run api/tests/handler.test.ts` → PASS.
Run: `npm test` → green. Run: `npm run typecheck` → clean.

- [ ] **Step 9: Commit**

```bash
git add api/ vitest.config.ts package.json package-lock.json
git commit -m "feat(api): cached /api/weather endpoint fetching all sources server-side"
```

---

### Task 5: Web — inject the field into a network-free worker

**Goal:** The solve worker no longer fetches; it accepts a prebuilt `EnsembleField`. Add the client helper that calls `/api/weather`, plus race-hours + centroid utilities.

**Files:**
- Modify: `apps/web/src/lib/pipeline.ts`
- Create: `apps/web/src/lib/hours.ts`
- Create: `apps/web/src/lib/weatherClient.ts`
- Test: `apps/web/tests/pipeline.weather.test.ts`
- Test: `apps/web/tests/hours.test.ts`

**Acceptance Criteria:**
- [ ] `PipelineInput` gains `field: EnsembleField | null`; `weatherMode: 'calm' | 'fetched' | 'manual'`.
- [ ] `runPipeline`: `field` present → `solveThreeScenarios`; null → calm. No `fetchOpenMeteo` import remains in the worker/pipeline.
- [ ] `raceHours('06:00','2:30')` → `[6,7,8]`; wraps past midnight correctly.
- [ ] `centroidOf(points)` returns the mean lat/lon.
- [ ] `fetchEnsemble(date, points)` builds the `pts` query and GETs `/api/weather`.

**Verify:** `npx vitest run apps/web/tests/pipeline.weather.test.ts apps/web/tests/hours.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing tests**

`apps/web/tests/hours.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { raceHours, centroidOf } from '../src/lib/hours';

describe('raceHours', () => {
  it('covers start hour through end hour inclusive', () => {
    expect(raceHours('06:00', '2:30')).toEqual([6, 7, 8]);
  });
  it('wraps past midnight', () => {
    expect(raceHours('23:00', '3:00')).toEqual([23, 0, 1, 2]);
  });
});

describe('centroidOf', () => {
  it('averages lat/lon', () => {
    expect(centroidOf([{ lat: 58, lon: 14 }, { lat: 60, lon: 16 }])).toEqual({ lat: 59, lon: 15 });
  });
});
```

`apps/web/tests/pipeline.weather.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runPipeline, type PipelineInput } from '../src/lib/pipeline';
import { sampleRouteGpx } from '../src/lib/sampleRoute';
import { buildManualField } from '@stp/core';

const baseForm: PipelineInput['form'] = {
  target_total_hm: '2:30', ftp: 250, n_riders: 6, m: 90,
  stops: [], watch_target: 'pull', race_date: '2026-06-13', start_time: '06:00',
};

describe('runPipeline weather injection', () => {
  it('calm when field is null (no network)', async () => {
    const input: PipelineInput = { gpxText: sampleRouteGpx, fitBytes: null, form: baseForm, weatherMode: 'calm', field: null };
    const out = await runPipeline(input);
    expect(out.scenarios.expected).toBe(out.scenarios.optimistic);
  });

  it('uses an injected manual field', async () => {
    const field = buildManualField(
      [6, 7, 8].map((hour) => ({ hour, dir_from_deg: 0, speed_ms: 8 })),
      '2026-06-13', { lat: 58.5, lon: 14.6 },
    );
    const input: PipelineInput = { gpxText: sampleRouteGpx, fitBytes: null, form: baseForm, weatherMode: 'manual', field };
    const out = await runPipeline(input);
    expect(out.scenarios.expected.segments.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/tests/pipeline.weather.test.ts apps/web/tests/hours.test.ts`
Expected: FAIL — modules / `field` property missing.

- [ ] **Step 3: Create `apps/web/src/lib/hours.ts`**

```ts
import type { GeoPoint } from '@stp/core';

/** Clock hours (0..23) the rider is on course: floor(start) .. ceil(start+target). */
export function raceHours(startTime: string, targetHm: string): number[] {
  const [sh, sm] = startTime.split(':').map(Number);
  const [th, tm] = targetHm.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = startMin + th * 60 + tm;
  const firstHour = Math.floor(startMin / 60);
  const lastHour = Math.floor(endMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h <= lastHour; h++) hours.push(((h % 24) + 24) % 24);
  return hours;
}

export function centroidOf(points: GeoPoint[]): GeoPoint {
  if (points.length === 0) return { lat: 0, lon: 0 };
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lon = points.reduce((s, p) => s + p.lon, 0) / points.length;
  return { lat, lon };
}
```

- [ ] **Step 4: Create `apps/web/src/lib/weatherClient.ts`**

```ts
import type { GeoPoint, EnsembleField } from '@stp/core';

/** Round to the 0.1deg ensemble grid so the request URL (cache key) is canonical. */
function roundPt(p: GeoPoint): GeoPoint {
  return { lat: Math.round(p.lat * 10) / 10, lon: Math.round(p.lon * 10) / 10 };
}

export function buildPtsParam(points: GeoPoint[]): string {
  return points.map(roundPt).map((p) => `${p.lat},${p.lon}`).join('|');
}

/** Fetch the server-built ensemble for a date + route points. Throws on HTTP error. */
export async function fetchEnsemble(date: string, points: GeoPoint[]): Promise<EnsembleField> {
  const pts = buildPtsParam(points);
  const res = await fetch(`/api/weather?date=${encodeURIComponent(date)}&pts=${encodeURIComponent(pts)}`);
  if (!res.ok) throw new Error(`Weather fetch failed (${res.status})`);
  return (await res.json()) as EnsembleField;
}
```

- [ ] **Step 5: Modify `apps/web/src/lib/pipeline.ts`**

Update the imports: remove `fetchOpenMeteo`, `buildEnsemble`, `GeoPoint`, `WindSample` (no longer used here); add `type EnsembleField`. Remove the `sampleWeatherPoints` helper (now `sampleCellPoints` lives in core and sampling happens on the main thread). Change the contracts and the weather step:

```ts
// contract
export interface PipelineInput {
  gpxText: string;
  fitBytes?: Uint8Array | null;
  form: PipelineForm;
  weatherMode: 'calm' | 'fetched' | 'manual';
  field: EnsembleField | null;
}

// ... inside runPipeline, replace the whole "4. Weather + scenarios" block with:
  // 4. Weather + scenarios. The field is built on the main thread (fetched from
  // /api/weather and/or edited, or synthesised for manual mode). A null field
  // means calm wind. The worker performs zero network I/O.
  let scenarios: ThreeScenarios;
  if (input.field && input.field.cells.length > 0) {
    scenarios = solveThreeScenarios(micro, input.field, cfg);
  } else {
    const plan = solveForTargetTime(micro, calmWeather, cfg);
    scenarios = calmThreeScenarios(plan);
  }
```

Add `solveThreeScenarios`, `solveForTargetTime`, `calmWeather`, `type ThreeScenarios`, `type EnsembleField` to the `@stp/core` import (most already imported). Delete the now-unused `sampleWeatherPoints` function from this file.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run apps/web/tests/pipeline.weather.test.ts apps/web/tests/hours.test.ts` → PASS.
Run: `npm test` → green (the existing `solve.smoke.test.ts` may need its `PipelineInput` literals updated to include `field: null` and the new `weatherMode` values — update them).
Run: `npm run typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/pipeline.ts apps/web/src/lib/hours.ts apps/web/src/lib/weatherClient.ts apps/web/tests/pipeline.weather.test.ts apps/web/tests/hours.test.ts apps/web/tests/solve.smoke.test.ts
git commit -m "feat(web): inject prebuilt ensemble field into a network-free solve worker"
```

---

### Task 6: Web — WindHourTable + WeatherPanel components

**Goal:** The editable hour-by-hour wind table and the panel that hosts mode selection, fetch, manual entry, and the table.

**Files:**
- Create: `apps/web/src/components/WindHourTable.tsx`
- Create: `apps/web/src/components/WeatherPanel.tsx`
- Test: `apps/web/tests/WindHourTable.test.tsx`

**Acceptance Criteria:**
- [ ] `WindHourTable` renders one row per `HourlyWind` with editable direction + speed inputs and a compass arrow.
- [ ] Editing an input calls `onChange(hour, patch)` with the parsed number.
- [ ] Edited rows are marked and a per-row reset calls `onReset(hour)`.
- [ ] `WeatherPanel` exposes mode toggle (Lugnt/Hämta/Manuell), a "Hämta väder" button (fetched mode), a constant-wind quick entry (manual mode), the source list + a "reducerad" badge.

**Verify:** `npx vitest run apps/web/tests/WindHourTable.test.tsx` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test** `apps/web/tests/WindHourTable.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WindHourTable } from '../src/components/WindHourTable';
import type { HourlyWind } from '@stp/core';

const rows: HourlyWind[] = [
  { hour: 6, dir_from_deg: 90, speed_ms: 4 },
  { hour: 7, dir_from_deg: 180, speed_ms: 6 },
];

describe('WindHourTable', () => {
  it('renders a row per hour', () => {
    render(<WindHourTable rows={rows} edited={new Set()} onChange={() => {}} onReset={() => {}} />);
    expect(screen.getByText('06:00')).toBeTruthy();
    expect(screen.getByText('07:00')).toBeTruthy();
  });

  it('calls onChange with the parsed speed', () => {
    const onChange = vi.fn();
    render(<WindHourTable rows={rows} edited={new Set()} onChange={onChange} onReset={() => {}} />);
    const speedInputs = screen.getAllByLabelText(/styrka/i);
    fireEvent.change(speedInputs[0], { target: { value: '9' } });
    expect(onChange).toHaveBeenCalledWith(6, { speed_ms: 9 });
  });

  it('marks edited rows', () => {
    const { container } = render(
      <WindHourTable rows={rows} edited={new Set([6])} onChange={() => {}} onReset={() => {}} />,
    );
    expect(container.querySelector('.wind-row.edited')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/tests/WindHourTable.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Create `apps/web/src/components/WindHourTable.tsx`**

```tsx
/**
 * Editable hour-by-hour wind table (direction + strength, route-wide).
 * Rows are derived from the fetched ensemble (summarizeHourly) or the manual
 * entries. Editing a cell bubbles up via onChange; per-row reset via onReset.
 */
import type { HourlyWind } from '@stp/core';

interface Props {
  rows: HourlyWind[];
  edited: Set<number>;
  onChange: (hour: number, patch: Partial<Omit<HourlyWind, 'hour'>>) => void;
  onReset: (hour: number) => void;
}

const COMPASS = ['N', 'NÖ', 'Ö', 'SÖ', 'S', 'SV', 'V', 'NV'];

function compass(deg: number): string {
  return COMPASS[Math.round(((deg % 360) / 45)) % 8];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function WindHourTable({ rows, edited, onChange, onReset }: Props) {
  return (
    <table className="wind-table">
      <thead>
        <tr><th>Tid</th><th>Riktning</th><th></th><th>Styrka (m/s)</th><th></th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.hour} className={`wind-row${edited.has(r.hour) ? ' edited' : ''}`}>
            <td>{pad2(r.hour)}:00</td>
            <td>
              <input
                type="number" min={0} max={360} aria-label={`riktning ${r.hour}`}
                value={Math.round(r.dir_from_deg)}
                onChange={(e) => onChange(r.hour, { dir_from_deg: Number(e.target.value) })}
              />
            </td>
            <td>
              <span className="wind-arrow" style={{ transform: `rotate(${r.dir_from_deg + 180}deg)` }}>↑</span>
              <small>{compass(r.dir_from_deg)}</small>
            </td>
            <td>
              <input
                type="number" min={0} step={0.5} aria-label={`styrka ${r.hour}`}
                value={Math.round(r.speed_ms * 10) / 10}
                onChange={(e) => onChange(r.hour, { speed_ms: Number(e.target.value) })}
              />
            </td>
            <td>
              {edited.has(r.hour) && (
                <button type="button" className="link" onClick={() => onReset(r.hour)}>återställ</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Note: the test asserts `onChange(6, { speed_ms: 9 })`. The arrow rotates by `deg + 180` because the meteorological from-direction points where the wind comes FROM; the glyph shows where it blows TO.

- [ ] **Step 4: Run the table test**

Run: `npx vitest run apps/web/tests/WindHourTable.test.tsx` → PASS.

- [ ] **Step 5: Create `apps/web/src/components/WeatherPanel.tsx`**

```tsx
/**
 * Weather controls: pick a mode (calm / server fetch / manual), fetch the
 * server ensemble, view + edit the hour-by-hour wind, or enter it manually.
 * Owns the hourly rows + the edited-hours set, and reports the resolved
 * weatherMode + HourlyWind rows up to App, which builds the final field.
 */
import { useState } from 'react';
import type { HourlyWind } from '@stp/core';
import { WindHourTable } from './WindHourTable';

export type WeatherMode = 'calm' | 'fetched' | 'manual';

interface Props {
  hours: number[];
  mode: WeatherMode;
  onModeChange: (m: WeatherMode) => void;
  rows: HourlyWind[];
  edited: Set<number>;
  fetchStatus: 'idle' | 'loading' | 'done' | 'error';
  sources: string[];
  reduced: boolean;
  onFetch: () => void;
  onEdit: (hour: number, patch: Partial<Omit<HourlyWind, 'hour'>>) => void;
  onResetHour: (hour: number) => void;
  onApplyConstant: (dir: number, speed: number) => void;
}

export function WeatherPanel(props: Props) {
  const { mode, onModeChange, rows, edited, fetchStatus, sources, reduced } = props;
  const [constDir, setConstDir] = useState(270);
  const [constSpeed, setConstSpeed] = useState(5);

  return (
    <section className="card weather-panel">
      <h2>Väder</h2>

      <div className="seg-toggle" role="group" aria-label="Väderläge">
        {(['calm', 'fetched', 'manual'] as WeatherMode[]).map((m) => (
          <button
            key={m} type="button"
            className={mode === m ? 'active' : ''}
            onClick={() => onModeChange(m)}
          >
            {m === 'calm' ? 'Lugnt' : m === 'fetched' ? 'Hämta' : 'Manuell'}
          </button>
        ))}
      </div>

      {mode === 'fetched' && (
        <div className="weather-fetch">
          <button type="button" onClick={props.onFetch} disabled={fetchStatus === 'loading'}>
            {fetchStatus === 'loading' ? 'Hämtar…' : 'Hämta väder'}
          </button>
          {fetchStatus === 'error' && <span className="hint error">Hämtning misslyckades.</span>}
          {fetchStatus === 'done' && (
            <span className="hint">
              Källor: {sources.join(', ') || 'inga'}
              {reduced && <span className="badge">reducerad</span>}
            </span>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <div className="weather-manual">
          <label>Riktning°
            <input type="number" min={0} max={360} value={constDir}
              onChange={(e) => setConstDir(Number(e.target.value))} />
          </label>
          <label>Styrka m/s
            <input type="number" min={0} step={0.5} value={constSpeed}
              onChange={(e) => setConstSpeed(Number(e.target.value))} />
          </label>
          <button type="button" onClick={() => props.onApplyConstant(constDir, constSpeed)}>
            Applicera på alla timmar
          </button>
        </div>
      )}

      {mode !== 'calm' && rows.length > 0 && (
        <WindHourTable rows={rows} edited={edited} onChange={props.onEdit} onReset={props.onResetHour} />
      )}
    </section>
  );
}
```

- [ ] **Step 6: Add minimal styles** to `apps/web/src/styles.css` (append):

```css
.weather-panel .seg-toggle { display: flex; gap: 4px; margin-bottom: 12px; }
.weather-panel .seg-toggle button { padding: 6px 14px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
.weather-panel .seg-toggle button.active { background: #1f6feb; color: #fff; border-color: #1f6feb; }
.wind-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
.wind-table th, .wind-table td { padding: 4px 8px; text-align: left; border-bottom: 1px solid #eee; }
.wind-table input { width: 64px; }
.wind-row.edited { background: #fff7e0; }
.wind-arrow { display: inline-block; }
.badge { margin-left: 6px; padding: 1px 6px; background: #ffd; border: 1px solid #cc0; border-radius: 4px; font-size: 11px; }
.link { background: none; border: none; color: #1f6feb; cursor: pointer; padding: 0; }
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run apps/web/tests/WindHourTable.test.tsx` → PASS. Run: `npm test` → green. Run: `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/WindHourTable.tsx apps/web/src/components/WeatherPanel.tsx apps/web/src/styles.css apps/web/tests/WindHourTable.test.tsx
git commit -m "feat(web): editable hour-by-hour wind table + weather panel"
```

---

### Task 7: Web — wire WeatherPanel into App, build the final field

**Goal:** App hosts WeatherPanel, fetches/edits/manual-builds the field on the main thread, passes it to the solver; UploadForm drops its old weather-mode select; privacy note updated.

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/UploadForm.tsx`
- Test: `apps/web/tests/App.weather.test.tsx`

**Acceptance Criteria:**
- [ ] App owns weather state: `mode`, fetched `field`, per-hour `overrides`, `manual` entries, fetch status/sources.
- [ ] "Hämta väder" → ingest GPX (`applyDefaults` + `ingestGpxString`), `sampleCellPoints`, `fetchEnsemble`, `summarizeHourly` → rows.
- [ ] Editing a row records an override; reset clears it.
- [ ] On run, App computes the final field: fetched → `applyHourlyOverrides(field, overrides)`; manual → `buildManualField(rows, race_date, centroid)`; calm → null. Posts it via the existing solver.
- [ ] UploadForm no longer renders a weather-mode `<select>`; the old `weatherMode` plumbing is removed from its `PipelineInput` assembly (App supplies it).
- [ ] Privacy note states only rounded coords + date are sent in fetched mode.

**Verify:** `npx vitest run apps/web/tests/App.weather.test.tsx` → PASS; `npm test` → green.

**Steps:**

- [ ] **Step 1: Write the failing test** `apps/web/tests/App.weather.test.tsx`

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../src/App';

afterEach(() => vi.restoreAllMocks());

describe('App weather panel', () => {
  it('shows the weather modes and a manual constant entry', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Manuell' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manuell' }));
    expect(screen.getByText('Applicera på alla timmar')).toBeTruthy();
  });
});
```

(Worker construction is jsdom-safe because `useSolver` creates the worker lazily on run; this test never runs the solver.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/tests/App.weather.test.tsx`
Expected: FAIL — modes / button not present.

- [ ] **Step 3: Edit `apps/web/src/components/UploadForm.tsx`**

Remove the weather-mode `<select>` block (the `Weather mode` label and the `{weatherMode === 'open-meteo' && (...)}` race-date block stays as a plain date field — keep the date input but unconditional). Remove `weatherMode` from the persisted form, the `onSubmit` `PipelineInput` assembly, and the `WeatherMode` type. Change `onRun` so App supplies weather: the form now calls `onRun(formInput)` where `formInput` carries `gpxText`, `fitBytes`, `form` only. Update the `Props.onRun` signature to a new `FormSubmit` shape:

```ts
export interface FormSubmit {
  gpxText: string;
  fitBytes: Uint8Array | null;
  form: PipelineForm;
}
interface Props {
  onRun: (input: FormSubmit) => void;
  status: SolverStatus;
}
```

Import `type { PipelineForm }` from `../worker/solve.worker`. In `onSubmit`, build a `FormSubmit` (no `weatherMode`, no `field`). Keep the race-date input visible always (it feeds fetched/manual).

- [ ] **Step 4: Rewrite `apps/web/src/App.tsx`**

```tsx
/**
 * StickToThePlan web app shell.
 *
 * Orchestrates the form, the weather panel (server fetch + hour-by-hour
 * edit + manual entry), the compute worker, and the results. All heavy compute
 * runs in the worker; weather is fetched on the main thread so the user can see
 * and edit it before solving. The only network egress is the rounded route
 * coordinates + date sent to /api/weather in fetched mode.
 */
import { useState } from 'react';
import {
  applyDefaults, ingestGpxString, sampleCellPoints,
  summarizeHourly, applyHourlyOverrides, buildManualField,
  type EnsembleField, type HourlyWind,
} from '@stp/core';
import { useSolver } from './useSolver';
import { UploadForm, type FormSubmit } from './components/UploadForm';
import { WeatherPanel, type WeatherMode } from './components/WeatherPanel';
import { ScenarioSummary } from './components/ScenarioSummary';
import { SplitTable } from './components/SplitTable';
import { Downloads } from './components/Downloads';
import { TempokortTable } from './components/TempokortTable';
import { raceHours, centroidOf } from './lib/hours';
import { fetchEnsemble } from './lib/weatherClient';
import type { PipelineInput } from './worker/solve.worker';

export function App() {
  const solver = useSolver();
  const [ranInput, setRanInput] = useState<PipelineInput | null>(null);
  const [lastForm, setLastForm] = useState<FormSubmit | null>(null);

  // Weather state.
  const [mode, setMode] = useState<WeatherMode>('calm');
  const [field, setField] = useState<EnsembleField | null>(null);
  const [baseRows, setBaseRows] = useState<HourlyWind[]>([]);
  const [overrides, setOverrides] = useState<Map<number, HourlyWind>>(new Map());
  const [centroid, setCentroid] = useState({ lat: 0, lon: 0 });
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [sources, setSources] = useState<string[]>([]);
  const [reduced, setReduced] = useState(false);

  const hoursFor = (f: FormSubmit | null) =>
    f ? raceHours(f.form.start_time, f.form.target_total_hm) : raceHours('06:00', '0:00');

  // Rows shown = base summary with overrides applied on top.
  const displayedRows: HourlyWind[] = baseRows.map((r) => overrides.get(r.hour) ?? r);
  const editedHours = new Set(overrides.keys());

  const doFetch = async (form: FormSubmit) => {
    if (!form.gpxText.trim()) return;
    setFetchStatus('loading');
    try {
      const cfg = applyDefaults({
        gpx_path: 'web.gpx', race_date: form.form.race_date, start_time: form.form.start_time,
        ftp: form.form.ftp, n_riders: form.form.n_riders, target_total_hm: form.form.target_total_hm,
        stops: form.form.stops, m: form.form.m, watch_target: form.form.watch_target,
      });
      const micro = ingestGpxString(form.gpxText, cfg);
      const points = sampleCellPoints(micro);
      setCentroid(centroidOf(points));
      const f = await fetchEnsemble(form.form.race_date, points);
      setField(f);
      setSources(f.sources);
      setReduced(f.reduced || f.sources.length < 3);
      setBaseRows(summarizeHourly(f, hoursFor(form)));
      setOverrides(new Map());
      setFetchStatus('done');
    } catch {
      setFetchStatus('error');
    }
  };

  const editHour = (hour: number, patch: Partial<Omit<HourlyWind, 'hour'>>) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const current = next.get(hour) ?? baseRows.find((r) => r.hour === hour) ?? { hour, dir_from_deg: 0, speed_ms: 0 };
      next.set(hour, { ...current, ...patch, hour });
      return next;
    });
  };

  const resetHour = (hour: number) => {
    setOverrides((prev) => { const next = new Map(prev); next.delete(hour); return next; });
  };

  const applyConstant = (dir: number, speed: number) => {
    const hrs = hoursFor(lastForm);
    const rows = hrs.map((hour) => ({ hour, dir_from_deg: dir, speed_ms: speed }));
    setBaseRows(rows);
    setOverrides(new Map());
  };

  const onModeChange = (m: WeatherMode) => {
    setMode(m);
    if (m === 'manual' && baseRows.length === 0) {
      const hrs = hoursFor(lastForm);
      setBaseRows(hrs.map((hour) => ({ hour, dir_from_deg: 270, speed_ms: 5 })));
    }
  };

  const buildFinalField = (): EnsembleField | null => {
    if (mode === 'calm') return null;
    if (mode === 'manual') {
      return buildManualField(displayedRows, lastForm?.form.race_date ?? '2026-06-13', centroid);
    }
    // fetched
    if (!field) return null;
    return applyHourlyOverrides(field, [...overrides.values()]);
  };

  const handleRun = (form: FormSubmit) => {
    setLastForm(form);
    const input: PipelineInput = {
      gpxText: form.gpxText, fitBytes: form.fitBytes, form: form.form,
      weatherMode: mode, field: buildFinalField(),
    };
    setRanInput(input);
    solver.run(input);
  };

  const { status, result, error } = solver;
  const startTime = ranInput?.form.start_time ?? '00:00';
  const weatherMode = ranInput?.weatherMode ?? 'calm';

  return (
    <main className="app">
      <header className="app-header">
        <h1>StickToThePlan</h1>
        <p className="tagline">Vatternrundan race-plan calculator</p>
      </header>

      <p className="privacy">
        Uploaded GPX and FIT files are processed entirely in your browser and never uploaded.
        In <strong>Hämta</strong> (server) mode, only the route's rounded sample coordinates and the
        date are sent to our weather function, which queries SMHI, MET Norway and Open-Meteo.
        Calm and manual modes send nothing.
      </p>

      <UploadForm onRun={(f) => { setLastForm(f); }} status={status} />

      <WeatherPanel
        hours={hoursFor(lastForm)}
        mode={mode}
        onModeChange={onModeChange}
        rows={mode === 'calm' ? [] : displayedRows}
        edited={editedHours}
        fetchStatus={fetchStatus}
        sources={sources}
        reduced={reduced}
        onFetch={() => lastForm && doFetch(lastForm)}
        onEdit={editHour}
        onResetHour={resetHour}
        onApplyConstant={applyConstant}
      />

      <div className="run-row">
        <button
          type="button"
          className="run-button"
          disabled={status === 'running' || !lastForm?.gpxText.trim()}
          onClick={() => lastForm && handleRun(lastForm)}
        >
          {status === 'running' ? 'Beräknar…' : 'Beräkna plan'}
        </button>
      </div>

      {status === 'error' && (
        <section className="card error-card">
          <h2>Something went wrong</h2>
          <p>{error}</p>
        </section>
      )}

      {status === 'done' && result && (
        <>
          {result.scenarios.optimistic !== result.scenarios.expected ||
          result.scenarios.pessimistic !== result.scenarios.expected ? (
            <ScenarioSummary scenarios={result.scenarios} />
          ) : null}
          <SplitTable splits={result.splits} startTime={startTime} />
          <Downloads result={result} weatherMode={weatherMode} />
          <TempokortTable
            segments={result.displaySegments}
            compactSegments={result.styrkortSegments}
            startTime={startTime}
          />
        </>
      )}
    </main>
  );
}
```

Note the data-flow change: the form's submit now just stores `lastForm` (so the weather panel and run button can use it); the actual solve is triggered by the dedicated "Beräkna plan" button so the user fetches/edits weather first. Confirm `Downloads`' `weatherMode` prop type accepts the new union (it is only used as a label/string — widen its prop type to `string` if it was `'calm' | 'open-meteo'`).

- [ ] **Step 5: Fix the `Downloads` weatherMode prop type** if needed

Open `apps/web/src/components/Downloads.tsx`; if it types `weatherMode: 'calm' | 'open-meteo'`, change to `weatherMode: string`.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run apps/web/tests/App.weather.test.tsx` → PASS.
Run: `npm test` → green (update any existing `App`/`UploadForm` test that asserted the old weather select or the old `onRun` shape).
Run: `npm run typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/UploadForm.tsx apps/web/src/components/Downloads.tsx apps/web/tests/App.weather.test.tsx
git commit -m "feat(web): wire weather panel — fetch, hourly edit, and manual wind into the solve"
```

---

### Task 8: Full verification, dev-server check, push + preview deploy

**Goal:** Whole suite green, app verified in the dev server (modes + table render), then push the branch so Vercel builds a preview that proves the `/api` function bundles and the cache header is served.

**Files:** none (verification + git).

**Acceptance Criteria:**
- [ ] `npm test` all green; `npm run typecheck` clean; `npm run build:web` succeeds.
- [ ] Dev server: Lugnt/Hämta/Manuell toggle works; manual constant fills the table; editing a row marks it.
- [ ] Branch pushed; Vercel preview build succeeds (the `/api/weather` function bundles `@stp/core`).
- [ ] Preview: `GET /api/weather?date=...&pts=...` returns an `EnsembleField` and a response `Cache-Control: ...s-maxage=10800...`; a second identical request shows `x-vercel-cache: HIT`.

**Verify:** `npm test && npm run typecheck && npm run build:web` → all succeed; preview URL responds as above.

**Steps:**

- [ ] **Step 1: Full local gate**

Run: `npm test` → all green.
Run: `npm run typecheck` → clean.
Run: `npm run build:web` → builds `apps/web/dist` with no errors.

- [ ] **Step 2: Dev-server verification** (use the preview tooling, not manual asks)

Start the dev server (`npm run dev -w apps/web`), then verify: the three weather-mode buttons toggle; selecting Manuell shows "Applicera på alla timmar" and a populated table; editing a speed cell highlights the row. Capture a screenshot for the summary.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin worktree-weather-server-fetch
```

- [ ] **Step 4: Verify the Vercel preview**

After the push, Vercel auto-builds a preview (the project is git-linked). Confirm the build succeeded (function bundling proves the `@stp/core` import resolves under esbuild — see the spec's de-risk note). Then:

```bash
curl -sI "https://<preview-host>/api/weather?date=2026-06-13&pts=58.5,14.6|58.6,14.7" | grep -i -E 'cache-control|x-vercel-cache'
```

Expected: `Cache-Control: public, s-maxage=10800, stale-while-revalidate=86400`; a repeated call shows `x-vercel-cache: HIT`.

- [ ] **Step 5: Fallback only if the preview build fails on the core import**

If (and only if) the Vercel build fails resolving `@stp/core` (`.js`→`.ts`), add a minimal esbuild prebuild of core consumed by the function: add `"build:core": "esbuild packages/core/src/index.ts --bundle --platform=node --format=esm --outfile=packages/core/dist/index.js"` + `esbuild` devDep, point `api/weather.ts` + `api/handler.ts` imports at the built file via a tsconfig path or a `#core` import alias, and prepend `npm run build:core` to the Vercel `buildCommand` in `vercel.json`. Re-push. (Web + CLI stay on raw source.)

- [ ] **Step 6: Open the PR** (after the preview is green)

```bash
gh pr create --title "feat: server-side weather fetch + hour-by-hour wind editor" --body "$(cat <<'EOF'
## Summary
- Server `/api/weather` fetches Open-Meteo + SMHI + MET Norway, builds the ensemble, returns it with a free Vercel CDN `s-maxage` cache header (no API keys, no paid storage).
- Sampling now covers every 0.1° cell the route crosses (44 for Vättern) instead of a fixed 10.
- New hour-by-hour wind table: view, edit, reset, or enter wind manually (constant or per hour).
- Solve worker is now network-free; the field is built on the main thread and injected.

## Test plan
- `npm test` (core fetch/sample/hourly, api handler, web pipeline/components/App)
- `npm run typecheck`, `npm run build:web`
- Preview: `/api/weather` returns an ensemble + cache header; second call `x-vercel-cache: HIT`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

**Spec coverage:**
- Server-side fetch all 3 sources → Tasks 1, 4. ✓
- Free cache (CDN s-maxage) → Task 4 (`Cache-Control`), Task 8 (verify HIT). ✓
- Hour-by-hour view + edit → Tasks 3, 6, 7. ✓
- Manual wind (constant + table) → Tasks 3 (`buildManualField`), 6 (constant entry), 7 (wiring). ✓
- More sample points (per 0.1° cell) → Task 2. ✓
- Worker network-free / field injection → Task 5. ✓
- Privacy note → Task 7. ✓
- Build/deploy de-risk + fallback → Task 8 (preview build = real bundler gate; fallback documented). ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. ✓

**Type consistency:** `HourlyWind { hour, dir_from_deg, speed_ms }` used identically across Tasks 3/6/7. `EnsembleField`/`EnsembleCell` reuse core's exact shapes. `gatherWindSamples(points, date)` signature consistent across Tasks 1/4. `weatherMode: 'calm'|'fetched'|'manual'` + `field` consistent across Tasks 5/7. `FormSubmit`/`PipelineForm` consistent across Tasks 7. ✓
