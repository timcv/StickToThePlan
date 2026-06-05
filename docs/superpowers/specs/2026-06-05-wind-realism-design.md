# Design: Wind realism honest core (effective wind, vector aero, uncertainty)

**Date:** 2026-06-05
**Status:** Approved, ready for implementation planning
**Owner:** Tim
**Source inputs:** `sticktotheplan_rapport_kritisk_granskning.md`, `sticktotheplan_implementation_tests_ux.md` (both reviewed critically, see §3)

---

## 1. Summary

Make the pacing model's wind handling meaningfully more realistic without adding false precision or a runtime data pipeline. Four grounded changes, plus a pragmatic per-segment exposure layer that is **baked offline** for the built-in Vätternrundan route and available as an opt-in setting for other routes:

1. **Effective wind** — convert 10m forecast wind to rider level with a single log-profile factor.
2. **Per-segment exposure** — vary the roughness (and thus the factor) per segment from real land-cover data, baked offline so the core stays network-free.
3. **Vector apparent wind + tailwind clamp** — replace the axial aero magnitude with the true apparent-wind vector; this only changes crosswind behaviour, pure head/tailwind is unchanged.
4. **Uncertainty interval** — present finish time as a range derived from the three scenario solves the model already computes.
5. **UX honesty** — explain effective wind, exposure, NP, IF, cap, and the interval; never present the result as an exact forecast.

The work is intentionally scoped below the reports' full roadmap. Group-mode/echelon modelling, route-time rotation simulation, W'bal, Crr-per-surface, FIT auto-calibration, and coherent ensemble members are explicitly **deferred** (§4).

---

## 2. Context and problem

The current model is a sound steady-state physics model (gravity, rolling, signed aero, computed air density, closed-form NP, bisection solver, hard/soft/spinout caps, three wind scenarios). Verified against the code in §3.

The single largest practical error source: **raw 10m forecast wind is fed directly to the cyclist.** `openMeteo.ts` requests `windspeed_10m` and the value reaches `decomposeWind()` with no height or landscape adjustment. A cyclist feels wind at ~1.2m, which over open ground is roughly 60% of the 10m value and far less in shelter. This systematically overstates headwind on exposed/forecast-windy days.

The secondary issues: crosswind is handled only as a CdA penalty on the axial air speed (the apparent-wind magnitude is not used), and the result is shown as a single exact time despite real uncertainty in wind, exposure, and group behaviour.

---

## 3. Critical review of the two reports (verified against code)

The reports are high quality and largely accurate. Cross-checked by reading `physics.ts`, `chaingang.ts`, `planner.ts`, `config.ts`, `types.ts`, `weather/*`, `ingest/gpx.ts`, `segmentation.ts`, and the tests.

**Verified TRUE:** signed aero `v·|v|`; wind decomposition `headwind=W·cos(Δ)`, `crosswind=W·sin(Δ)`; group constants `f_front=1/n`, `CdA_pull=0.32`, `CdA_draft=0.21`; closed-form NP square wave; computed air density; fixed `crr=0.0045`, `eta=0.97`; bisection solver on rider-NP; IF warning at 0.75; optimistic/expected/pessimistic scenarios; hard/soft/spinout caps; **no height correction, no exposure model**; per-cell p10/p90 (not coherent members); fixed-**point** elevation smoothing window; ~66m microsegments tied to GPX density; grade clamp ±18%.

**Overstated or already implemented (the reports guess at the code with "tycks"/"sannolikt"):**

- **Yaw is not missing.** `yawCdaFactor()` already exists, is applied to both pull and draft CdA, and is tested (`physics.ts`). The real gap is narrow: the aero force uses axial `v+headwind` rather than the vector magnitude `hypot(u,c)`, and there is no tailwind clamp. So the "apparent-wind-yaw" PR shrinks to a ~15-line change.
- **Physiology is partly covered.** `reachable` is mechanical, true, but an IF>0.75 warning already surfaces in the web summary. Only W'bal/durability is genuinely absent, and it is low payoff.
- **Uncertainty machinery half-exists.** The three scenarios already re-solve at p10/mean/p90 wind. Surfacing a time interval is mostly presentation.

**Substantive concerns driving the scope decision:**

1. **Over-engineering / YAGNI.** ~7 new modules, model-version enums, a 7-variant GroupMode, route-time simulation, FIT calibration, for a personal tool with one built-in route.
2. **The exposure model can trade a known error for an unknown one.** Height correction (log profile) is physically grounded. Landscape multipliers are invented numbers; uncalibrated, they can make the output _feel_ precise while being no more accurate. Mitigated here by (a) using **real** land-cover data rather than a single guess and (b) keeping the uncertainty interval.
3. **Runtime GIS pipeline is the real cost.** Resolved by **baking exposure offline** and injecting it as pre-processed data, which the reports themselves recommend ("externa datakällor ska injiceras via pre-processade data").

---

## 4. Scope

### In scope (locked)

- C1 Vector apparent wind + tailwind clamp.
- C2 Height-correction engine (single global `z0`) + manual-wind reference toggle.
- C3 Uncertainty interval from existing scenarios.
- C4 Per-segment exposure: OSM/Overpass bake → committed static file for Vätternrundan → class→z0 per segment; coarse manual terrain default + opt-in fetch for other routes; NMD as a later higher-fidelity upgrade for the built-in route.
- C5 UX honesty.
- C6 Tests, re-baseline, documentation, DoD.

### Out of scope (deferred, with reasons)

- **Group-mode / echelon / sidewind-dependent draft** — speculative for a single route; no calibration data.
- **Route-time rotation simulation (`riderTimeSeriesValidation`)** — the closed-form NP is adequate for group mean tempo; high effort.
- **W'bal / durability** — IF warning already covers the practical case.
- **Crr per surface, post-stop accelerations** — minutes-level effect, dominated by wind.
- **FIT auto-calibration of CdA/Crr/draft/exposure** — valuable later; needs a calibration harness and more ride data. A manual calibration path is documented but not built.
- **Coherent ensemble members** — per-cell p10/p90 stays; the reference ride showed near-uniform wind over the area, so the gain is small.
- **GPX fixed-distance resampling** — the built-in route is uniformly ~66m sampled; low payoff now. Revisit if a sparsely-sampled route misbehaves.

---

## 5. Decisions log

| Question                | Decision                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How much of the roadmap | Honest core only, plus the baked exposure layer (added after the core was scoped).                                                                                                                                                  |
| Legacy handling         | Default-on, light escape hatch. New behaviour is the default; affected windy tests are re-baselined; old wind behaviour recoverable via config (`rider_wind_height_m = 10` ⇒ factor 1). No `wind_model`/`aero_model` version enums. |
| Manual wind             | Explicit toggle: "this is 10m forecast wind" vs "this is the wind I feel". Default 'felt' (literal). Requires very clear UX copy.                                                                                                   |
| Structural approach     | A — inline minimal (modify existing files, no speculative module scaffolding).                                                                                                                                                      |
| Physics constants       | `z0=0.05` global default, rider height 1.2m, forecast height 10m, yaw clamp ±50°. All configurable.                                                                                                                                 |
| Exposure source         | OSM/Overpass primary (global, serves bake + other routes). NMD higher-fidelity pass for the Vätternrundan static file as a later upgrade.                                                                                           |

---

## 6. Architecture and data flow

The honest core is one engine with `z0` as the only lever. Exposure makes `z0` vary per segment; everything else is identical.

```
weather sample (10m wind, per microsegment at its ETA/position)
   │
   ├─ z0 for this segment:
   │     baked exposure (built-in route)  →  class → z0
   │     fetched exposure (opt-in, other routes) → class → z0
   │     else coarse terrain selector → z0
   │     else global default z0 = 0.05
   │
   ▼
adjustWindForHeight(W, z0, rider_h, forecast_h, reference) → W_eff   ← single scalar k, direction unchanged
   │
   ▼
decomposeWind(W_eff, phiFrom, bearing) → { headwind, crosswind }     (unchanged)
   │
   ▼
pedalPower(): vector apparent wind + tailwind clamp                   (physics.ts, C1)
   │
   ▼
solver → three scenario solves → time_uncertainty_s (C3)
```

**Invariants:**

- Wind **magnitude** changes in exactly one place (`adjustWindForHeight`). Wind **direction** is never modified.
- The **core never performs network I/O at solve time.** Exposure is either baked (committed file) or fetched in the app layer (web/CLI) and injected as pre-processed data.
- New `PlanResult` fields are optional. Old consumers and old `plan.json` files keep working.

---

## 7. Component specs

### C1 — Vector apparent wind + tailwind clamp (physics)

**Files:** `packages/core/src/physics.ts` (pedalPower, new `clampYaw`/`apparentWind` helper), `packages/core/src/chaingang.ts` (feed clamped yaw).

Replace the axial magnitude; keep the existing `yawCdaFactor`:

```ts
const u = v + headwind; // axial apparent, into-wind positive
const c = crosswind;
const vApp = Math.hypot(u, c); // true apparent-wind magnitude
let yaw = Math.atan2(c, u);
yaw = clampYaw(yaw); // limit to ±50°, kills the u<0 (~180°) blow-up
const cdaX = cda * yawCdaFactor(c, u, k_yaw);
const fAero = 0.5 * rho * cdaX * vApp * u; // magnitude vApp, projected on travel axis, sign from u
```

Properties:

- **c = 0 ⇒ legacy exactly** (`vApp·u = u²`). Pure head/tailwind unchanged.
- **Pure crosswind adds drag** (`vApp > v`).
- **Strong tailwind (`u < 0`)** keeps the forward-push sign and the clamp bounds the CdA factor.

Acceptance:

- [ ] c=0 reduces to legacy within tolerance.
- [ ] pure crosswind ⇒ power > calm.
- [ ] strong tailwind + crosswind ⇒ no NaN, yaw factor bounded.
- [ ] `k_yaw` stays 0.04.

### C2 — Height-correction engine + manual-wind toggle

**Files:** `config.ts`, `types.ts`, new `adjustWindForHeight` helper (in the weather→planner path), `planner.ts` wiring.

```ts
function heightFactor(z0: number, riderH = 1.2, forecastH = 10): number {
  // log wind profile ratio; guards: z0>0, heights>0
  const k = Math.log(riderH / z0) / Math.log(forecastH / z0);
  return Math.min(1, Math.max(0.15, k)); // floor avoids over-sheltering in tall-roughness classes
}
```

- Global default `z0 = 0.05` ⇒ k ≈ 0.6.
- **Escape hatch:** `rider_wind_height_m = 10` ⇒ k = 1 ⇒ today's numbers.
- **Manual toggle:** a manual wind entry carries `wind_reference: '10m' | 'felt'`. Forecast wind is always `'10m'` (factor applied). Manual `'felt'` ⇒ factor 1 (literal); manual `'10m'` ⇒ factor applied. Default for the manual toggle: `'felt'`.
- Direction unchanged; `W_eff = W·k ≥ 0`.

Acceptance:

- [ ] config fields present with defaults.
- [ ] escape hatch verified.
- [ ] guards + clamp verified.
- [ ] manual toggle behaviour verified.
- [ ] core stays network-free.

### C4 — Per-segment exposure (OSM bake + other-routes setting)

**Files:** `scripts/bake-exposure.*` (dev-only), `data/vatternrundan-exposure.json` (committed), core class→z0 table + loader, config/types for exposure input, web/CLI opt-in fetch (app layer).

**Offline bake (run once, output committed):**

1. Read the built-in GPX.
2. Query Overpass over the route bbox for: `natural=wood`/`landuse=forest` → forest; `natural=water` → water; `landuse=residential|industrial` → urban; `bridge=yes` on the route's own ways → bridge (exact); `barrier=hedge`/`natural=tree_row` → sheltered; default → open/semi_open.
3. Point-in-polygon per microsegment centroid (~4800 points, trivial offline).
4. Write `data/vatternrundan-exposure.json` as distance-keyed runs (RLE of `{ start_km, end_km, class }`) so it survives resampling, plus a route id/hash so it only applies to the matching built-in route.

**Class → z0 starting table** (configurable, literature not calibrated; the `k` floor in C2 applies):

| class               | z0 (m) | k ≈ effective/forecast |
| ------------------- | -----: | ---------------------: |
| water               |  0.001 |    0.77 (most exposed) |
| bridge              |  0.002 |                   0.73 |
| open                |   0.03 |                   0.64 |
| semi_open (default) |   0.08 |                   0.56 |
| forest              |   0.30 |                   0.40 |
| urban               |   0.40 |                   0.34 |
| sheltered           |   0.50 |  0.29 (most sheltered) |

**Core solve:** load the static exposure for the built-in route, map class→z0 per segment, feed C2. Network-free.

**Other routes (the setting), in priority order:**

1. **Default:** coarse terrain selector — Öppet (z0 0.03, k≈0.64) / Blandat (z0 0.05, default, k≈0.60) / Skyddat (z0 0.30, k≈0.40). Matches the global `wind_roughness_z0` default. Zero network. (Distinct from the per-segment `semi_open` class, z0 0.08, which only applies when real exposure data is present.)
2. **Opt-in "Hämta exponering för rutten"** at upload: run the same Overpass classifier in the web/CLI layer (not core), cache the result, inject as pre-processed data.

**NMD upgrade (later, not built now):** a higher-fidelity NMD (10m raster) pass for the Vätternrundan static file specifically. OSM remains the general mechanism (global, serves other routes).

Acceptance:

- [ ] classifier produces the seven classes; bridges from `bridge=yes`.
- [ ] baked file is distance-keyed and route-id guarded.
- [ ] core loads it and stays network-free at solve.
- [ ] other-routes default selector + opt-in fetch both work.
- [ ] `data_quality.exposureCoveragePct` reported.

### C3 — Uncertainty interval + outputs

**Files:** `planner.ts`, `types.ts`, `output/planJson.ts`, `output/tempokort.ts`.

- `PlanResult.time_uncertainty_s?: { expected: number; low: number; high: number; source: 'scenario' }` — built from the optimistic/expected/pessimistic solves already produced by `solveThreeScenarios()`. No new compute. Optional ⇒ back-compat.
- `plan.json` adds the interval and an `assumptions` block (`rider_wind_height_m`, `wind_roughness_z0` or per-segment note, `k`, wind source, `aero: 'vector'`, exposure source). All existing fields stay.
- Tempokort headline: `Beräknad tid 11:45 — rimligt spann 11:32–12:04` + footnote "vind = effektiv vind vid cyklisten, ej rå prognos". Single scenario (calm) ⇒ point value + "spann saknas".
- FIT/GPX exports untouched.
- Rounding: time → whole minute; effective wind → 0.1 m/s.

Acceptance:

- [ ] `expected ∈ [low, high]`; wider wind spread ⇒ wider interval.
- [ ] plan.json carries interval + assumptions; old fields intact.
- [ ] tempokort renders range + footnote; single-scenario fallback works.

### C5 — UX honesty (web)

**Files:** `apps/web/src/components/*` (SummaryCard, WeatherPanel, TempokortTable, segment detail), InfoTip extensions, advanced settings.

- Finish time shown as a range when an interval exists.
- **Effective wind everywhere the user sees wind** (segment rows, labels), not raw forecast.
- Segment detail expander: `Prognos 5,0 m/s → Effektiv 3,0 m/s (−40%, höjd + skog)`.
- Exposure class label per segment (Öppet / Skog / Vatten / Bro / Bebyggt / Skyddat / Halvöppet).
- **Manual-wind toggle:** "Vinden jag angav är: ( ) 10 m prognosvind ( ) vinden jag känner på vägen", default 'felt', with one-line helptext that makes the difference obvious.
- Tooltips (extend existing InfoTip): effektiv vind, NP, IF, cap, spann.
- Advanced settings: terrain selector (Öppet/Blandat/Skyddat), "Hämta exponering för rutten" button, "Visa spann" toggle. Defaults keep the casual path simple.
- Export footnote in the HTML styrkort.

Acceptance: see task #13; verified by component tests + a preview screenshot.

### C6 — Tests, re-baseline, docs, DoD

**Re-baseline (windy cases shift; calm unchanged):** `scenarios.test.ts`, windy `planner.test.ts` cases, `headwind-caps.test.ts`, and the windy numbers in `docs/build-report.md`. Document each delta and why.

**New tests:** height factor (monotonic, k=1 escape hatch, input validation); effective wind (forecast scaled / manual literal vs scaled / direction preserved / never negative); vector aero (c=0==legacy, head>calm, tail<calm, cross>calm, strong tailwind+cross no NaN/bounded); solver still monotone and stable; interval (expected∈[low,high], wider spread, absent ⇒ no crash); exposure (classify, class→z0, baked load, coverage%); output back-compat.

**Optional validation replay:** the 2026-05-30 reference ride at NP 165W vs actual 3.98h within tolerance (a calm-power sanity check, since wind was light).

**Docs (updated after implementation, per Tim):** `docs/calculation-model.md` (effective wind, vector aero, exposure), plus new/updated `docs/wind-model.md`, `docs/aero-model.md`, `docs/exposure-model.md`, `docs/ux-copy.md`, `docs/validation.md`. Must state: prognos vs effektiv vind; exposure classes + fallback; the apparent-wind change; what the interval means; that this is **not CFD** and `z0` magnitudes are literature defaults **not calibrated** to Tim's rides; how to calibrate later.

---

## 8. Config additions

| Field                         | Default   | Purpose                                                                                     |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `forecast_wind_height_m`      | 10        | Height of the forecast wind.                                                                |
| `rider_wind_height_m`         | 1.2       | Target height; set to 10 to disable correction (escape hatch).                              |
| `wind_roughness_z0`           | 0.05      | Global roughness when no per-segment exposure is available.                                 |
| `exposure_terrain`            | `'mixed'` | Coarse selector for routes without baked/fetched exposure: `open`/`mixed`/`sheltered` → z0. |
| (wind input) `wind_reference` | `'felt'`  | Manual wind only: `'10m'` applies the factor, `'felt'` takes the value literally.           |

No `wind_model`/`aero_model` version enums (per the legacy decision).

---

## 9. Type additions

```ts
// PlanResult (all optional → back-compat)
time_uncertainty_s?: { expected: number; low: number; high: number; source: 'scenario' };
data_quality?: {
  exposureCoveragePct: number;
  exposureSource: 'baked' | 'fetched' | 'terrain' | 'none';
  weatherSource: 'manual' | 'forecast' | 'ensemble';
};

// SegmentPlan / MicroSegment (for UI + debug)
exposure_class?: ExposureClass;
raw_windspeed_ms?: number;
eff_windspeed_ms?: number;
z0_used?: number;

type ExposureClass = 'open' | 'semi_open' | 'sheltered' | 'forest' | 'urban' | 'water' | 'bridge';
```

`plan.json` meta gains a `model` block (`wind`, `aero`, exposure source) and an `assumptions` block; these are output-layer, not required on `PlanResult`.

---

## 10. Error handling and numerical edge cases

- `heightFactor`: require `z0 > 0`, `riderH > 0`, `forecastH > 0`; clamp result to `[0.15, 1]`.
- `adjustWindForHeight`: `W_eff = max(0, W·k)`.
- `apparentWind`: `vApp` finite; `clampYaw` bounds yaw to ±50° before the CdA factor; guard against NaN from `atan2(0,0)` (calm ⇒ yaw 0).
- Solver: confirm the new aero keeps `pedalPower` monotone in `v` over the search range so bisection has a single crossing.
- Exposure loader: missing file or route-id mismatch ⇒ fall back to terrain selector / global z0, set `exposureSource` accordingly, never throw at solve time.
- Pedal power on descents stays clamped ≥ 0 (existing behaviour).

---

## 11. Definition of Done

1. New defaults documented.
2. Escape hatch (`rider height = 10` ⇒ legacy numbers) tested.
3. At least one windy before/after demonstration showing the finish time shifts sensibly.
4. UI explains effective wind, exposure class, and the interval.
5. `plan.json` carries model assumptions + the interval.
6. New Swedish warnings/labels are clear.
7. Exported tempokort still readable and useful.
8. Uncertainty presented as an interval, not false precision.
9. Data-quality gaps (exposure coverage %) shown.
10. All new numerical edge cases have tests.
11. **Documentation updated after implementation** (per Tim).

---

## 12. Implementation sequencing (PR batches)

1. **PR 1 (C2):** height engine + config + manual toggle plumbing + tests. Default-on, re-baseline windy tests here. (Foundational.)
2. **PR 2 (C1):** vector apparent wind + clamp + tests. (Independent of C2; can land in parallel.)
3. **PR 3 (C3):** uncertainty interval + plan.json/tempokort + tests.
4. **PR 4 (C4):** OSM bake script + committed exposure file + class→z0 loader + other-routes setting + tests. (Builds on C2.)
5. **PR 5 (C5):** web UX honesty. (Builds on C2/C3/C4.)
6. **PR 6 (C6):** docs + any remaining re-baseline + validation replay.

Each PR keeps `npm run test` green and merges with squash.

---

## 13. Risks and honest non-goals

- **Not CFD.** No local turbulence/gust modelling.
- **`z0` magnitudes are literature defaults, not fitted** to Tim's rides. Exposure sharpens _where_ wind is high/low more than the exact amount. The uncertainty interval exists precisely to avoid implying otherwise.
- **OSM coverage varies** by area; rural Sweden is good but not guaranteed. Coverage % is surfaced.
- **Re-baselining** changes published validation numbers; calm stays identical, windy shifts. Documented in C6.

---

## 14. Open items

- Confirm the manual-toggle default label wording during C5 (default value 'felt' is decided; the exact Swedish helptext is a copy task).
- Confirm the three coarse-terrain z0 values feel right after the first before/after demo; adjust the starting table if the windy demo looks off.

---

## 15. References

Martin et al., _Validation of a Mathematical Model for Road Cycling Power_. ECMWF 10m wind product docs. NCAR/EOL roughness length & displacement height. FAO pyWaPOR roughness. Naturvårdsverket NMD. RHS / Nebraska Forest Service windbreak shelter distance. Fintelman et al., _The Effect of Crosswinds on Cyclists_. Blocken et al., team-time-trial & peloton CFD. Jones et al., Critical Power. Bicycle Rolling Resistance CRR load test. (Full URLs in the source review report.)
