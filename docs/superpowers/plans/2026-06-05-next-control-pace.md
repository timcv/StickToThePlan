# Next Control Pace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-plan-generated `PlanDelta` Connect IQ data field with one generic, install-once **Next Control Pace** field that reads the loaded course's control points live, and add a `course.fit` exporter so those control points populate reliably on the watch.

**Architecture:** StickToThePlan exports a FIT Course (`course.fit`) with one named `course_point` per control (`"Gränna 07:18"`). A static Monkey C data field (`ciq/source/NextControlPace.mc`, compiled once to a sideloadable `.prg`) reads `Activity.Info.nameOfNextPoint` / `distanceToNextPoint` each second, computes per-segment average speed, ETA, and a per-control `+/- min` versus the planned time parsed from the point name. The old per-plan code generator and its `SimpleDataField` are removed.

**Tech Stack:** TypeScript (pure `@stp/core` builders, `@garmin/fitsdk` Encoder/Decoder), Vitest (Node project, round-trip decode tests), React (web Downloads), Monkey C / Garmin Connect IQ (`monkeyc`, fenix7x), npm workspaces.

**Spec:** [docs/superpowers/specs/2026-06-05-next-control-pace-design.md](../specs/2026-06-05-next-control-pace-design.md)

---

### Task 1: `course.fit` exporter (pure core)

**Goal:** A pure `buildCourseFit` that encodes a FIT Course (track records + one named `course_point` per control), proven by a round-trip decode test.

**Files:**

- Create: `packages/core/src/output/fitCourse.ts`
- Modify: `packages/core/src/output/course.ts` (export the two nearest-\* helpers for reuse)
- Modify: `packages/core/src/index.ts:51-58` (add `buildCourseFit` export)
- Test: `packages/cli/tests/fitCourse.test.ts`

**Acceptance Criteria:**

- [ ] `buildCourseFit(micro, plan, cfg, controls)` returns `Uint8Array` bytes.
- [ ] Decoded file has `fileId.type === 'course'`, `course.name === 'Vatternrundan'`, `course.sport === 'cycling'`.
- [ ] One `coursePoint` per control, `name` equal to `` `${control.name} ${HH:MM}` `` (planned clock, no stop suffix).
- [ ] `record` count equals microsegment count; `record.distance` is monotonic non-decreasing.
- [ ] `coursePoint.positionLat/Long` round-trip to the control's nearest-micro lat/lon within 0.0002°.

**Verify:** `npm test -- fitCourse` → the `fitCourse` suite passes.

**Steps:**

- [ ] **Step 1: Export the nearest-\* helpers from `course.ts`**

In `packages/core/src/output/course.ts`, add `export` to the two existing private helpers so the FIT builder can reuse them (DRY). Change their signatures only by adding the keyword:

```ts
export function nearestMicroIndex(micros: MicroSegment[], targetM: number): number {
```

```ts
export function nearestEtaS(plan: PlanResult, targetM: number): number {
```

- [ ] **Step 2: Write the failing round-trip test**

Create `packages/cli/tests/fitCourse.test.ts` (lives in the cli `tests/` dir, the project's home for FIT decode round-trips, and matches the vitest `unit` include glob `packages/*/tests/**/*.test.ts`):

```ts
// Round-trip test for the FIT Course exporter (buildCourseFit).
// The decode is the source of truth: encode real bytes with the SDK Encoder,
// read them back with the Decoder, and assert the course points the watch
// will navigate by.
import { describe, it, expect } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import {
  buildCourseFit,
  applyDefaults,
  type Config,
  type MicroSegment,
  type PlanResult,
  type ControlPoint,
} from '@stp/core';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return applyDefaults({
    race_date: '2026-06-13',
    start_time: '04:22',
    gpx_path: 'route.gpx',
    ftp: 272,
    n_riders: 12,
    target_total_hm: '11:45',
    stops: [],
    ...overrides,
  });
}

// 11 microsegments over ~10 km along a meridian near Gränna, climbing then flat.
function makeMicro(): MicroSegment[] {
  const out: MicroSegment[] = [];
  for (let i = 0; i < 11; i++) {
    out.push({
      index: i,
      distance_m: 1000,
      cum_distance_m: i * 1000,
      grade: 0,
      bearing_deg: 0,
      lat: 58.0 + i * 0.009,
      lon: 14.5,
      ele_start_m: 100 + i,
      ele_end_m: 101 + i,
      neutral: false,
    });
  }
  return out;
}

// A plan whose segments carry eta_s at each micro end (linear: 120 s per km).
function makePlan(micro: MicroSegment[]): PlanResult {
  const segments = micro.map((m) => ({
    micro: m,
    v_ms: 8.33,
    speed_kmh: 30,
    p_pull_w: 200,
    p_draft_w: 140,
    p_mean_w: 165,
    rider_np_w: 165,
    time_s: 120,
    eta_s: (m.cum_distance_m / 1000) * 120,
    headwind_ms: 0,
    crosswind_ms: 0,
    rho: 1.2,
    cap_binding: 'none' as const,
  }));
  return {
    np_target_used: 165,
    rider_np_ride_w: 165,
    intensity_factor: 165 / 272,
    total_time_s: 1200,
    rolling_time_s: 1200,
    stop_time_s: 0,
    segments,
    stops: [],
    reachable: true,
    notes: [],
  };
}

// Two controls: Start at km 0, Gränna at km 10.
const CONTROLS: ControlPoint[] = [
  { name: 'Start', km: 0 },
  { name: 'Gränna', km: 10 },
];

function decode(bytes: Uint8Array) {
  const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  const { messages, errors } = decoder.read();
  expect(errors.length).toBe(0);
  return messages as Record<string, any[]>;
}

describe('buildCourseFit round-trip', () => {
  const micro = makeMicro();
  const bytes = buildCourseFit(micro, makePlan(micro), makeConfig(), CONTROLS);
  const m = decode(bytes);

  it('is a course file named Vatternrundan, cycling', () => {
    expect((m.fileIdMesgs ?? [])[0]?.type).toBe('course');
    expect((m.courseMesgs ?? [])[0]?.name).toBe('Vatternrundan');
    expect((m.courseMesgs ?? [])[0]?.sport).toBe('cycling');
  });

  it('writes one record per microsegment with monotonic distance', () => {
    const recs = m.recordMesgs ?? [];
    expect(recs).toHaveLength(micro.length);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i].distance).toBeGreaterThanOrEqual(recs[i - 1].distance);
    }
    // distance round-trips to metres (scale handled by the SDK profile).
    expect(Math.abs(recs[recs.length - 1].distance - 10000)).toBeLessThanOrEqual(1);
  });

  it('writes one named course point per control with the planned HH:MM', () => {
    const cps = m.coursePointMesgs ?? [];
    expect(cps).toHaveLength(2);
    // start_time 04:22 + eta 0 s -> 04:22 ; + eta 1200 s (20 min) -> 04:42
    const names = cps.map((c) => c.name);
    expect(names).toContain('Start 04:22');
    expect(names).toContain('Gränna 04:42');
  });

  it('positions the Gränna course point at its nearest-micro lat/lon', () => {
    const cps = m.coursePointMesgs ?? [];
    const granna = cps.find((c) => (c.name as string).startsWith('Gränna'));
    expect(granna).toBeDefined();
    const SEMI = 2147483648 / 180;
    const latDeg = (granna!.positionLat as number) / SEMI;
    const lonDeg = (granna!.positionLong as number) / SEMI;
    expect(Math.abs(latDeg - 58.09)).toBeLessThan(0.0002); // micro index 10
    expect(Math.abs(lonDeg - 14.5)).toBeLessThan(0.0002);
  });
});
```

- [ ] **Step 3: Run the test, watch it fail**

Run: `npm test -- fitCourse`
Expected: FAIL with `buildCourseFit` not exported / not a function.

- [ ] **Step 4: Implement `buildCourseFit`**

Create `packages/core/src/output/fitCourse.ts`:

```ts
// FIT Course writer: a route the watch can navigate, with one named course
// point per control. The Connect IQ data field reads nameOfNextPoint /
// distanceToNextPoint from these course points.
//
// Reuses the @garmin/fitsdk Encoder pattern from fitWorkout.ts. Positions are
// stored as semicircles (the SDK applies no position auto-scale); distance and
// altitude use their FIT profile scale, which the SDK encoder/decoder invert.
//
// Record/course-point timestamps are synthetic and monotonic in distance. The
// watch re-times when the course is ridden, so only their order matters; the
// planned clock the rider sees is baked into the course point NAME instead.

import { Encoder, Profile } from '@garmin/fitsdk';
import type { MicroSegment, PlanResult, Config } from '../types.js';
import type { ControlPoint } from '../segmentation.js';
import { secondsToClock, clockToSeconds } from '../util/time.js';
import { nearestMicroIndex, nearestEtaS } from './course.js';

type FitFieldValue = string | number | boolean | bigint | Date | Array<string | number>;
interface FitMesg {
  mesgNum: number;
  [field: string]: FitFieldValue | undefined;
}

function writeFitMesg(encoder: Encoder, mesg: FitMesg): void {
  encoder.writeMesg(mesg as unknown as Parameters<Encoder['writeMesg']>[0]);
}

/** 2^31 / 180: degrees -> FIT semicircles. */
const SEMICIRCLES_PER_DEGREE = 2147483648 / 180;
function toSemicircles(deg: number): number {
  return Math.round(deg * SEMICIRCLES_PER_DEGREE);
}

/**
 * Fixed nominal base date for synthetic record/course-point timestamps. Using a
 * constant (never new Date()) keeps the encoded bytes deterministic for tests.
 */
const BASE_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

/**
 * Encode a FIT Course from the route microsegments and the control points.
 * Mirrors buildCourseGpx's inputs so the cli can write both from one call site.
 */
export function buildCourseFit(
  microsegments: MicroSegment[],
  plan: PlanResult,
  cfg: Config,
  controls: ControlPoint[],
): Uint8Array {
  const encoder = new Encoder();
  const startSec = clockToSeconds(cfg.start_time);

  const last = microsegments[microsegments.length - 1];
  const totalDist = last.cum_distance_m;
  const totalTime = plan.total_time_s;

  // Synthetic monotonic timestamp for a point at cumulative distance distM.
  const tsAtDist = (distM: number): Date => {
    const frac = totalDist > 0 ? distM / totalDist : 0;
    return new Date(BASE_MS + Math.round(frac * totalTime) * 1000);
  };

  // file_id (course).
  writeFitMesg(encoder, {
    mesgNum: Profile.MesgNum.FILE_ID,
    type: 'course',
    manufacturer: 'development',
    product: 0,
    timeCreated: new Date(BASE_MS),
    serialNumber: 1234,
  });

  // course.
  writeFitMesg(encoder, {
    mesgNum: Profile.MesgNum.COURSE,
    name: 'Vatternrundan',
    sport: 'cycling',
  });

  // lap spanning the whole route.
  const first = microsegments[0];
  writeFitMesg(encoder, {
    mesgNum: Profile.MesgNum.LAP,
    timestamp: tsAtDist(totalDist),
    startTime: tsAtDist(0),
    startPositionLat: toSemicircles(first.lat),
    startPositionLong: toSemicircles(first.lon),
    endPositionLat: toSemicircles(last.lat),
    endPositionLong: toSemicircles(last.lon),
    totalElapsedTime: totalTime,
    totalTimerTime: totalTime,
    totalDistance: totalDist,
  });

  // timer start event.
  writeFitMesg(encoder, {
    mesgNum: Profile.MesgNum.EVENT,
    timestamp: tsAtDist(0),
    event: 'timer',
    eventType: 'start',
  });

  // records: the navigable track.
  for (const m of microsegments) {
    writeFitMesg(encoder, {
      mesgNum: Profile.MesgNum.RECORD,
      timestamp: tsAtDist(m.cum_distance_m),
      positionLat: toSemicircles(m.lat),
      positionLong: toSemicircles(m.lon),
      distance: m.cum_distance_m,
      altitude: m.ele_start_m,
    });
  }

  // course points: one per control, named "<control> HH:MM".
  for (const cp of controls) {
    const targetM = cp.km * 1000;
    const micro = microsegments[nearestMicroIndex(microsegments, targetM)];
    const clock = secondsToClock(nearestEtaS(plan, targetM), cfg.start_time);
    writeFitMesg(encoder, {
      mesgNum: Profile.MesgNum.COURSE_POINT,
      timestamp: tsAtDist(micro.cum_distance_m),
      positionLat: toSemicircles(micro.lat),
      positionLong: toSemicircles(micro.lon),
      distance: micro.cum_distance_m,
      name: `${cp.name} ${clock}`,
      type: 'generic',
    });
  }

  // timer stop event.
  writeFitMesg(encoder, {
    mesgNum: Profile.MesgNum.EVENT,
    timestamp: tsAtDist(totalDist),
    event: 'timer',
    eventType: 'stopAll',
  });

  return encoder.close();
}
```

- [ ] **Step 5: Export from the core barrel**

In `packages/core/src/index.ts`, add the export next to the other output builders (after the `buildCourseGpx` line, ~line 50):

```ts
export { buildCourseFit } from './output/fitCourse.js';
```

- [ ] **Step 6: Run the test, watch it pass**

Run: `npm test -- fitCourse`
Expected: PASS (4 tests). If `record.distance` comes back scaled by 100, the SDK is not auto-scaling that field, divide `cum_distance_m` accordingly in the encoder, the round-trip assertion is the gate.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck` → clean.

```bash
git add packages/core/src/output/fitCourse.ts packages/core/src/output/course.ts packages/core/src/index.ts packages/cli/tests/fitCourse.test.ts
git commit -m "feat(core): add FIT Course exporter with named course points"
```

---

### Task 2: Write `course.fit` from the CLI

**Goal:** The CLI writes `output/course.fit` alongside `course.gpx`, and the end-to-end test asserts it is a decodable course file.

**Files:**

- Modify: `packages/cli/src/fileIo.ts` (add `writeCourseFit`)
- Modify: `packages/cli/src/cli.ts:170-204` (write `course.fit`, add to artifacts)
- Modify: `packages/cli/tests/cli.test.ts:82-96` (expect six artifacts incl. `course.fit`)

**Acceptance Criteria:**

- [ ] `writeCourseFit(micro, plan, cfg, controls, outPath)` writes decodable FIT bytes.
- [ ] `runPlan` writes `output/course.fit` and lists it in `summary.artifacts` (now six).
- [ ] `cli.test.ts` asserts `course.fit` exists and decodes with `fileId.type === 'course'`.

**Verify:** `npm test -- cli.test` → the runPlan suite passes with six artifacts.

**Steps:**

- [ ] **Step 1: Add the `course.fit` assertion to the CLI test (failing)**

In `packages/cli/tests/cli.test.ts`, add the FIT decode import at the top with the other imports:

```ts
import { Decoder, Stream } from '@garmin/fitsdk';
```

Change the expected-artifacts list and count (lines ~86 and ~93) from five to six and add a decode check inside the first `it`:

```ts
// The six documented artifacts.
const expected = [
  'tempokort.md',
  'tempokort.html',
  'workout.fit',
  'course.gpx',
  'course.fit',
  'plan.json',
];
```

```ts
// The summary lists the six written paths.
expect(summary.artifacts).toHaveLength(6);
```

Add, after the plan.json assertions (before the em-dash check):

```ts
// course.fit decodes as a FIT Course.
const courseBytes = readFileSync(join(outDir, 'course.fit'));
const { messages, errors } = new Decoder(Stream.fromByteArray(Array.from(courseBytes))).read();
expect(errors.length).toBe(0);
expect((messages.fileIdMesgs ?? [])[0]?.type).toBe('course');
expect((messages.coursePointMesgs ?? []).length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npm test -- cli.test`
Expected: FAIL (`course.fit should exist` / length 5 != 6).

- [ ] **Step 3: Add `writeCourseFit` to `fileIo.ts`**

In `packages/cli/src/fileIo.ts`, add `buildCourseFit` to the `@stp/core` import block (next to `buildCourseGpx`), then add the writer after `writeCourseGpx`:

```ts
/**
 * Build the course FIT bytes and write them to outPath.
 */
export function writeCourseFit(
  microsegments: MicroSegment[],
  plan: PlanResult,
  cfg: Config,
  controls: ControlPoint[],
  outPath: string,
): void {
  const bytes = buildCourseFit(microsegments, plan, cfg, controls);
  writeFileSync(outPath, Buffer.from(bytes));
}
```

- [ ] **Step 4: Call it from `cli.ts`**

In `packages/cli/src/cli.ts`, add `writeCourseFit` to the `./fileIo.js` import block. Add the path next to the other artifact paths (~line 175):

```ts
const courseFitPath = join(outDir, 'course.fit');
```

Add the write next to `writeCourseGpx` (~line 181):

```ts
writeCourseFit(micro, scenarios.expected, cfg, controls, courseFitPath);
```

Add it to the artifacts array (~line 204):

```ts
const artifacts = [mdPath, htmlPath, fitPath, coursePath, courseFitPath, planPath];
```

- [ ] **Step 5: Run the test, watch it pass**

Run: `npm test -- cli.test`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck` → clean.

```bash
git add packages/cli/src/fileIo.ts packages/cli/src/cli.ts packages/cli/tests/cli.test.ts
git commit -m "feat(cli): write course.fit alongside course.gpx"
```

---

### Task 3: Web Downloads, swap the Garmin source button for `course.fit` + install card

**Goal:** The web app downloads `course.fit` and shows install instructions instead of emitting the per-plan `PlanDelta.mc` source.

**Files:**

- Modify: `apps/web/src/components/Downloads.tsx`

**Acceptance Criteria:**

- [ ] No import or call of `generatePlanDeltaSource`; `onPlanDelta` removed.
- [ ] A "Course för Garmin-klocka (course.fit)" button calls `buildCourseFit` and downloads `course.fit`.
- [ ] The Garmin group shows an install card pointing at the Next Control Pace field.
- [ ] `npm run typecheck` passes (web project included).

**Verify:** `npm run typecheck` → clean, and `npm test -- web` → existing web suites still pass.

**Steps:**

- [ ] **Step 1: Update imports**

In `apps/web/src/components/Downloads.tsx`, replace `generatePlanDeltaSource` with `buildCourseFit` in the `@stp/core` import block:

```ts
import {
  buildCourseGpx,
  buildCourseFit,
  buildPlanJson,
  buildStyrkortHtml,
  encodeWorkout,
  type PlanJsonMeta,
} from '@stp/core';
```

- [ ] **Step 2: Replace the handler**

Remove `onPlanDelta` (the `generatePlanDeltaSource` call) and add a course.fit handler next to `onCourse`:

```ts
const onCourseFit = () => {
  const bytes = buildCourseFit(micro, scenarios.expected, cfg, controls);
  downloadBlob('course.fit', bytes, 'application/octet-stream');
};
```

- [ ] **Step 3: Replace the Garmin download group markup**

Swap the existing `Garmin-klocka` group for the course.fit button plus an install card:

```tsx
<div className="download-group">
  <h3>Garmin-klocka (Next Control Pace)</h3>
  <div className="download-row">
    <button type="button" className="download-btn" onClick={onCourseFit}>
      <span className="download-title">Course för klockan</span>
      <span className="download-desc">Rutt med kontroller som course points (course.fit)</span>
    </button>
  </div>
  <ol className="install-steps">
    <li>
      Ladda ner <code>course.fit</code> och lägg in den som en bana på din Fenix 7X.
    </li>
    <li>
      Installera datafältet <strong>Next Control Pace</strong> (sideload av <code>.prg</code>).
    </li>
    <li>Lägg till fältet i cykelprofilens dataskärmar (Connect IQ-fält).</li>
    <li>Starta bannavigeringen innan du börjar cykla.</li>
  </ol>
</div>
```

- [ ] **Step 4: Update the file header comment**

Replace the `PlanDelta.mc` bullet in the top doc comment with:

```ts
 *   course.fit    FIT Course with named control points (buildCourseFit) for the
 *                 Next Control Pace watch field.
```

Also remove the trailing `.prg` note paragraph at the bottom of the component (the `<p className="note">…monkeyc…</p>`), it described the old per-plan compile.

- [ ] **Step 5: Verify**

Run: `npm run typecheck` → clean.
Run: `npm test -- web` → existing suites pass (there is no Downloads test to update).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/Downloads.tsx
git commit -m "feat(web): download course.fit and show Next Control Pace install steps"
```

---

### Task 4: Static Next Control Pace data field + `build:ciq`

**Goal:** A committed, generic Monkey C data field and a `npm run build:ciq` that compiles it to a sideloadable `.prg`.

**Files:**

- Create: `ciq/source/NextControlPace.mc`
- Delete: `ciq/source/PlanDelta.mc` (stray generated file), `ciq/source/.gitkeep`
- Create: `ciq/resources/settings/settings.xml`, `ciq/resources/settings/properties.xml`
- Modify: `ciq/manifest.xml`, `ciq/monkey.jungle`, `ciq/resources/strings/strings.xml`
- Modify: `.gitignore:30-32` (track the static `.mc` source)
- Create: `packages/cli/src/buildCiq.ts`
- Modify: `package.json:10-21` (add `build:ciq` script)

**Acceptance Criteria:**

- [ ] `ciq/source/NextControlPace.mc` is a custom `WatchUi.DataField` with segment detection, smoothed ETA, per-control delta, four layout modes, a passed screen, and null fallbacks.
- [ ] Settings expose `layoutMode`, `units`, `showPlanDelta`.
- [ ] `.gitignore` no longer ignores `ciq/source/*.mc`.
- [ ] `npm run build:ciq` compiles to `output/NextControlPace.prg` when the Connect IQ SDK is installed; when `monkeyc` is absent it prints a clear message and exits 0.

**Verify:** `npm run build:ciq` → either `compiled output/NextControlPace.prg` or `Connect IQ SDK (monkeyc) not found; skipping` (exit 0). `npm run typecheck` → clean.

**Steps:**

- [ ] **Step 1: Stop ignoring the static Monkey C source**

In `.gitignore`, replace the three lines:

```
# generated Monkey C source (regenerated per run; keep the directory)
ciq/source/*.mc
!ciq/source/.gitkeep
```

with:

```
# Connect IQ data field source is now static and committed (ciq/source/*.mc)
```

- [ ] **Step 2: Remove the old source files**

```bash
rm -f ciq/source/PlanDelta.mc ciq/source/.gitkeep
```

- [ ] **Step 3: Write the data field**

Create `ciq/source/NextControlPace.mc`:

```monkeyc
//
// Next Control Pace: a generic, install-once Connect IQ data field. It reads
// the loaded course's control points live and shows, per segment between
// controls: next control, distance remaining, segment average speed, ETA, and
// +/- minutes versus the planned time parsed from the course-point name.
//
// Nothing about a specific plan is baked in; the plan reaches the watch through
// the course (course.fit) the rider loads.
//

import Toybox.Application;
import Toybox.Activity;
import Toybox.Lang;
import Toybox.Graphics;
import Toybox.System;
import Toybox.WatchUi;

class NextControlPaceView extends WatchUi.DataField {

    // Settings (re-read each compute()).
    private var mLayoutMode as Number = 0;   // 0 standard, 1 compact, 2 speed+dist, 3 eta-only
    private var mUnits as Number = 0;         // 0 km/h, 1 mph
    private var mShowDelta as Boolean = true;

    // Segment state.
    private var mLastNextName as String? = null;
    private var mSegStartDist as Float = 0.0;
    private var mSegStartTimer as Number = 0; // ms
    private var mSegIndex as Number = 0;
    private var mLastDistToNext as Float = -1.0;
    private var mLockoutUntil as Number = 0;  // ms
    private var mShowPassedUntil as Number = 0; // ms
    private var mPassedName as String? = null;
    private var mSmoothedSpeed as Float = 0.0; // m/s
    private var mNowTimer as Number = 0;       // ms, last seen timerTime

    // Computed display values.
    private var mNextName as String? = null;
    private var mDistToNext as Float? = null;  // m
    private var mAvgSpeed as Float? = null;    // m/s (smoothed)
    private var mEtaClockSec as Number? = null;
    private var mDeltaMin as Number? = null;
    private var mStatus as String? = null;

    private const MIN_DIST = 500.0; // m
    private const MIN_TIME = 60;    // s
    private const LOCKOUT_MS = 8000;
    private const PASSED_MS = 6000;

    public function initialize() {
        DataField.initialize();
    }

    private function loadSettings() as Void {
        var app = Application.getApp();
        var lm = app.getProperty("layoutMode");
        if (lm != null) { mLayoutMode = lm as Number; }
        var u = app.getProperty("units");
        if (u != null) { mUnits = u as Number; }
        var sd = app.getProperty("showPlanDelta");
        if (sd != null) { mShowDelta = sd as Boolean; }
    }

    private function startSegment(name as String?, dist as Float, timer as Number) as Void {
        mLastNextName = name;
        mSegStartDist = dist;
        mSegStartTimer = timer;
        mSegIndex = mSegIndex + 1;
        mSmoothedSpeed = 0.0;
    }

    private function segmentChanged(name as String?, distToNext as Float?, nowTimer as Number) as Boolean {
        if (nowTimer < mLockoutUntil) { return false; }
        if (name != null && mLastNextName != null && !name.equals(mLastNextName)) { return true; }
        if (mLastDistToNext >= 0.0 && distToNext != null) {
            var d = distToNext as Float;
            if (mLastDistToNext < 50.0 && d > 500.0) { return true; }
            if (mLastDistToNext < 150.0 && (d - mLastDistToNext) > 1000.0) { return true; }
        }
        return false;
    }

    private function isDigit(c as Char) as Boolean {
        var v = c.toNumber();
        return v >= 48 && v <= 57;
    }

    private function digit(c as Char) as Number {
        return c.toNumber() - 48;
    }

    // First HH:MM (or H:MM) in the string -> seconds since midnight, else null.
    private function parsePlannedSec(name as String) as Number? {
        var chars = name.toCharArray();
        var n = chars.size();
        for (var i = 0; i < n; i++) {
            if (chars[i] == ':' && i + 2 < n && isDigit(chars[i + 1]) && isDigit(chars[i + 2])) {
                if (i - 1 < 0 || !isDigit(chars[i - 1])) { continue; }
                var hh = digit(chars[i - 1]);
                if (i - 2 >= 0 && isDigit(chars[i - 2])) {
                    hh = digit(chars[i - 2]) * 10 + hh;
                }
                var mm = digit(chars[i + 1]) * 10 + digit(chars[i + 2]);
                if (hh < 24 && mm < 60) { return hh * 3600 + mm * 60; }
            }
        }
        return null;
    }

    public function compute(info as Activity.Info) as Void {
        loadSettings();
        mStatus = null;

        var name = (info has :nameOfNextPoint) ? info.nameOfNextPoint : null;
        var distToNext = (info has :distanceToNextPoint) ? info.distanceToNextPoint : null;
        var elapsedDist = (info has :elapsedDistance) ? info.elapsedDistance : null;
        var timer = (info has :timerTime) ? info.timerTime : null;
        var curSpeed = (info has :currentSpeed) ? info.currentSpeed : null;

        if (name == null && distToNext == null) {
            mStatus = "Ingen bana";
            mNextName = null; mDistToNext = null; mAvgSpeed = null;
            mEtaClockSec = null; mDeltaMin = null;
            return;
        }
        if (elapsedDist == null || timer == null) {
            mStatus = "Väntar på navigation";
            return;
        }

        mNowTimer = timer as Number;
        var ed = elapsedDist as Float;

        if (mSegIndex == 0) {
            startSegment(name, ed, mNowTimer);
        }

        if (segmentChanged(name, distToNext, mNowTimer)) {
            mPassedName = mLastNextName;
            mShowPassedUntil = mNowTimer + PASSED_MS;
            startSegment(name, ed, mNowTimer);
            mLockoutUntil = mNowTimer + LOCKOUT_MS;
        }

        mLastNextName = name;
        if (distToNext != null) { mLastDistToNext = distToNext as Float; }

        mNextName = name;
        mDistToNext = (distToNext != null) ? distToNext as Float : null;

        var distDone = ed - mSegStartDist;
        var timeDone = (mNowTimer - mSegStartTimer) / 1000.0;
        if (distDone < MIN_DIST || timeDone < MIN_TIME) {
            mStatus = "Bygger snitt...";
            mAvgSpeed = null; mEtaClockSec = null; mDeltaMin = null;
            return;
        }

        var avg = distDone / timeDone;
        if (mSmoothedSpeed <= 0.0) { mSmoothedSpeed = avg; }
        else { mSmoothedSpeed = 0.9 * mSmoothedSpeed + 0.1 * avg; }
        mAvgSpeed = mSmoothedSpeed;

        var speedForEta = mSmoothedSpeed;
        if (speedForEta <= 0.0 && curSpeed != null) { speedForEta = curSpeed as Float; }

        if (mDistToNext != null && speedForEta > 0.0) {
            var etaSec = (mDistToNext as Float) / speedForEta;
            var clk = System.getClockTime();
            var nowSec = clk.hour * 3600 + clk.min * 60 + clk.sec;
            mEtaClockSec = (nowSec + etaSec.toNumber()) % 86400;

            if (mShowDelta && name != null) {
                var planned = parsePlannedSec(name);
                if (planned != null) {
                    var d = mEtaClockSec - (planned as Number);
                    if (d > 43200) { d -= 86400; }
                    if (d < -43200) { d += 86400; }
                    mDeltaMin = (d / 60.0).toNumber();
                } else {
                    mDeltaMin = null;
                }
            } else {
                mDeltaMin = null;
            }
        } else {
            mEtaClockSec = null;
            mDeltaMin = null;
        }
    }

    // ----- formatting helpers -----

    private function fmtKm(distM as Float?) as String {
        if (distM == null) { return "-- km"; }
        var km = (distM as Float) / 1000.0;
        return km.format("%.1f") + " km";
    }

    private function speedVal(ms as Float?) as Float {
        if (ms == null) { return 0.0; }
        return (mUnits == 1) ? (ms as Float) * 2.2369363 : (ms as Float) * 3.6;
    }

    private function speedUnit() as String {
        return (mUnits == 1) ? "mph" : "km/h";
    }

    private function fmtSpeed(ms as Float?) as String {
        if (ms == null) { return "--"; }
        return speedVal(ms).format("%.1f");
    }

    private function fmtClock(sec as Number?) as String {
        if (sec == null) { return "--:--"; }
        var s = sec as Number;
        return (s / 3600).format("%02d") + ":" + ((s % 3600) / 60).format("%02d");
    }

    private function fmtDelta(min as Number?) as String {
        if (min == null) { return ""; }
        var m = min as Number;
        var sign = (m < 0) ? "-" : "+";
        var a = (m < 0) ? -m : m;
        return sign + a.format("%02d");
    }

    private function deltaColor(min as Number?, fg as Number) as Number {
        if (min == null) { return fg; }
        var a = (min as Number);
        if (a < 0) { a = -a; }
        if (a <= 2) { return Graphics.COLOR_GREEN; }
        if (a <= 10) { return Graphics.COLOR_YELLOW; }
        return Graphics.COLOR_RED;
    }

    private function nameUpper() as String {
        return (mNextName != null) ? (mNextName as String).toUpper() : "?";
    }

    // Draw an evenly spaced vertical stack of [text, font, color] rows.
    private function drawStack(dc as Dc, rows as Array) as Void {
        var cx = dc.getWidth() / 2;
        var step = dc.getHeight() / (rows.size() + 1);
        for (var i = 0; i < rows.size(); i++) {
            var r = rows[i] as Array;
            dc.setColor(r[2] as Number, Graphics.COLOR_TRANSPARENT);
            dc.drawText(
                cx, step * (i + 1), r[1] as Graphics.FontDefinition, r[0] as String,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    public function onUpdate(dc as Dc) as Void {
        var bg = getBackgroundColor();
        var fg = (bg == Graphics.COLOR_BLACK) ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
        dc.setColor(bg, bg);
        dc.clear();

        var nm = Graphics.FONT_NUMBER_MEDIUM;
        var med = Graphics.FONT_MEDIUM;
        var tiny = Graphics.FONT_TINY;

        // Passed confirmation takes over briefly after a segment switch.
        if (mNowTimer < mShowPassedUntil) {
            var passedFrom = (mPassedName != null) ? (mPassedName as String).toUpper() : "";
            var nextTo = (mNextName != null) ? (mNextName as String).toUpper() : "";
            drawStack(dc, [
                ["OK", med, Graphics.COLOR_GREEN],
                [passedFrom, tiny, fg],
                ["Passerad!", med, fg],
                ["Nästa: " + nextTo, tiny, fg]]);
            return;
        }

        // Status / fallback states.
        if (mStatus != null) {
            if ((mStatus as String).equals("Bygger snitt...")) {
                drawStack(dc, [[nameUpper(), tiny, fg], [fmtKm(mDistToNext), nm, fg], [mStatus as String, tiny, fg]]);
            } else if ((mStatus as String).equals("Ingen bana")) {
                drawStack(dc, [[mStatus as String, med, fg], ["Starta navigation", tiny, fg]]);
            } else {
                drawStack(dc, [[mStatus as String, med, fg]]);
            }
            return;
        }

        var dCol = deltaColor(mDeltaMin, fg);
        var spd = fmtSpeed(mAvgSpeed) + " " + speedUnit();

        if (mLayoutMode == 1) {
            // Compact.
            drawStack(dc, [
                [nameUpper(), tiny, fg],
                [fmtKm(mDistToNext), nm, fg],
                [fmtSpeed(mAvgSpeed), med, fg],
                [fmtDelta(mDeltaMin), med, dCol]]);
        } else if (mLayoutMode == 2) {
            // Speed + distance.
            drawStack(dc, [
                ["SNITTFART", tiny, fg],
                [spd, nm, fg],
                [fmtKm(mDistToNext), med, fg],
                ["till " + nameUpper(), tiny, fg]]);
        } else if (mLayoutMode == 3) {
            // ETA only.
            drawStack(dc, [
                ["ETA", tiny, fg],
                [fmtClock(mEtaClockSec), nm, fg],
                [fmtDelta(mDeltaMin) + " min", med, dCol],
                ["till " + nameUpper(), tiny, fg]]);
        } else {
            // Standard.
            drawStack(dc, [
                [nameUpper(), tiny, fg],
                [fmtKm(mDistToNext), nm, fg],
                [spd, med, fg],
                ["ETA " + fmtClock(mEtaClockSec), tiny, fg],
                [fmtDelta(mDeltaMin) + " min", tiny, dCol]]);
        }
    }
}

class NextControlPaceApp extends Application.AppBase {

    public function initialize() {
        AppBase.initialize();
    }

    public function onStart(state as Dictionary?) as Void {
    }

    public function onStop(state as Dictionary?) as Void {
    }

    public function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        return [new $.NextControlPaceView()];
    }
}
```

- [ ] **Step 4: Settings + properties resources**

Create `ciq/resources/settings/properties.xml`:

```xml
<properties>
    <property id="layoutMode" type="number">0</property>
    <property id="units" type="number">0</property>
    <property id="showPlanDelta" type="boolean">true</property>
</properties>
```

Create `ciq/resources/settings/settings.xml`:

```xml
<settings>
    <setting propertyKey="@Properties.layoutMode" title="@Strings.SettingLayout">
        <settingConfig type="list">
            <listEntry value="0">@Strings.LayoutStandard</listEntry>
            <listEntry value="1">@Strings.LayoutCompact</listEntry>
            <listEntry value="2">@Strings.LayoutSpeedDist</listEntry>
            <listEntry value="3">@Strings.LayoutEtaOnly</listEntry>
        </settingConfig>
    </setting>
    <setting propertyKey="@Properties.units" title="@Strings.SettingUnits">
        <settingConfig type="list">
            <listEntry value="0">@Strings.UnitKmh</listEntry>
            <listEntry value="1">@Strings.UnitMph</listEntry>
        </settingConfig>
    </setting>
    <setting propertyKey="@Properties.showPlanDelta" title="@Strings.SettingShowDelta">
        <settingConfig type="boolean" />
    </setting>
</settings>
```

- [ ] **Step 5: Strings**

Replace `ciq/resources/strings/strings.xml` with:

```xml
<resources xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://developer.garmin.com/downloads/connect-iq/resources.xsd">
    <string id="AppName">Next Control Pace</string>
    <string id="SettingLayout">Layout</string>
    <string id="LayoutStandard">Standard</string>
    <string id="LayoutCompact">Kompakt</string>
    <string id="LayoutSpeedDist">Fart och distans</string>
    <string id="LayoutEtaOnly">Endast ETA</string>
    <string id="SettingUnits">Enhet</string>
    <string id="UnitKmh">km/h</string>
    <string id="UnitMph">mph</string>
    <string id="SettingShowDelta">Visa planavvikelse</string>
</resources>
```

- [ ] **Step 6: Manifest + jungle**

In `ciq/manifest.xml`, change the application `entry` and bump the API level (keep the existing `id` UUID):

```xml
    <iq:application entry="NextControlPaceApp" id="987f439dda8dd5437983973214dfa058" launcherIcon="@Drawables.LauncherIcon" minApiLevel="3.1.0" name="@Strings.AppName" type="datafield">
```

In `ciq/monkey.jungle`, replace the generated-source comment with a static one:

```
# Connect IQ build configuration for the Next Control Pace data field.
# The source is a static, committed file in ciq/source; the field is generic
# and reads course points live, so it is built once and sideloaded.
project.manifest = manifest.xml
base.sourcePath = source
base.resourcePath = resources
```

- [ ] **Step 7: Build script**

Create `packages/cli/src/buildCiq.ts`:

```ts
/**
 * Compile the static Next Control Pace data field to a sideloadable .prg.
 *
 * Generic field, no per-plan generation: this just ensures a developer key and
 * runs monkeyc against the static jungle for fenix7x. If the Connect IQ SDK is
 * not installed the script reports it and exits 0 (nothing to fail in CI).
 */
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

function projectRoot(): string {
  // packages/cli/src/buildCiq.ts -> ../../.. is the repo root.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

const ROOT = projectRoot();
const CIQ_DIR = join(ROOT, 'ciq');
const JUNGLE = join(CIQ_DIR, 'monkey.jungle');
const DEV_KEY = join(CIQ_DIR, 'developer_key.der');
const OUT_DIR = join(ROOT, 'output');
const OUT_PRG = join(OUT_DIR, 'NextControlPace.prg');
const DEVICE = 'fenix7x';

function ensureDeveloperKey(): void {
  if (existsSync(DEV_KEY)) {
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'ciq-key-'));
  const pem = join(tmp, 'k.pem');
  execFileSync('openssl', ['genrsa', '-out', pem, '4096'], { stdio: 'pipe' });
  execFileSync(
    'openssl',
    [
      'pkcs8',
      '-topk8',
      '-inform',
      'PEM',
      '-outform',
      'DER',
      '-in',
      pem,
      '-out',
      DEV_KEY,
      '-nocrypt',
    ],
    { stdio: 'pipe' },
  );
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  try {
    ensureDeveloperKey();
  } catch (err) {
    console.error(`Could not create a developer key (need openssl): ${String(err)}`);
    process.exit(1);
  }
  try {
    execFileSync('monkeyc', ['-f', JUNGLE, '-d', DEVICE, '-o', OUT_PRG, '-y', DEV_KEY], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    console.log(`Compiled ${OUT_PRG}`);
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === 'ENOENT') {
      console.log('Connect IQ SDK (monkeyc) not found; skipping .prg build.');
      process.exit(0);
    }
    console.error('monkeyc failed to compile the data field.');
    process.exit(1);
  }
}

main();
```

Add the script to the root `package.json` `scripts` block:

```json
    "build:ciq": "tsx packages/cli/src/buildCiq.ts",
```

- [ ] **Step 8: Build, typecheck, and self-review against the §16 checklist**

Run: `npm run build:ciq`
Expected: `Compiled output/NextControlPace.prg` (SDK present) OR `Connect IQ SDK (monkeyc) not found; skipping .prg build.` (exit 0).
Run: `npm run typecheck` → clean.

Manual self-review of the field against the spec §16 table (no automated harness for Monkey C): segment switches on name change, near-zero-then-jump, and big-increase; lockout blocks a double switch; `Bygger snitt...` before the gate; `Ingen bana` / `Väntar på navigation` fallbacks; segment state resets via `mSegIndex == 0` on a fresh activity.

- [ ] **Step 9: Commit**

```bash
git add ciq packages/cli/src/buildCiq.ts package.json .gitignore
git commit -m "feat(ciq): static Next Control Pace data field and build:ciq"
```

---

### Task 5: Retire the per-plan PlanDelta generator

**Goal:** Delete the old generator, template, its test, and all references, keeping the build green.

**Files:**

- Delete: `packages/core/src/ciq/generate.ts`, `packages/core/src/ciq/template.ts`, `packages/core/src/ciq/PlanDelta.mc.tmpl`, `packages/core/tests/ciq.test.ts`, `packages/cli/src/ciqCompile.ts`
- Modify: `packages/core/src/index.ts:79` (remove the generate export)
- Modify: `packages/cli/src/cli.ts` (remove `generateCiq` import, `noCiqCompile`, `RunSummary.ciq`, the ciq try/catch block)
- Modify: `packages/cli/tests/cli.test.ts:83,120` (drop `noCiqCompile: true`)

**Acceptance Criteria:**

- [ ] No source file references `PlanDelta`, `generatePlanDeltaSource`, `buildLookupTable`, `generateCiq`, or `noCiqCompile`.
- [ ] `RunSummary` no longer has a `ciq` field; `runPlan` no longer attempts a per-plan compile.
- [ ] Full suite and typecheck pass.

**Verify:** `npm test && npm run typecheck` → all green; `grep -rn -e PlanDelta -e generatePlanDeltaSource -e generateCiq -e noCiqCompile packages apps` → no hits in source.

**Steps:**

- [ ] **Step 1: Delete the generator, template, and tests**

```bash
git rm packages/core/src/ciq/generate.ts packages/core/src/ciq/template.ts packages/core/src/ciq/PlanDelta.mc.tmpl packages/core/tests/ciq.test.ts packages/cli/src/ciqCompile.ts
```

- [ ] **Step 2: Remove the core export**

In `packages/core/src/index.ts`, delete line 79:

```ts
export { buildLookupTable, generatePlanDeltaSource, type LookupEntry } from './ciq/generate.js';
```

(and its `// Connect IQ data-field source generation (pure).` comment above it).

- [ ] **Step 3: Strip the ciq plumbing from `cli.ts`**

Remove the import:

```ts
import { generateCiq } from './ciqCompile.js';
```

Remove the `noCiqCompile?` field from `RunOptions` (lines ~58-60, keep the rest of the interface):

```ts
  /** Skip the best-effort monkeyc compile of the Connect IQ data field. */
  noCiqCompile?: boolean;
```

Remove the `ciq` field from `RunSummary` (lines ~68-70):

```ts
/** Connect IQ data field generation result (spec 12.5). */
ciq: {
  compiled: boolean;
  message: string;
}
```

Remove the entire `// 8b. Connect IQ ...` try/catch block (lines ~184-201) and drop `ciq` from the `summary` object literal (so it ends at `expectedTotalS`).

- [ ] **Step 4: Drop `noCiqCompile` from the CLI test**

In `packages/cli/tests/cli.test.ts`, change the two `runPlan` calls (lines ~83 and ~120):

```ts
const summary = await runPlan({ offline: true, outDir, configPath });
```

```ts
await runPlan({ offline: true, outDir, configPath });
```

- [ ] **Step 5: Verify the build is green and clean**

Run: `npm test` → all suites pass (no `ciq.test.ts`, course tests pass).
Run: `npm run typecheck` → clean.
Run: `grep -rn -e PlanDelta -e generatePlanDeltaSource -e generateCiq -e noCiqCompile packages apps` → no source hits.

- [ ] **Step 6: Commit**

```bash
git add -A packages
git commit -m "refactor: retire per-plan PlanDelta generator in favor of generic field"
```

---

### Task 6: Docs, install guide and references

**Goal:** A short install guide for the field and updated mentions of the old per-plan source across the docs.

**Files:**

- Create: `docs/garmin-next-control-pace.md`
- Modify: `README.md:18,22`
- Modify: `docs/UX_REVIEW_BRIEF.md:54`, `docs/build-report.md:13`

**Acceptance Criteria:**

- [ ] `docs/garmin-next-control-pace.md` covers: download `course.fit`, build/sideload the `.prg` (`npm run build:ciq`), add the field to the cycling activity, start navigation.
- [ ] No doc claims the watch field is a per-plan `PlanDelta.mc` source compiled by the CLI.
- [ ] `npm run format:check` passes (or `npm run format` applied).

**Verify:** `grep -rn PlanDelta README.md docs/UX_REVIEW_BRIEF.md docs/build-report.md` → no stale hits; `npm run format:check` → clean.

**Steps:**

- [ ] **Step 1: Write the install guide**

Create `docs/garmin-next-control-pace.md`:

````markdown
# Next Control Pace (Garmin Fenix 7X)

A generic Connect IQ data field that shows, between each control: the next
control, distance remaining, segment average speed, ETA, and how many minutes
ahead of or behind plan you are. Install it once and add it to your cycling
activity; it reads whatever StickToThePlan course you load.

## 1. Get the course onto the watch

1. In the web app, download **`course.fit`** (Garmin-klocka section).
2. Copy it to `GARMIN/Courses` on the watch (USB), or import it in Garmin
   Connect and sync. The control points carry their planned time in the name,
   for example `Gränna 07:18`.

## 2. Install the data field

The field ships as a sideloadable `.prg`:

```bash
npm run build:ciq      # needs the Garmin Connect IQ SDK (monkeyc) installed
```
````

Copy `output/NextControlPace.prg` to `GARMIN/Apps` on the watch.

## 3. Add it to your activity

On the watch: cycling profile -> Data Screens -> Add New -> Connect IQ Fields
-> **Next Control Pace** (best as a single full-screen field).

## 4. Ride

Start the course navigation before you start riding. The field starts a new
segment each time you pass a control and shows pace and ETA to the next one.

## Settings

In Connect IQ (Garmin Connect Mobile): layout (Standard / Compact / Fart och
distans / Endast ETA), unit (km/h or mph), and whether to show plan deviation.

Publishing to the Connect IQ Store is tracked in [roadmap.md](roadmap.md).

```

- [ ] **Step 2: Update README**

In `README.md`, change the `ciq/` row (line 22) and the `packages/core` builder mention (line 18) so they describe a static, generic field and a FIT/GPX course export:

```

| `ciq/` | Garmin Connect IQ data field (Next Control Pace): a static, generic field compiled once with `npm run build:ciq`. |

```

For line 18, change `Connect IQ builders` to `Connect IQ course export`:

```

... and the FIT/GPX/JSON builders (incl. the `course.fit` course export). ...

```

- [ ] **Step 3: Update the other docs**

In `docs/UX_REVIEW_BRIEF.md:54`, change the Downloads description: the Garmin item is now `course.fit` (course for the Next Control Pace field), not `PlanDelta.mc`.

In `docs/build-report.md:13`, replace the `PlanDelta.mc` bullet with:

```

- `course.fit` (FIT Course with named control points for the Next Control Pace watch field)

````

- [ ] **Step 4: Format and verify**

Run: `npm run format`
Run: `grep -rn PlanDelta README.md docs/UX_REVIEW_BRIEF.md docs/build-report.md` → no hits.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/garmin-next-control-pace.md docs/UX_REVIEW_BRIEF.md docs/build-report.md
git commit -m "docs: Next Control Pace install guide and reference updates"
````

---

## Self-Review

**Spec coverage:** course.fit exporter (Task 1), CLI write (Task 2), web download + install (Task 3), generic field with 4 layouts + passed + fallbacks + settings (Task 4), retire PlanDelta (Task 5), docs (Task 6). The plan-delta semantics (per-control, color thresholds), smoothing (0.9/0.1), and segment detection (signals A/B/C + 8 s lockout + 500 m/60 s gate) are all in Task 4's `compute`. Deferred items (FIT logging, history, manual correction, vibration, Store, multi-device) remain in roadmap.md, not in this plan.

**Type consistency:** `buildCourseFit(microsegments, plan, cfg, controls)` is identical across core (Task 1), fileIo `writeCourseFit` (Task 2), and web (Task 3). Decoded message keys (`fileIdMesgs`, `courseMesgs`, `recordMesgs`, `coursePointMesgs`) and field names (`type`, `name`, `sport`, `distance`, `positionLat/Long`) match the `@garmin/fitsdk` round-trip pattern proven in `fitWorkout.test.ts`. Settings keys (`layoutMode`, `units`, `showPlanDelta`) match between `properties.xml`, `settings.xml`, and the field's `loadSettings`.

**Build-green ordering:** Tasks 1-4 are additive or self-contained; Task 5 removes the old generator only after all consumers (Tasks 2, 3) migrated and the new build path (Task 4) exists.
