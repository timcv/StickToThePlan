# StickToThePlan

Power-paced race-plan calculator for Vätternrundan 2026 (315 km, race day 2026-06-13).

Takes the course GPX, a historical Garmin FIT power ride, and a live multi-source weather forecast, and produces:

- a raceplan (tempokort) with per-segment ETA, target watts and notes,
- a distance-based structured FIT workout that drives a Garmin Fenix 7X by watt target,
- the course as GPX/FIT for navigation and ClimbPro,
- three time scenarios (optimistic, expected, pessimistic) from the weather ensemble.

The plan holds even effort (constant rider normalized power) and lets speed vary with gradient and wind, with caps so pulls never become unsustainable. Total time target 11:45 including 50 min of stops.

## Status

Design phase. The full design and the build plan are in
[docs/superpowers/specs/2026-06-03-vatternrundan-raceplan-design.md](docs/superpowers/specs/2026-06-03-vatternrundan-raceplan-design.md).

Reference-pass wind validation:
[docs/research/2026-05-30-reference-pass-wind.md](docs/research/2026-05-30-reference-pass-wind.md).

## Stack

TypeScript + Node (CLI). FIT read/write via the Garmin FIT SDK, weather from Open-Meteo, SMHI and MET Norway.

## Note on data

Personal input files (the course GPX and FIT rides) are not committed. They live under `data/`, which is gitignored.

## Formatting rule

No em dash anywhere in code, comments or output. Use commas or new sentences.
