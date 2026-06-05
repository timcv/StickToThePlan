# Roadmap

Forward-looking log of deferred ideas and future improvements. When work surfaces
an enhancement that is out of scope for the current task, record it here instead of
widening the change. Keep entries short and actionable.

## Garmin: Connect IQ Store publishing

The Next Control Pace data field ships as a sideloaded `.prg` with a minimal manifest
(single device target, `fenix7x`). To publish it on the Connect IQ Store later:

- Build a signed release `.iq` package (`monkeyc` release/export build) instead of a
  sideload `.prg`.
- Garmin developer account and a Store listing (name, description, screenshots).
- Launcher icons supplied at every required resolution.
- Version string plus changelog on each submission; Store review applies per update.
- Widen device targets beyond `fenix7x`: add products to `ciq/manifest.xml` and verify
  each layout mode renders on the different screen sizes/shapes.

## Next Control Pace: deferred features

Cut from the first build (kept to core + plan delta + smoothing + selectable layout
modes). Candidates for a later version:

- **FIT developer fields** via `FitContributor`, written to the activity FIT:
  `sttp_segment_index`, `sttp_distance_to_next`, `sttp_segment_avg_speed`,
  `sttp_eta_delta`, `sttp_next_control_id`. Enables post-ride analysis of where time
  was lost versus plan.
- **Post-waypoint history**: a brief segment summary (distance, average speed, plan
  delta) shown for a few seconds after each control is passed.
- **Manual segment correction**: start a new segment now, undo the last segment change,
  or ignore the next waypoint change for N seconds (for missed/early course points).
- **Vibration / alerts** at waypoint passage and at deviation thresholds, off by
  default, used sparingly so the field stays supportive rather than stressful.
- **Expanded Connect IQ settings** surface for the above.

## Repository: Prettier formatting drift

`main` is not fully Prettier-clean: running `npm run format` reformats roughly 40 files
that were committed without the formatting hook (multi-line function signatures collapsed,
aligned whitespace in `config.json`, and similar). The lefthook pre-commit only formats
_staged_ files, so files that are never re-touched drift out of Prettier style. Clean it up
in a dedicated `chore: prettier-format repo` PR, kept separate so feature diffs stay
focused, then let the hook keep new commits clean.

## Wind model: deferred features and calibration

The wind-realism work (effective wind, vector apparent-wind aero, per-segment OSM
exposure, uncertainty interval) deliberately stopped short of the full review roadmap.
Recorded here so the cuts are not lost:

- **Calibration (highest value).** The `z0` roughness values and the `CdA` / `Crr` /
  draft constants are literature defaults, not fitted to real rides. A routine that takes
  a FIT (power, speed, GPS) plus that day's wind and back-solves calibration factors for
  `CdA`, `Crr`, draft, and a wind-exposure scale would replace the largest remaining
  guess. One windy reference ride is enough to start.
- **Higher-fidelity exposure** for the built-in route: a Swedish national land-cover
  (NMD, 10 m) pass to refine the OSM bake (`scripts/bake-exposure.mjs`). Sweden only, so
  OSM stays the general mechanism.
- **Opt-in exposure fetch for uploaded routes.** `apps/web/src/lib/exposureClient.ts` is
  a disabled stub. Wire it to Overpass (browser, CORS) so non-default routes can get
  per-segment exposure instead of the coarse terrain selector.
- **Group / echelon model:** make drafting depend on sidewind, formation, and road width
  (a `group_mode` enum) rather than just `1/n_riders`. Speculative without ride data.
- **Route-time rotation simulation:** validate the closed-form NP by simulating the
  actual pull/draft rotation second by second over the whole route and flagging where the
  fast model and the time series disagree.
- **Physiological risk (W'bal / durability):** beyond the existing IF warning, model the
  anaerobic work-capacity drain and the late-event fade.
- **Crr per surface and post-stop accelerations:** surface-class rolling resistance and
  the re-acceleration cost after stops, corners, and controls. Minutes-level, wind
  dominates.
- **Coherent ensemble members** instead of per-cell p10/p90: run whole weather members
  through the solver so the time band keeps spatial and temporal correlation.
- **GPX fixed-distance resampling** before elevation smoothing, so the smoothing window
  is metres rather than points and plans are stable across GPX sampling densities.
- **Manual-wind uncertainty band:** manual wind always collapses the interval to a point
  ("spann saknas"); a felt-uncertainty band would let manual mode show a range.
- **`applyExposure` route-id guard:** the loader trusts the caller's route gate today;
  add an optional `expectedRouteId` that no-ops on mismatch (hardening if a second caller
  is ever added).
- **Drop the web `@stp/core` vite alias** (`apps/web/vite.config.ts`) once confirmed
  redundant on `main`. It was added so a shared-`node_modules` worktree resolved the local
  core source; it points at the same file the workspace symlink does.
- **CLI relative-time course export:** `buildCourseFit` now takes `{ relativeTime }` (the
  web exposes it as a checkbox), but the CLI (`packages/cli/src/fileIo.ts`) always writes
  absolute wall-clock course points. Add a CLI flag/config to emit the relative variant.
