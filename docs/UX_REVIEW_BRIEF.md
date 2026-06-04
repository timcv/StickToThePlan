# StickToThePlan — App Description for UX Review

> Paste this alongside your screenshots when asking for a UX review.

## What the app is

**StickToThePlan** is a single-page web app that builds a pacing plan for **Vätternrundan**, a 315 km recreational cycling event around Lake Vättern in Sweden. The rider feeds in a route, their power numbers, and planned rest stops; the app computes split times, per-segment power targets, and wall-clock arrival/departure times so the rider can hit a chosen finish time. It also produces downloadable files for a bike computer (Garmin) and a printable handlebar card.

Everything is computed in the browser. No login, no accounts, no server-side storage. The only network call is an optional weather lookup (Open-Meteo) when the rider asks for wind-adjusted pacing.

**Target user:** an amateur but data-driven endurance cyclist who knows their FTP, rides in a group ("chaingang"), and wants a concrete pace plan rather than just a goal time.

## Tech / look

React 19 + Vite, vanilla CSS (no UI framework). Minimal, light theme. System font. Single blue accent (#1f6feb), light-gray page background, white cards, zebra-striped tables. Max content width ~1040px, centered. Mobile: stacks vertically, tables scroll horizontally.

## Page structure (single scroll, no routing)

1. **Header** — h1 "StickToThePlan", tagline "Vatternrundan race-plan calculator".
2. **Privacy notice** — persistent info box explaining files stay in the browser.
3. **Input form** — "Route and parameters" (always visible).
4. **Status** — error card or spinner (conditional).
5. **Results** (only after a run): scenario summary → split plan (hero) → downloads → tempokort (pace card).

## The input form

**File uploads**
- *GPX route (required)* — pre-loaded with a bundled "Vätternrundan 315 km.gpx" so the app works on first visit without uploading anything.
- *FIT power file (optional)* — a past ride's power data; used to anchor the power target. Without it, the app falls back to 0.60 × FTP.

**Parameters** (responsive grid, 2–4 columns)
| Field | Default | Notes |
|---|---|---|
| Target total time (h:mm) | 11:45 | goal finish time |
| FTP (W) | 272 | functional threshold power |
| Riders in group | 12 | 1 = solo |
| Rider + bike mass (kg) | 96 | physics input |
| Watch target | pull | "pull" (front rider) or "avg" (group average) |
| Weather mode | calm | "calm" (no wind) or "open-meteo" (real forecast) |
| Race date | 2026-06-13 | only shown in open-meteo mode |
| Start time (HH:MM) | 04:22 | for wall-clock arrival times |
| Styrkortet max rows | 20 | cap on handlebar-card rows (5–50) |

**Stops table** (fieldset "Stops") — editable rows of Control name / km / Minutes. Pre-filled with the 9 official Vätternrundan controls (Hästholmen, Gränna, Jönköping, etc.). Add stop / Remove buttons. Auto-sorts by km.

**Run button** (primary blue) — disabled while solving or if no GPX. Spinner shown while solving. Form state persists to localStorage between visits.

## What the rider gets back

**Scenario summary** (only when wind makes plans differ) — three rows: Optimistic / Expected / Pessimistic, each with total time and required normalized power (W). All hit the same target time; the spread shows the wind margin. Warning shown if the target time isn't sustainably reachable.

**Split plan** (hero table, thick blue border) — one row per leg between stops. Columns: Leg, Distance (km), Leg time, Avg (km/h), Arrival, Stop (min), Departure, Cumulative.

**Downloads** — five buttons: `workout.fit`, `course.gpx`, `plan.json`, `PlanDelta.mc` (Garmin Connect IQ source), `styrkortet.html` (printable handlebar card). Note that the compiled watch file needs the Garmin SDK locally.

**Tempokort** (pace card) — toggles between two views via a button ("Styrkortsläge" ↔ "Fullständigt"):
- *Compact (Styrkortsläge)* — handlebar-optimized 6 cols: Km, Ort (town), km/h, Ankomst (arrival), Avgång (departure), W. Stop rows are bold + yellow.
- *Full (Fullständigt)* — Section (km), Town, Distance, Net height (m), Avg grade, Wind, Pull band (W), Avg (W), Note, Stop. Wind shown in Swedish ("Mot 6 m/s", "Med 4 m/s", "Sido 5 m/s", "Lugnt"). Notes in Swedish caps ("JÄMN FART", "KLÄTTRING", "BACKAR", "SISTA UPPFÖR", "DEPÅ").

## Known mixed-language quirk (relevant for UX feedback)

The UI mixes **English** (form labels, split-table headers, section headings) with **Swedish** (tempokort columns, wind labels, note keywords, the word "Tempokort"/"Styrkortet"). This is inconsistent and worth flagging.

## User flow

1. Land on page → form pre-filled with default route + saved values.
2. Optionally upload custom GPX/FIT, tweak parameters, edit stops.
3. Click Run → solver runs off-thread in a web worker.
4. App parses route, sets a power anchor, optionally fetches wind, then bisects normalized power to hit the target time, generates segments and outputs.
5. Results render. Rider reads splits / pace card, downloads files, re-runs after tweaks.

## Questions worth a UX opinion on

- The single-page, everything-visible-at-once layout vs. a stepped flow.
- Mixed English/Swedish labeling.
- Density and scannability of the two big tables on a phone.
- Whether the 5 download formats need explanation/grouping.
- Discoverability of the compact/full tempokort toggle.
- First-run clarity: a novice sees ~13 inputs immediately with no onboarding.
