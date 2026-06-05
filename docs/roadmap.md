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
