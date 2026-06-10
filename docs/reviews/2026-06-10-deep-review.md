# StickToThePlan — Deep Review (2026-06-10)

Synthesis of 17 adversarially-verified review tracks plus mechanical baseline,
fuzz loops, and completeness critics. Every cited line was re-opened and
verified; line numbers below reflect the corrected (adjusted) citations, not
the original candidate claims.

---

## 1. Executive summary

Overall health is **solid for a privacy-first, local/single-user tool**, with a
clean, well-typed pure-physics core (`strict: true` everywhere, 307/308 tests
green) and genuinely good secret hygiene (the Garmin signing key is gitignored,
untracked, and 0600). The two
**confirmed correctness defects that matter most are physics-real**, not
theoretical: a non-monotone `riderNpAtSpeed` makes the bisection solver pick a
spurious slow root on steep descents (10–20% of the shipped Vätternrundan route
runs the buggy branch, producing 4–15 km/h descents), and a local-vs-UTC
**timezone misalignment** samples wind ~2h off the true time of day.

The dominant systemic theme is **absent input validation at every external
boundary** (GPX, FIT, config, upstream weather JSON, the API query, the web
form, localStorage, worker messages). This single root cause produces a long
tail of NaN/Infinity/crash findings: empty-string lat coerces to 0 (Null
Island, 1000x distance inflation), missing `<ele>` poisons grades, malformed
time strings silently yield a meaningless "reachable" plan, and a single bad
weather sample NaN-poisons an entire ensemble cell. A second systemic theme is a
**missing defense layer in production ops**: the public weather endpoint has no
rate limit, no upstream fetch timeout, and no `maxDuration`, so a hanging
provider or cache-busting caller can amplify load.

Strengths to preserve: no SSRF (hardcoded upstream hosts), no shell injection
(`execFileSync` array args only), no XXE/billion-laughs (fast-xml-parser 5.8.0
defaults are safe), no committed secrets, no analytics/trackers, client
coordinates correctly coarsened to 0.1° before egress, and a clean runtime
dependency surface (all 9 npm advisories are confined to the `@vercel/node`
dev/build toolchain).

Top risks, in order: (1) descent solver wrong-root → physically absurd plan
times on the real route; (2) timezone wind misalignment; (3) parser/config
NaN propagation producing silently-wrong plans; (4) unthrottled/untimed weather
endpoint; (5) `api/` typecheck currently fails because `@vercel/node` is
declared-but-not-installed.

---

## 2. Prioritized top findings (severity, then confidence)

| Severity | Track                                 | Finding                                                                                                       | File:line                                                            | Recommendation                                                                     |
| -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Critical | fuzz-solver                           | `riderNpAtSpeed` non-monotone on descents; bisection lands on spurious slow root (descent slower than flat)   | `packages/core/src/chaingang.ts:304-327`                             | Search the fastest root / solve within `[0.5,vMax]`; don't 4th-power braking power |
| Critical | fuzz-solver                           | Steeper descent yields slower plan speed at fixed effort (sign of grade-monotonicity wrong)                   | `packages/core/src/planner.ts:168` → `chaingang.ts:304`              | Same fix; add regression asserting speed ↑ as grade ↓                              |
| High     | corr-physics                          | Descent slow-root produces 3–10 km/h crawls on real route; 20 segs ≤ −8%                                      | `packages/core/src/chaingang.ts:300-327`                             | Select coasting/high-speed regime; fix the misleading monotonicity comment         |
| High     | fuzz-solver                           | Vätternrundan route: 118 microsegments crawl the buggy descent branch (median 14.9, min 4.3 km/h)             | `data/vatternrundan-315km.gpx` (ingest→planner)                      | Fix descent root-selection; re-baseline validation numbers                         |
| High     | corr-weather / sec-api                | Local wall-clock start time matched against UTC weather hours (~2h summer offset)                             | `packages/core/src/weather/ensemble.ts:237,251-254`                  | Convert local start to UTC, or fetch+bin in Europe/Stockholm                       |
| High     | corr-weather / resilience             | `parseOpenMeteo` only parser that doesn't skip incomplete rows → NaN samples                                  | `packages/core/src/weather/openMeteo.ts:86-98`                       | Skip non-finite windspeed/dir; default temp/pressure                               |
| High     | resilience                            | `buildEnsemble` has no NaN sanitation; one bad sample poisons whole cell (mean/p10/p90/temp/pressure)         | `packages/core/src/weather/ensemble.ts:145-179`                      | Filter finite samples before aggregation                                           |
| High     | resilience                            | Physics/planner have zero NaN guards; NaN weather → NaN power/time, blank UI cells                            | `packages/core/src/physics.ts:23-62`                                 | Treat non-finite WindCond as calm at the boundary                                  |
| High     | sec-parsing / robustness / typesafety | GPX lat/lon/ele parsed with no finite/bounds guard → NaN poisons the solve                                    | `packages/core/src/ingest/gpx.ts:43-47`                              | Reject/skip non-finite, bound lat∈[-90,90]/lon∈[-180,180], default ele=0           |
| High     | fuzz-gpx                              | Empty-string lat → `Number('')===0` (Null Island), inflates distance 1000x silently                           | `packages/core/src/ingest/gpx.ts:43-47`                              | Strict numeric parse; reject empty before `Number()`                               |
| High     | fuzz-gpx                              | NaN coord makes `dedupePoints` (`NaN>=0.5` false) drop the entire rest of the route, then `segment()` crashes | `packages/core/src/ingest/gpx.ts:57-67`                              | Filter NaN before dedupe; guard empty micro array                                  |
| High     | fuzz-gpx                              | Valid `<rte>`/`<wpt>`-only GPX crashes parser (only reads `trk`)                                              | `packages/core/src/ingest/gpx.ts:23-34`                              | Fall back to rte/wpt or throw clear "no track" error                               |
| High     | fuzz-gpx                              | Unbounded parse: 1M-point/60MB GPX → ~1.2GB RSS, 3M → heap OOM (browser/serverless DoS)                       | `packages/core/src/ingest/gpx.ts:13-48`                              | Cap bytes and point count before parse                                             |
| High     | robustness / fuzz-solver              | `hmToSeconds`/`clockToSeconds` yield NaN; NaN target → bogus "reachable" plan, no error                       | `packages/core/src/util/time.ts:10-22`; `planner.ts:336,344,360-374` | Validate `^\d{1,2}:\d{2}$` and finiteness; throw                                   |
| High     | robustness                            | Web form numeric fields use `Number()` with no NaN/zero/negative guard                                        | `apps/web/src/components/UploadForm.tsx:371-403,447-451,543,551`     | Finite-fallback + clamp before building PipelineForm                               |
| High     | robustness / fuzz-solver              | `applyDefaults` validates only 3 mandatory strings, never numeric bounds                                      | `packages/core/src/config.ts:58-101`                                 | Validate ftp≥1/≥60, m≥1, n_riders≥1, 0<eta≤1, neutral_speed>0, max_grade≥0         |
| High     | fuzz-fit                              | NaN/Infinity/negative power propagates into `np_target`; uint16 wrap inflates NP ~3x                          | `packages/core/src/ingest/fit.ts:14-20,38-46`                        | Filter `Number.isFinite && p>=0`; clamp to ~0–2000 W                               |
| High     | sec-api                               | No rate limit/auth on public weather endpoint → upstream quota/cost DoS (≤193 fetches/miss)                   | `api/handler.ts:60-69`                                               | Per-IP rate limit + upstream budget before fan-out                                 |
| High     | test-depth                            | Solver `reachable=false` branch never exercised by any test                                                   | `packages/core/src/planner.ts:343-353`                               | Add impossible-target test asserting `reachable===false`                           |
| High     | typecheck / supply-chain              | `api/` typecheck FAILS: `@vercel/node` declared but not installed (TS2307)                                    | `api/weather.ts:1`                                                   | `npm ci`/install `@vercel/node`; include api/ in CI typecheck                      |
| High     | cross-cutting                         | `encodeWorkout` uses `new Date()` → non-deterministic FIT (course encoder uses fixed const)                   | `packages/core/src/output/fitWorkout.ts:155`                         | Use fixed `BASE_MS` like `buildCourseFit`                                          |
| Medium   | corr-segmentation                     | Control town markers dropped by min_segment/max_segments merges (no town guard)                               | `packages/core/src/segmentation.ts:227,417-444,483-506`              | Add `if (a.town !== undefined) continue;` like the grade-merge pass (line 467)     |
| Medium   | sec-api                               | Date validated for shape only; distinct dates/coords bust CDN cache, amplify upstream                         | `api/handler.ts:26,42`                                               | Clamp date to forward window; snap coords server-side                              |
| Medium   | sec-api / cross-cutting               | No timeout/abort on upstream fetches; a hung provider ties up the function                                    | `packages/core/src/weather/fetchAll.ts:45,55,65`                     | AbortController + 5–8s per-fetch timeout                                           |

(Remaining confirmed findings appear in full in §3.)

---

## 3. Per-category sections

### 3.1 Security

**Input validation (GPX, file boundary) — HIGH.**
`gpx.ts:43-47` does `lat: Number(pt['@_lat']), lon: Number(pt['@_lon']), ele: Number(pt['ele'])` with no finite/bounds guard; `api/handler.ts:52-53` already does the matching check on the network path.

> _Evidence:_ haversine returns NaN for NaN coords; a single non-numeric trkpt NaN-poisons the whole solver output.
> _Fix:_ reject/skip the point unless `Number.isFinite(lat) && Number.isFinite(lon) && lat∈[-90,90] && lon∈[-180,180]`; default ele to 0. Mirror `api/handler.ts:52-53`.

**Empty-string coercion to Null Island — HIGH (fuzz-gpx).** `Number('')===0`, so a blank/missing lat parses to 0; reproduced a 5-point route inflating from 4,448 m to 12,905,283 m with no throw/NaN.
_Fix:_ strict numeric parse (`parseFloat` or regex) before `Number()`, then bounds-check.

**XXE / billion-laughs — INFO (safe, verified).** `gpx.ts:14-17` `new XMLParser({ ignoreAttributes:false, attributeNamePrefix:'@_' })`; on installed fast-xml-parser 5.8.0 external entities throw "External entities are not supported" and nested entities are not expanded.
_Fix:_ none required. Consider an upper version bound and an explicit DOCTYPE/`processEntities` option so the safe default cannot drift; add a regression test.

**SSRF — INFO (assessed, not vulnerable).** Upstream hosts are constant literals (`openMeteo.ts:43,57,120`, `smhi.ts:15`, `metNorway.ts:12`); only coords (finite + bounded) and a regex-gated date reach URLs; SMHI path uses `toFixed(6)`. No action.

**Command/shell injection — INFO (not present).** `buildCiq.ts:35,77` use `execFileSync` array argv with no `shell:true`; monkeyc args are module constants. No action.

**Secrets — INFO (clean).** `.gitignore:31` `ciq/developer_key.der`; `git check-ignore` rc=0, untracked, `-rw-------` (0600). No tracked `.der/.key/.pem/.env/.npmrc`. No action.

**API: no rate limit/auth — HIGH.** `handler.ts:69` calls `gatherWindSamples` with no auth/rate-limit; `fetchAll.ts:80-85` does 1 batched + 3×N per-point fetches, MAX_POINTS=64 → up to 193 upstream fetches per cache miss; `vercel.json` has no WAF/middleware.
_Fix:_ per-IP rate limit (Vercel WAF / Edge middleware / KV token bucket) + upstream concurrency/quota budget; prioritize cache-busting callers.

**API: date range / cache-busting — MEDIUM.** `handler.ts:26,42` validate shape only; date forwarded verbatim upstream; coords accepted at full precision server-side (`weatherClient.ts` rounding is client-only).
_Fix:_ clamp date to `today..today+N`; snap coords to a 0.1° grid server-side.

**API: no fetch timeout — MEDIUM.** `fetchAll.ts:45,55,65` and `openMeteo.ts:151` call `fetch` with no signal; a hang blocks until platform timeout (and `Promise.all` stalls the whole request).
_Fix:_ AbortController + 5–8s per-fetch timeout failing into the existing catch-and-return-`[]` path.

**API: upstream JSON trust — LOW.** `parseOpenMeteo` indexes parallel arrays bounded only by `times.length` (`openMeteo.ts:86`); `pressures[i]*100` is NaN when missing. Upstreams are trusted hosts so this is graceful-degradation, not injection.
_Fix:_ `Number.isFinite` guards + array-length parity before pushing samples.

**CORS — INFO.** `weather.ts:8-9` sets only Cache-Control + Content-Type; no ACAO. Correct for same-origin; optionally document as intentional.

**Supply chain — MEDIUM/INFO.** `@vercel/node ^5.8.12` (`package.json:26`, devDependency) pulls 9 advisories (undici, path-to-regexp, minimatch, ajv, smol-toml) but is **type-only** in `api/weather.ts:1`; the serverless fetch path uses global `fetch`, not bundled undici, so this is build-time, not production-runtime. `npm audit fix` clears smol-toml only; everything else needs the breaking `@vercel/node@4.0.0` downgrade — do **not** blindly force it.
Runtime deps (`@garmin/fitsdk 21.205.0`, `fast-xml-parser 5.8.0`, react 19) are current and clean. Lockfile is single (`package-lock.json`), all https+sha512, 512 entries. Install hooks limited to esbuild + lefthook (both expected).

### 3.2 Correctness

**Descent solver wrong-root — CRITICAL/HIGH (the headline bug).**
`riderNpAtSpeed(v)` is non-monotone on steep descents/strong tailwinds because `pedalPower` 4th-powers braking (negative) power. `solveSpeedForRiderNp` (`chaingang.ts:304-327`) bisects assuming monotonicity (comment at line 302) and lands on the slow root.

> _Evidence:_ `solveSpeedForRiderNp(163,-0.08)=2.253 m/s`; runInnerSolve on a −8% seg at np=100 → 4.9 km/h; on the real route 118 microsegments crawl (median 14.9, min 4.3 km/h), and a −5.4% seg solves 16.1 km/h vs correct ~67.2 km/h.
> _Fix:_ solve only the physically relevant high-speed root (scan down from `hi`, or apply the spin-out/`vMax` ceiling before solving and search `[0.5,vMax]`); clamp displayed `p_pull_w/p_draft_w/p_mean_w ≥ 0` unconditionally (currently spinout-only at `planner.ts:218-225`); fix the monotonicity comment at `chaingang.ts:302`. Add a regression asserting plan speed is non-decreasing as grade decreases / tailwind increases.

**Negative pedal power leaks into SegmentPlan — MEDIUM.** The `≥0` clamp runs only when `cap_binding==='spinout'` (`planner.ts:218-225`); a tailwind/freewheel segment shows `p_pull_w=-100.7` etc.
_Fix:_ clamp all three power fields ≥0 for every segment (or document negative = coasting).

**Timezone misalignment — HIGH.** `start_time` is local (CEST=UTC+2 summer); `planner.ts:463` passes raw local clock; `ensemble.ts:237` computes a local hour-of-day and compares against UTC cell hours (`openMeteo.ts:41` `timezone:'UTC'`, `ensemble.ts:251-252`) with no offset. Systematic ~2h shift.
_Fix:_ convert local start to UTC before `queryHour`, or fetch+bin all weather in Europe/Stockholm.

**Single-day fetch window — MEDIUM→LOW (adjusted).** Open-Meteo URLs hard-code `start_date=end_date=date` (`openMeteo.ts:41-42,54-55,117-118`) and cells are keyed by hour-of-day, conflating day N and N+1. SMHI/MET are not date-clamped and do cover post-midnight hours, so impact is reduced-source-after-midnight, not total loss.
_Fix:_ span `date..date+1` when the plan crosses midnight; key cells by full date+hour.

**`n_riders=0` poisons power/NP — MEDIUM.** `config.ts:68` `n_riders ?? 12` with no lower bound; `fFront(0,..)=Infinity`, `meanPower(...)=NaN`, `npMomentsFor` divides by 0.
_Fix:_ validate integer `n_riders ≥ 1` in `applyDefaults`.

**Empty/zero-length route → `total_time_s=0, reachable=true` — LOW.** `runInnerSolve([])`/`solveForTargetTime([])` return a silent zero-time "reachable" plan (`planner.ts:314,344,364`).
_Fix:_ guard empty microsegments / zero distance early; surface `reachable=false`.

**Malformed time strings → NaN — LOW/HIGH.** `time.ts:10-22` `split(':').map(Number)`; `applyDefaults` accepts `start_time:'4'`/`target:'oops'`; NaN target makes every comparison false so `solveForTargetTime` returns a meaningless "reachable" plan.
_Fix:_ validate `^\d{1,2}:\d{2}$` and finiteness in `applyDefaults`; throw.

**Segmentation merges — MEDIUM/LOW.**

- _Control towns dropped (MEDIUM):_ `mergeDisplaySegs` returns `town: b.town` (`segmentation.ts:227`); min_segment (417-444) and max_segments (483-506) merges guard only `stop_minutes`, not `a.town` (unlike grade-merge at 467). Reproduced "Mid" vanishing. _Fix:_ add the town guard or `town: a.town ?? b.town`.
- _Note inconsistent with avg_grade (MEDIUM):_ avg_grade recomputed (line 183) but note picked from dominant half (line 193) without re-deriving vs `climb_threshold`; reproduced `note='SISTA UPPFÖR'` with grade 0.025 < 0.03. _Fix:_ re-derive note from merged grade/headwind, or refuse to merge differing notes.
- _SISTA UPPFÖR patched before merges (LOW):_ patch at 391-408 runs before merges; a final climb can be absorbed and lose its label. _Fix:_ move the patch after all three merge passes.
- _avg_speed_kmh rounding drift (LOW):_ time reconstructed from already-rounded speed (216-220); ~0.022 km/h over 10 merges, below display resolution. _Fix:_ carry unrounded time/speed for merge math.
- _avg_w neutral-distance weighting (LOW):_ avg_w over effort segs only (114,119) but weighted by full distance incl. neutral (104,199); affects only the opening ~1 km. _Fix:_ weight by effort distance.
- _Colliding control/stop snaps (LOW):_ `controlAtCum`/`stopAtCum` are last-writer-wins maps (369-381); only collides for misconfigured near-identical stops. _Fix:_ detect snap collisions and warn/nudge.

**`buildSplitTable` km-vs-name desync — LOW.** `splits.ts:54` uses `s.km` for cumulative stop time but `splits.ts:64-65` looks up per-leg stop by control name; can desync if `Stop.km` disagrees with the control km. Solo path (`cli.ts:230`) is immune.
_Fix:_ key both lookups off the same identity, or validate `Stop.control`/`Stop.km` at config load.

**CLI vs web divergence — MEDIUM (cross-cutting).** Web builds controls via `controlsFromStops` (`pipeline.ts:125-134`); CLI non-solo returns fixed `VATTERN_CONTROLS` (`cli.ts:226`). Controls drive segmentation, splits, and baked course points, so the same inputs yield divergent display/depots/course. Also CLI never applies baked per-segment exposure (`grep exposure` in cli.ts = 0) while web calls `applyExposure` (`pipeline.ts:176-178`).
_Fix:_ share one control-derivation function; apply the exposure JSON in the CLI default path or document the divergence.

**Markdown table injection — LOW.** `tempokort.ts:160-170` emits `| ${cells.join(' | ')} |` with `seg.town`/`seg.note` verbatim; `escHtml` never escapes `|`. A town/note containing `|` corrupts the GFM table.
_Fix:_ escape `|` (and newlines) for Markdown cells; add a pipe-in-name test.

### 3.3 Performance

**makeWeatherFn O(cells) haversine scan per query — HIGH.** The returned closure scans all cells (`ensemble.ts:249-250`) on every query; measured ~19.8M haversine evals per solve, ~59M across 3 scenarios; `solveThreeScenarios` wind run = 8787 ms; this is the dominant cost.
_Fix:_ build a `Map` keyed by `${roundCoord(lat)}|${roundCoord(lon)}|${hour}` once (cells already on that grid); O(1) lookup with a bounded-radius fallback preserving the combined-score nearest-cell choice. Expected 1–2 orders of magnitude.

**432KB example GPX inlined into the bundle — MEDIUM.** `defaultRoute.ts:8` `?raw` import inlines 432.7 KB parsed as JS at startup; held in state (`UploadForm.tsx:123`).
_Fix:_ move under `apps/web/public/` and `fetch()` lazily.

**GPX parsed twice per solve — MEDIUM.** `App.tsx:77` (main thread, weather sampling) and `pipeline.ts:170` (worker) both call `ingestGpxString` on the same text; measured ~34 ms each.
_Fix:_ pass the ingested micro array into the worker, or cache the parse keyed by the GPX string.

**solveThreeScenarios no warm-start — MEDIUM→ adjusted.** Three full bisections from `[60,ftp]` (`planner.ts:466-493`); the "add early termination" lever is already implemented (early return at `planner.ts:364`, ~6 marches/solve). The genuine lever is warm-starting optimistic/pessimistic from the expected np bracket.
_Fix:_ seed the two satellite scenarios' brackets near the expected np.

**Segmentation merge passes superlinear — LOW.** Three `while(changed){…break}` full-restart scans with slice rebuilds (`segmentation.ts:414-476,505`); measured 6.85 ms, not a current bottleneck.
_Fix:_ single left-to-right sweep (or priority queue) for O(n log n).

**Inner NP bisection / stop insertion / parser allocation — LOW.** `solveSpeedForRiderNp` already early-returns (`chaingang.ts:318`), `riderNpAtSpeed` is O(1); stop insertion is O(S·N) but negligible (~20 marches/run); `parseGpxString` constructs a new `XMLParser` per call (~38 ms). All low priority; hoist the parser to module scope.

### 3.4 Test depth

| Severity | Gap                                                                                        | Add                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| High     | `reachable=false` never exercised (`planner.ts:343-353`)                                   | impossible-target test → `reachable===false`, `np_target_used===ftp`, note present                  |
| Medium   | Outer-solver monotonicity untested (only final-time tolerance)                             | property test: `total_time_s` non-increasing as npTarget ↑; higher-FTP ⇒ lower-or-equal time        |
| Medium   | No NaN/Infinity/degenerate tests on physics/solvers; `airDensity` moist branch unexercised | boundary clamp tests at `[0.5,25]`; moist-air `airDensity`; finiteness guard                        |
| Medium   | Weather all-sources-down not driven through planner                                        | pass `{cells:[]}` into `solveThreeScenarios`; assert 3 identical reachable calm scenarios           |
| Medium   | Web pipeline smoke-only, no golden-master                                                  | calm golden-master on `examples/sample-route.gpx`; headwind ⇒ higher pessimistic np                 |
| Medium   | Merge heuristics: short-segment / maxSegments correctness unasserted                       | no short stop-free segment survives; control town survives min-merge; depot-boundary break          |
| Low      | `makeWeatherFn` multi-cell selection untested                                              | two cells; near-A returns A; midnight-wrap picks wrapped-nearest                                    |
| Low      | `mergeDisplaySegs` lossy aggregation unvalidated                                           | merged avg_w = distance-weighted mean; band ratio preserved                                         |
| Low      | GPX malformed/edge inputs untested                                                         | missing `<ele>`, single point, all-duplicate points (test file is `packages/cli/tests/gpx.test.ts`) |
| Low      | No coverage provider installed                                                             | add `@vitest/coverage-v8` + thresholds for `packages/core`                                          |
| Low      | 1 skipped real-FIT test (`fit.test.ts:91`)                                                 | commit a small anonymized FIT fixture                                                               |

**Zero-test web modules:** `solve.worker.ts`, `useSolver.ts`, `weatherClient.ts` (`buildPtsParam`/`fetchEnsemble`), `download.ts`, plus UI components (prioritize `UploadForm`, `WeatherPanel`). Core modules are all covered (directly or via `@stp/core`).

### 3.5 Type safety

- **`noUncheckedIndexedAccess` OFF — MEDIUM.** `tsconfig.base.json:6` has `strict:true` but not this flag; parallel-array reads (`openMeteo.ts:91`), gpx parse, percentile index reads all type as non-undefined. _Enable it._
- **Unvalidated external JSON typed via `as`/`any` — MEDIUM (multiple).** `weatherClient.ts:22` casts `res.json()` to `EnsembleField`; `openMeteo.ts:72`/`smhi.ts:32`/`metNorway.ts:52` take `json:any`; `loadConfig.ts:14` and `cache.ts:81-82` cast disk JSON; `UploadForm.tsx:100` casts localStorage. _Add one runtime-validation layer (zod/valibot) at each boundary._
- **GPX `as Record<string,unknown>` chain — HIGH.** `gpx.ts:18,20,27,41`; missing `<gpx>` throws TypeError, `Number(pt['@_lat'])` yields NaN. _Presence checks + finiteness._
- **`exactOptionalPropertyTypes` OFF — LOW.** e.g. `config.ts:89` `np_target` (`types.ts:26` optional). Optional.
- **FIT casts — LOW/MEDIUM (acceptable).** `fitWorkout.ts:51` `as unknown as` is a documented SDK escape hatch; `fit.ts:18` re-annotates to `unknown` and filters; `garmin-fitsdk.d.ts:15` types `messages` as `Record<string,any[]>` — narrow to `unknown[]`.
- **Cast inventory:** 77 `as` (mostly `as const`/type imports), 8 `:any` (6 in weather parsers, 2 in tests), 1 `as unknown`, **0** `@ts-ignore`/`@ts-expect-error` (good).
- **Vercel `req.query` cast — LOW (backed by real validation in `parseWeatherQuery`).**

### 3.6 Resilience

- **parseOpenMeteo NaN samples — HIGH** (`openMeteo.ts:86-98`): only parser not skipping incomplete rows (cf. `smhi.ts:47`, `metNorway.ts:65`). _Skip non-finite; default temp/pressure._
- **buildEnsemble no NaN sanitation — HIGH** (`ensemble.ts:145-179`): one bad sample NaN-poisons the whole cell incl. p10/p90 sort. _Filter finite before aggregation._
- **Physics/planner zero NaN guards — HIGH** (`physics.ts:23-62`): NaN steers the bisection silently. _Treat non-finite WindCond as calm._
- **runInnerSolve divide by speed — MEDIUM** (`planner.ts:133-134`): `neutral_speed_kmh=0` → `time_s=Infinity`. _Guard v>0/validate._
- **App.doFetch mislabels GPX parse error as "Hämtning misslyckades" — MEDIUM** (`App.tsx:62-90`): ingest is inside the weather-fetch try/catch. _Separate parse from fetch._
- **doFetch silent swallow — MEDIUM** (`App.tsx:87-89`): `catch {}` discards HTTP status/parse error. _Bind, log, render._
- **Download builders no try/catch — MEDIUM** (`Downloads.tsx:41-69`): a builder throw is an uncaught handler error / dead button. _Wrap + inline error._
- **Per-source catches fully silent — LOW** (`fetchAll.ts:43-71`): persistent outage invisible. _console.warn source+error._
- **Endpoint 200 on all-sources-down — LOW** (`handler.ts:69-75`): "calm" indistinguishable from "all down". _Signal source health explicitly._
- **Empty web pipeline → degenerate plan — LOW** (`pipeline.ts:144-208`). _Reject too-short routes._
- **readCache no try/catch — LOW/MEDIUM** (`cache.ts:81-82`): corrupt cache crashes the run incl. `--offline`. _try/catch → treat as miss._
- **solveSpeedForPower silent midpoint — LOW** (`physics.ts:45-62`): returns boundary on non-convergence. _Detect non-convergence; short-circuit non-finite inputs._
- **`fetchOpenMeteo` missing `res.ok` — LOW (dead code)** (`openMeteo.ts:176-191`): used only by tests; live path checks `res.ok`. _Delete or add guard._
- **mapLimit no per-task error isolation — LOW** (`fetchAll.ts:21-39`): latent if a future `fn` throws. _Document or capture per-item rejections._
- **Worker failure surfaces only a generic string; no run-id — MEDIUM** (`useSolver.ts:57-71`): stale-run replies can mismatch; internal strings leak. _Tag runs; map known errors to Swedish._
- **50-step throw is an implicit cross-module invariant — MEDIUM** (`fitWorkout.ts:121-126`): long uploaded routes can throw uncaught on download. _Defensive merge/truncate + boundary test._

### 3.7 Best practices

- **`segment()` god function (~240 LOC, 7 passes) — MEDIUM** (`segmentation.ts:273-509`). Extract `computeBoundaries/buildGroups/patchLastClimb/mergeShortSegments/mergeSameGrade/mergeToMax`; share one `mergeUntilStable(predicate)`.
- **`runInnerSolve` ~157 LOC — MEDIUM** (`planner.ts:96-253`); **`runPlan` ~124 LOC — MEDIUM** (`cli.ts:88-212`); **`UploadForm` 364 LOC — MEDIUM** (`UploadForm.tsx:86-364`). Extract helpers / `usePersistedForm` / `<StopsEditor>`.
- **Duplication:** `soloControls` vs `controlsFromStops` incl. `'Mal'`/`'Mål'` typo (`cli.ts:225-234`, `pipeline.ts:125-134`) — MEDIUM; nearest-boundary scan in 4 sites (`segmentation.ts:52-63` + splits/course) — LOW; `calmThreeScenarios` (`cli.ts:78-96` / `pipeline.ts:102-116`) — LOW; styrkort HTML vs React mappers (already drifting on `stop_minutes` guard, `tempokort.ts:297` vs `TempokortTable.tsx:111`) — LOW; `secondsTo*` formatters (4× H:MM incl. `time.ts:43-47`, `tempokort.ts:28-32`, `format.ts:9-14`) — INFO. Consolidate into `@stp/core`.
- **Stale/self-contradicting comment in `mergeDisplaySegs` — LOW** (`segmentation.ts:185-213`); reverse-engineers `band_pct`. Thread `cfg.band_pct` in.
- **Magic values — LOW/INFO:** note keywords (`segmentation.ts:139-154`), solver constants (`planner.ts:338,360,364`; `chaingang.ts:315,318`; `physics.ts:54,57`; `segmentation.ts:482`), hardcoded `315` depot cutoff (`UploadForm.tsx:56`), App fallback date/time literals that disagree with `FORM_DEFAULTS` (`App.tsx:56,128` vs `UploadForm.tsx:69,74-75`). Hoist to named constants / shared defaults.
- **Out-of-order step comments in `runPlan` — LOW** (`cli.ts:164,168,178`): step 8 precedes step 7.
- **Scenario equality by `===` identity — LOW** (`App.tsx:259-262`): relies on shared object reference surviving postMessage (works today). Surface an explicit boolean.
- **`fFront` unused `pullSeconds` param — INFO** (`chaingang.ts:14-18`); **reference-only exports** `riderNpSquareWaveReference`, `fetchSmhi`/`fetchMetNorway` re-exports — INFO.

### 3.8 Build / CI

- **No lint step in CI — MEDIUM** (`ci.yml:15-17`): ESLint config + `lint` script exist (`package.json:17`) but CI runs only typecheck/test/build; lint is enforced only via a bypassable lefthook hook. _Add `npm run lint`; promote correctness rules from warn→error._
- **`api/` typecheck FAILS — HIGH** (`api/weather.ts:1`, TS2307 `@vercel/node` not installed). _Install + include api/ in CI typecheck._
- **CLI standalone typecheck 31 errors — LOW (config artifact, not real bugs):** rootDir/TS6059 + missing `.d.ts` on cli test include path. Clean under root tsconfig.
- **No Node pin — LOW** (no `engines`, no `.nvmrc`; `ci.yml:12` hardcodes Node 22; Vercel/local unconstrained). _Add `engines.node` + `.nvmrc`._
- **No audit gate, no Dependabot/Renovate — LOW** (`ci.yml:14`). _Add `npm audit --audit-level=high` + Dependabot._
- **No coverage gate — LOW** (`vitest.config.ts:13-34`). _Add `test.coverage` v8 thresholds._
- **Vercel `npm install` not `npm ci` — LOW** (`vercel.json:5`). _Use `npm ci`._
- **No `functions` block (runtime/maxDuration) — LOW** (`vercel.json:1-6`); compounds the no-fetch-timeout finding. _Pin `nodejs22.x` + `maxDuration`._
- **CI runs on every push, no concurrency/path filter — LOW** (`ci.yml:2-4`). _Add concurrency + scope push._
- **No `permissions:` block — LOW** (`ci.yml`). _Add `permissions: { contents: read }`._
- **Actions pinned to mutable major tags — LOW** (`ci.yml:9-10`). _Pin to SHAs._
- **Stray pnpm files — INFO** (gitignored, untracked; `vercel.json` pins npm). Optional local cleanup.
- **Non-deterministic `encodeWorkout` date — HIGH** (`fitWorkout.ts:155`, cross-cutting). _Use fixed `BASE_MS`._

### 3.9 Privacy

All confirmed positive / low-risk:

- **Files stay in-browser — INFO** (`UploadForm.tsx:183,195`); only egress is `/api/weather` with derived coords. Swedish privacy note at `App.tsx:195-199`.
- **Coords rounded to 0.1° before egress — INFO** (`weatherClient.ts:4-6`); note `sampleCellPoints` (`sample.ts:24`) emits full precision, so rounding is client-request-boundary only — optionally round there too for defense-in-depth.
- **Coords forwarded to SMHI/MET/Open-Meteo — LOW** (`fetchAll.ts:43-88`): coarse, identifier-free, already disclosed (`App.tsx:198`, `README.md:111`).
- **Real 315 km GPS track committed/bundled — LOW** (`examples/vattern-315.gpx`, 4820 pts, full precision; `defaultRoute.ts:8`): start/finish cluster in Motala (public event area). _Confirm in docs it is the public event course; if personal, trim start/end._
- **localStorage stores rider params only — INFO** (`UploadForm.tsx:64-112`, key `stp_form_v1`; FTP/mass/stops, no route/file bytes).
- **No analytics/trackers/CDN/fonts — INFO** (sole fetch is first-party `/api/weather`).

### 3.10 Accessibility / UX

- **Split primary action — MEDIUM** (`UploadForm.tsx:569-571` "Använd inställningar" only calls `onRun`→`setLastForm`; real solve is "Beräkna plan" `App.tsx:225-234`). _Relabel/de-emphasize or merge CTAs._
- **Stops table inputs unlabeled — MEDIUM** (`UploadForm.tsx:519-562`, no aria-label, `<th>` no scope). _Add aria-labels + `scope="col"` + sr-only actions header._
- **Spinner not announced — LOW** (`UploadForm.tsx:575`, no `role=status`/`aria-busy`; label is already Swedish "Beräknar"). _Wrap in `role="status" aria-live="polite"`._
- **Remove-stop buttons not distinguishable — LOW** (`UploadForm.tsx:555-557`, identical "Ta bort"). _Per-row aria-label._
- **Weather mode toggle no `aria-pressed` — LOW** (`WeatherPanel.tsx:42-53`, color-only active state). _Add `aria-pressed` / radiogroup._
- **Wind direction input no clamp/normalize, decorative arrow not aria-hidden — LOW** (`WindHourTable.tsx:42-58`). _Normalize `((v%360)+360)%360`; `aria-hidden` the arrow._
- **"Applicera på alla timmar" destructive, no confirmation — LOW** (`WeatherPanel.tsx:120-122` → `App.tsx:110-115` clears overrides silently). _Emit a `role=status` confirmation._
- **No `:focus-visible` for custom buttons; disabled = opacity only — LOW** (`styles.css:188-191,316-328`). _Add focus-visible outlines._
- **Big tables scroll horizontally, no sticky header/affordance — LOW** (`SplitTable.tsx:20`, `styles.css:234-236`; mitigated by `col-secondary` hiding ≤640px at `styles.css:628-643`).
- **Free-text time inputs, no inline validation — LOW** (`UploadForm.tsx:316-324,330-338`). _Add `inputmode`, `pattern`, `aria-invalid`._
- **Compact/full Tempokort toggle low-discoverability — LOW** (`TempokortTable.tsx:84`); stop-row color cue is **already** paired with ☕ + CSS class (color-only claim refuted). _Optionally a visible segmented control._
- **No skip link / focus management after solve — INFO** (`App.tsx:161-266`; `done-banner` static, not live region). _Move focus to results / add "Hoppa till plan"._

### 3.11 Docs / i18n

- **README "web and local result are identical" misleading — LOW** (`README.md:5`): physics identical, but control/split table differs unless CLI runs `--solo` (`cli.ts:226`). _Qualify the claim._
- **CLI finish "Mal" (ASCII) vs web accented — LOW** (`cli.ts:232`, solo-mode only). _Use the accented form._
- **MODELL stale test count — LOW** (`MODELL.md:112`: 252→354, both attributed to point-in-time build reports). _Prefer named gates over absolute counts._
- **README "data is gitignored / bring your own" stale — LOW** (`README.md:47`): a real 315 km route now ships in `examples/` and is the web default (`defaultRoute.ts:8`). _Mention it._
- **Stray pnpm files contradict npm-only policy — LOW** (gitignored/untracked; real content, not placeholder). _Optional local cleanup._

### 3.12 Connect IQ (Monkey C) — coverage gap

- **Whole `NextControlPace.mc` (349 LOC) is an untrusted-input boundary with no prior findings — MEDIUM** (`ciq/source/NextControlPace.mc:1-349`, currently modified). _Audit `parsePlannedSec`, `isRelativeName`, `fmtClock`, segment-change heuristics._
- **`parsePlannedSec` whole-name scan mis-parses digits in town names — MEDIUM (cross-cutting)** (`NextControlPace.mc:93-108`; names are `${cp.name} ${timeLabel}` from `fitCourse.ts:147`). _Anchor parse to the trailing token / sanitize names._
- **`parsePlannedSec` drops plan delta ≥24h — LOW** (`NextControlPace.mc:93-108`; `secondsToElapsed` has no 24h cap, `time.ts:43-48`). _Relax `hh<24` in relative mode or cap the label._
- **`fmtClock`/relative delta wrap assumptions — LOW** (`NextControlPace.mc:186-205,240-244`). _Spec/test multi-hour relative deltas._
- **CIQ + course hard-wired to `fenix7x` — MEDIUM** (`manifest.xml:6`, `buildCiq.ts` DEVICE) while the web offers the download universally. _Add products or document the limitation._
- **course.fit non-monotonic timestamps / colliding course points when controls snap to the same micro — LOW** (`fitCourse.ts:134-150`). _Detect+merge/nudge; assert strictly increasing distances._
- **NaN lat/lon/ele flow into FIT semicircle/altitude → corrupt-but-valid course file — MEDIUM** (`fitCourse.ts:34-36,127-129`). _Validate finiteness at ingest and before encoding._
- **`buildCourseFit`/`nearestMicroIndex` crash on empty/single-segment route — MEDIUM** (`fitCourse.ts:70-110`, `course.ts:37-48`; `nearestEtaS` guards length but `nearestMicroIndex` does not). _Guard `microsegments.length`._

### 3.13 Other confirmed cross-cutting

- **Observability — MEDIUM:** zero `console.*` in `packages/core`/`api`; no request id, no per-source success metric (`fetchAll.ts:43-71`). _Structured per-source + per-request logs._
- **MET Norway User-Agent version drift — LOW** (`metNorway.ts:31` `StickToThePlan/1.0` while packages are 0.1.0). _Source version from package.json._
- **Web `hours.ts` raceHours/centroidOf unvalidated + local-vs-UTC binning — MEDIUM** (`hours.ts:3-21`). _Validate h:mm; resolve TZ explicitly._
- **`applyExposure` half-open-interval gaps, coverage never asserted — LOW** (`exposure.ts:23-34`). _Close last interval; warn on low coverage._
- **`doFetch` builds weather config without exposure/height/default-route flags — LOW** (`App.tsx:66-84`). _Share one config builder with runPipeline._
- **`buildManualField` hardcodes temp 10 °C / pressure 101325 Pa, treats manual hours as UTC — LOW** (`hourly.ts:78-99`).
- **`controlsFromStops` fractional Mål km vs exact-km match in `buildCourseGpx` — LOW** (`pipeline.ts:125-134`). _Add a test exercising web-style controls._
- **`downloadBlob` no error handling / no try/finally URL revoke — LOW** (`download.ts:13-23`).
- **`fetchExposureForRoute` stub throws by design — INFO** (`exposureClient.ts:23-28`). _Verify the trigger stays disabled._
- **Validation absent uniformly at every boundary — MEDIUM (root cause):** one zod layer at GPX point / FIT sample / RawConfig / each weather payload / API query / web form / worker `PipelineInput` collapses the NaN/crash long tail.

---

## 4. Suggested test additions

Property-based, golden-master, and fuzz-regression suites, with concrete files:

- `packages/core/tests/planner.reachable.test.ts` — impossible target (flat 100 km @ `'1:30'`) → `reachable===false`, `np_target_used===ftp`, note contains "not reachable sustainably".
- `packages/core/tests/planner.monotonicity.prop.test.ts` — sample `npTarget∈[60,ftp]`: `runInnerSolve(...).total_time_s` non-increasing; higher FTP ⇒ lower-or-equal time; **and** plan speed non-decreasing as grade decreases / tailwind increases (descent-root regression).
- `packages/core/tests/chaingang.descent.test.ts` — assert `solveSpeedForRiderNp` picks the high-speed root on −6%/−8% grades and strong tailwinds (lock the fix for the critical bug).
- `packages/core/tests/physics.degenerate.test.ts` — `solveSpeedForPower`/`solveSpeedForRiderNp` boundary clamps at both ends of `[0.5,25]`; `airDensity` moist-air case; `pedalPower` finiteness on extreme in-range inputs; `airDensity` rejects T≤0 K / negative density.
- `packages/core/tests/weather.ensemble.calm.test.ts` — `{cells:[],sources:[],reduced:true}` into `solveThreeScenarios` → 3 identical reachable calm scenarios (10 °C / sea-level).
- `packages/core/tests/weather.openMeteo.partial.test.ts` — truncated/null hourly arrays produce no NaN samples; length-parity guard.
- `packages/core/tests/weather.timezone.determinism.test.ts` — run with `TZ=UTC` vs `TZ=America/Los_Angeles`, assert identical field selection (locks the timezone fix).
- `packages/cli/tests/gpx.fuzz.test.ts` — golden corpus of fuzz inputs: empty-string lat (no Null Island), NaN coord (no whole-route drop, no crash), `<rte>`/`<wpt>`-only, multi-trkseg, missing/duplicate `<ele>`, single point, all-duplicate points, size/point caps; plus a negative XXE/billion-laughs regression asserting external entities throw.
- `packages/core/tests/fit.fuzz.test.ts` — NaN/Infinity/negative/uint16-wrap power → finite, plausibly-bounded `np_target_candidate`; corrupt FIT surfaced (not silently FTP-fallback); `plan.json` anchor never null.
- `api/tests/handler.fuzz.test.ts` — non-string/null `pts`/query → 400 not 500; semantically-invalid dates rejected; hex/whitespace coords rejected; confirm the safe-corpus boundaries.
- `packages/core/tests/segmentation.merge.test.ts` — no short stop-free segment survives min-merge; control town survives min/max merges; final climb keeps `SISTA UPPFÖR`; merged `avg_w` = distance-weighted mean.
- `packages/core/tests/tempokort.markdown.test.ts` — town/note containing `|` does not corrupt the GFM table.
- `packages/core/tests/fitWorkout.deterministic.test.ts` — byte-level golden master (asserts no `new Date()` drift).
- `packages/core/tests/fitCourse.degenerate.test.ts` — empty/single-segment route throws a clear error, not a TypeError; NaN coords rejected before encoding.
- `apps/web/tests/useSolver.test.ts` + `apps/web/tests/weatherClient.test.ts` — worker success/error/run-id; `buildPtsParam` rounding and `fetchEnsemble` non-ok throw.
- Commit a small anonymized FIT fixture so `packages/cli/tests/fit.test.ts:91` no longer skips.

---

## 5. Recommended remediation order

**Phase A — Quick wins (low effort, high value):**

1. Install/pin `@vercel/node`; run `npm ci`; add `api/` + `npm run lint` to CI (`ci.yml`). Unblocks the failing typecheck and a real lint gate.
2. Make `encodeWorkout` deterministic (fixed `BASE_MS`, `fitWorkout.ts:155`).
3. Add AbortController + 5–8s timeout to upstream fetches (`fetchAll.ts:45,55,65`) and a `functions` `maxDuration` in `vercel.json`.
4. Clamp displayed power ≥0 for all segments (`planner.ts:218-225`).
5. Add the town guard to the min_segment/max_segments merges (`segmentation.ts`).
6. Switch Vercel to `npm ci`; add Node pin (`engines` + `.nvmrc`), CI `concurrency`, `permissions: { contents: read }`, `npm audit --audit-level=high`.

**Phase B — High-risk correctness (do before any re-baseline of validation numbers):** 7. **Fix the descent wrong-root** in `solveSpeedForRiderNp`/`solveSpeedForPower` and the monotonicity comment (`chaingang.ts:304-327`, `physics.ts:45-62`); land the descent regression tests first (TDD). 8. **Fix timezone misalignment** (`ensemble.ts:237` + `planner.ts:463`); add the cross-TZ determinism test. 9. Add finiteness/bounds validation at the GPX point boundary and the missing-`<ele>` path; guard `dedupePoints` against NaN; reject empty/too-short routes (`gpx.ts:43-67`, `pipeline.ts`/`cli.ts`). 10. Sanitize FIT power (`Number.isFinite && 0–2000 W`) and assert finite `np_w` before it becomes an anchor (`fit.ts:14-46`). 11. Validate numeric config + time strings in `applyDefaults` (`config.ts:58-101`, `time.ts:10-22`): ftp≥60, m≥1, n_riders≥1, 0<eta≤1, neutral_speed>0, max_grade≥0, time `^\d{1,2}:\d{2}$`, stop.minutes≥0. 12. Add NaN sanitation in `parseOpenMeteo` + `buildEnsemble`, and a finite-WindCond guard at the physics boundary (`openMeteo.ts:86-98`, `ensemble.ts:145-179`, `physics.ts:23-62`). 13. Add per-IP rate limiting + server-side coord/date clamping on `/api/weather` (`handler.ts`). 14. Add input size/point caps before GPX parse (`gpx.ts:13-48`, `UploadForm.tsx`).

**Phase C — Refactors and breadth (after correctness is locked):** 15. Introduce a single zod/valibot runtime-validation layer at every trust boundary (collapses the remaining NaN/crash tail and the `any`/cast findings). 16. Performance: Map-index `makeWeatherFn` cells; lazy-load the example GPX; parse GPX once and pass micro to the worker; warm-start satellite scenarios. 17. Decompose `segment()`, `runInnerSolve`, `runPlan`, `UploadForm`; share `controlsFromStops`/`calmThreeScenarios`/duration formatters/nearest-boundary in `@stp/core`; reconcile `'Mal'`/`'Mål'`. 18. Audit `ciq/NextControlPace.mc` as a first-class boundary; fix `parsePlannedSec` name-scan and the device-pinning gap; guard FIT course encoders against degenerate routes and colliding course points. 19. Accessibility pass (labels, aria-pressed/live, focus management, focus-visible), docs/i18n fixes (README "identical" qualifier, example-route note), observability logging, and enable `noUncheckedIndexedAccess` + `@vitest/coverage-v8` thresholds.
