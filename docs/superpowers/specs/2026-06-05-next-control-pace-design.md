# Next Control Pace: generic Garmin Connect IQ data field

Date: 2026-06-05
Status: approved design, ready for implementation planning

## Summary

Replace the per-plan-generated `PlanDelta` data field with one **generic, install-once**
Connect IQ data field, **Next Control Pace** (NCP). It reads the loaded course's control
points live (`nameOfNextPoint` / `distanceToNextPoint`) and computes, per segment between
controls: next control name, distance remaining, segment average speed, ETA to the next
control, and `+/- min` versus that control's planned arrival time.

Because nothing is baked into the watch source, you install it **once**, add it to your
cycling activity's data screens, and it works for every StickToThePlan plan. To make the
live field reliable, StickToThePlan gains a `course.fit` exporter (a FIT Course with named
course points); the existing `course.gpx` stays for map preview and non-Garmin head units.

## Decisions (locked)

1. **One generic field, retire PlanDelta.** PlanDelta's vs-plan delta is folded into NCP
   as a per-control `+/- min` line. Per-plan generation is removed.
2. **Scope:** core (next control, km left, segment avg speed, ETA) + per-control plan delta
   with color + ETA smoothing + user-selectable layout modes + waypoint-passed screen +
   robust fallbacks. Deferred to [docs/roadmap.md](../../roadmap.md): FIT developer-field
   logging, post-waypoint history, manual segment correction, vibration/alerts.
3. **Course delivery:** add `course.fit` (FIT Course with `course_point` messages), keep
   `course.gpx`.
4. **Packaging:** sideloadable `.prg` with a minimal manifest, single device target
   `fenix7x`. Web app drops the per-plan `PlanDelta.mc` button, exports `course.fit` /
   `course.gpx`, and shows install steps. Connect IQ Store publishing → roadmap.
5. **Plan delta:** per-control only. `delta = projected ETA clock − the next control's
planned HH:MM`. Color: ≤2 min green, ≤10 min yellow, >10 min red. No global
   projected-finish (it would require plan data on the watch and break install-once).
6. **Device target:** `fenix7x` only; multi-device → roadmap.
7. **Units:** km/h default, mph optional via settings.

## Architecture

```
StickToThePlan plan
   │  buildCourseFit(micro, plan, cfg, controls)
   ▼
course.fit  ── track records + named course_point per control ("Gränna 07:18")
   │  sideload course to Fenix 7X, start course navigation
   ▼
Activity.Info  ── nameOfNextPoint / distanceToNextPoint / elapsedDistance / timerTime
   │  live, once per second
   ▼
Next Control Pace data field  ── segment avg speed, ETA, per-control delta, layouts
```

`ciq/` changes from a per-plan code generator to a **static** Connect IQ project. The field
source is committed at `ciq/source/NextControlPace.mc` and compiled once into a `.prg`.

## Component 1: `course.fit` exporter (TypeScript, pure)

New module `packages/core/src/output/fitCourse.ts`, exported from
`packages/core/src/index.ts`:

```
buildCourseFit(micro: MicroSegment[], plan: PlanResult, cfg: Config, controls: ControlPoint[]): Uint8Array
```

Reuses the `@garmin/fitsdk` `Encoder` + `writeFitMesg` pattern already proven in
[fitWorkout.ts](../../../packages/core/src/output/fitWorkout.ts). Messages:

- `file_id`: `type='course'`, `manufacturer='development'`, `timeCreated`, `serialNumber`.
- `course`: `name='Vatternrundan'`, `sport='cycling'`.
- `event`: timer `start` at the head, `stop_all` at the tail.
- `lap`: one lap spanning the route (`startPositionLat/Long`, `endPositionLat/Long`,
  `totalDistance`, `totalTimerTime`, `timestamp`, `startTime`).
- `record` per microsegment: `timestamp` (synthetic monotonic, from a fixed nominal base
  date + `clockToSeconds(start_time) + eta_s`; does not affect live navigation),
  `positionLat`/`positionLong` (**semicircles**,
  `round(deg * 2^31 / 180)`), `distance` (cumulative metres, monotonic), `altitude`.
- `course_point` per control: `timestamp`, `positionLat`/`positionLong` (semicircles),
  `distance` (cumulative metres at the control), `name` = `` `${control.name} ${HH:MM}` ``
  (no stop-minutes suffix, kept short for the watch and a clean parse), `type='generic'`.

Reuse `buildCourseGpx`'s nearest-micro lookup and `secondsToClock(eta_s, cfg.start_time)`
for control positions and planned clock. Key gotcha to verify by round-trip: lat/long are
stored as semicircles (the SDK applies no position auto-scale), and `distance` must be
monotonic non-decreasing.

## Component 2: the data field (Monkey C)

`ciq/source/NextControlPace.mc`. A custom `WatchUi.DataField` (not `SimpleDataField`, which
shows only one value). Renders best as a full-screen, single-field data screen. Logic ported
from the source spec (`next_control_pace_plan_ux.md`, sections 7–14, 17).

**State:** `currentNextName`, `lastNextName`, `segmentStartDistance`, `segmentStartTimer`,
`segmentIndex`, `lastDistanceToNext`, `lockoutUntil`, `showPassedUntil`, `passedName`,
`smoothedSpeed`.

**`compute(info)`** (once/second):

- Read `nameOfNextPoint`, `distanceToNextPoint`, `elapsedDistance`, `timerTime`,
  `currentSpeed`. Any may be null → handle defensively.
- **Segment detection** (any triggers a new segment, unless in lockout):
  - A: `nameOfNextPoint` changed.
  - B: `lastDistanceToNext < 50 m` and `distanceToNextPoint > 500 m`.
  - C: `lastDistanceToNext < 150 m` and `distanceToNextPoint − lastDistanceToNext > 1000 m`.
- On switch: close segment, start new one (`segmentStart* = current`), set `lockoutUntil =
now + 8 s`, set `showPassedUntil = now + 6 s`, `passedName = lastNextName`.
- **Average gate:** until `distDone ≥ 500 m` and `timeDone ≥ 60 s`, show `Bygger snitt...`.
- `segmentAvg = distDone / timeDone`; `smoothedSpeed = 0.9·smoothedSpeed + 0.1·segmentAvg`.
- **ETA:** `etaSeconds = distanceToNextPoint / smoothedSpeed`; `etaClock = now + etaSeconds`.
  Fallback to `currentSpeed` if the segment is too short.
- **Delta:** parse `HH:MM` from `nameOfNextPoint` (first match); `delta = etaClock −
plannedClock` (seconds-since-midnight, wrapped). Display rounded minutes `+M`. Color by
  `|minutes|`: ≤2 green, ≤10 yellow, >10 red.

**`onUpdate(dc)`:** clear, then draw the layout for the `layoutMode` setting; if
`now < showPassedUntil`, draw the Passed screen instead; if a status/fallback condition
holds, draw that. High contrast, large numerals, ≤5 rows.

Keep `segmentAvg`/`eta`/`delta`/formatting as small focused functions so they are easy to
reason about and to spot-check.

## Component 3: layout modes (settings-selectable)

One `DataField` class; `onUpdate` branches on `layoutMode`. From the infographic:

- **A Standard:** `NAME` / `12.4 km` / `31.8 km/h` / `ETA 07:18  +03 min`.
- **B Compact:** `NAME` / `12.4 km` / `31.8` / `+03`.
- **C Speed+Distance:** `SNITTFART` / `31.8 km/h` / `12.4 km` / `till NAME`.
- **D ETA-only:** `ETA` / `07:18` / `+03 min` / `till NAME`.
- **E Passed** (transient, ~6 s, all modes): `✓` / `NAME` / `Passerad!` / `Nästa: NEXT` / `km`.

## Component 4: Connect IQ settings (minimal)

`resources/properties` + `resources/settings` (read via `Application.Properties.getValue`):

- `layoutMode` — enum A/B/C/D, default A.
- `units` — km/h (default) or mph.
- `showPlanDelta` — bool, default true.

Smoothing is always on. Further settings → roadmap.

## Component 5: build & packaging

- Static `ciq/monkey.jungle` points at the committed `source/` (drop the "generated per run"
  comment).
- `ciq/manifest.xml`: `name=@Strings.AppName` ("Next Control Pace"), `type=datafield`,
  product `fenix7x`. Keep the existing app UUID. Confirm `minApiLevel` supports custom
  `DataField` + settings + color (target 3.1.0, verify against the SDK).
- New build entry `npm run build:ciq`: ensure dev key (reuse `ensureDeveloperKey`), run
  `monkeyc` against the static jungle for `fenix7x`, output `output/NextControlPace.prg`.
  Best-effort: if the SDK is absent, report and exit cleanly (do not fail other builds).
- Install (documented for the user): sideload `NextControlPace.prg` to `GARMIN/Apps`, then
  on the watch add it under the cycling profile → Data Screens → Connect IQ Fields.

## Component 6: web app & CLI

- `apps/web/src/components/Downloads.tsx`: in the "Garmin-klocka" group, replace the
  `PlanDelta.mc` button with (a) a `course.fit` download ("Course för Garmin-klocka") and
  (b) an install card with the steps above. Remove the `generatePlanDeltaSource` import and
  `onPlanDelta`. Keep the `course.gpx` button.
- `packages/cli`: write `course.fit` to `output/`; remove the per-plan `generateCiq` call.
- `packages/core/src/index.ts`: export `buildCourseFit`; remove `generatePlanDeltaSource`.

## Retire PlanDelta (removals)

- `packages/core/src/ciq/generate.ts`, `template.ts`, `PlanDelta.mc.tmpl`.
- `packages/core/tests/ciq.test.ts`.
- The per-plan path in `packages/cli/src/ciqCompile.ts` (keep only the dev-key + monkeyc
  helpers, repurposed by `build:ciq`).
- `generatePlanDeltaSource` usage in `Downloads.tsx` and its export in `index.ts`.

## Data sources (Activity.Info)

| Field                 | Use                                             |
| --------------------- | ----------------------------------------------- |
| `nameOfNextPoint`     | next control name; source of planned `HH:MM`    |
| `distanceToNextPoint` | metres remaining; segment detection signals B/C |
| `elapsedDistance`     | segment distance accumulation                   |
| `timerTime`           | segment time (paused time excluded)             |
| `currentSpeed`        | ETA fallback before the average gate opens      |

All may be null; the field must show a status state rather than crash.

## Fallback states (source spec §12)

| Situation                      | Display                              |
| ------------------------------ | ------------------------------------ |
| No active course               | `Ingen course` / `Starta navigation` |
| No navigation yet              | `Väntar på navigation`               |
| Name missing, distance present | `Nästa punkt`                        |
| Distance to next missing       | `-- km`                              |
| Too little segment data        | `Bygger snitt...`                    |

## Testing

- `packages/core/tests/fitCourse.test.ts`: encode then decode with the `@garmin/fitsdk`
  `Decoder`; assert file `type='course'`, one `course_point` per control with the right
  names (incl. planned `HH:MM`) and positions, `record` count equals microsegment count,
  and `distance` monotonic. Mirrors the existing FIT round-trip style.
- Remove `ciq.test.ts`.
- Field logic: verified against the source spec §16 test-course checklist (3-waypoint
  course: segment switches at each control, lockout blocks double-switch, fallbacks on
  missing data, state resets on a new course). Best-effort `monkeyc` compile as a smoke
  check when the SDK is present.
- `tsc --noEmit` and the existing suite stay green after the PlanDelta removal.

## File inventory

**New:** `packages/core/src/output/fitCourse.ts`, `packages/core/tests/fitCourse.test.ts`,
`ciq/source/NextControlPace.mc`, `ciq/resources/properties/*`, `ciq/resources/settings/*`,
the `build:ciq` entry, install docs. (`docs/roadmap.md`, root `CLAUDE.md` already added.)

**Changed:** `ciq/manifest.xml`, `ciq/monkey.jungle`, `ciq/resources/strings/strings.xml`,
`ciq/resources/drawables/drawables.xml`, `packages/core/src/index.ts`,
`packages/cli` (write `course.fit`, add `build:ciq`, trim `ciqCompile.ts`),
`apps/web/src/components/Downloads.tsx`.

**Removed:** `packages/core/src/ciq/{generate.ts,template.ts,PlanDelta.mc.tmpl}`,
`packages/core/tests/ciq.test.ts`, the per-plan compile path.

## Out of scope (→ roadmap)

FIT developer-field logging, post-waypoint history screen, manual segment correction,
vibration/alerts, Connect IQ Store publishing, device targets beyond `fenix7x`.
