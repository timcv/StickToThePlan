# "Så funkar det" infographics A–F Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six new explainer sections (A–F) with hand-authored inline-SVG figures to the web app's "Så funkar det" page so it documents how the route is mapped into segments, plus five other model concepts that are currently undocumented.

**Architecture:** `apps/web/src/components/HowItWorks.tsx` is a single self-contained React component. It already defines reusable `Section`, `Formula`, `DeepDive` helpers and a `C` colour palette, and renders a sequence of `<Section>`s each with a hand-authored inline-SVG figure function. Each new concept is one new figure function + one new `<Section>` inserted into the existing JSX at a named anchor. No new components, props, routes, or CSS are needed: every `howto-*` class already exists in `apps/web/src/styles.css`, and the figures reuse the existing `C` palette and `<marker>` arrow pattern.

**Tech Stack:** React + TypeScript (Vite), inline SVG, existing `styles.css`. No new dependencies.

---

## Grounding (verified facts the copy must match)

All values verified against `packages/core` and `apps/web/src/lib/pipeline.ts` on 2026-06-11:

- **A Segmentation** (`packages/core/src/segmentation.ts`): the physics marches **micro-segments** (one per GPX point); the tempokort/Garmin show **display segments** that group them. Boundaries: control/depot stops, grade crossing `climb_threshold` 3%, headwind sign flips (>1 m/s magnitude), route start/end. Tidy-up merges: `min_segment_km` = 2 (short slivers merge to nearest `avg_w` neighbour), `grade_merge_pct` = 0.3% (near-identical grade rows merge), cap to `maxSegments` (50 full / `styrkort_max_rows` 20 compact). Depots and control towns are never merged across. Note keywords: `JÄMN FART / KLÄTTRING / SISTA UPPFÖR / BACKAR / TA DET LUGNT / ÖKA / DEPÅ`. Aggregation is **time-weighted**. **Web controls come from the user's depot stops** (`controlsFromStops`, `apps/web/src/lib/pipeline.ts:125`), i.e. Start + each stop's `control` + Mål, NOT a hardcoded town list.
- **B ETA clock** (`segmentation.ts:121,146-148`, `packages/core/src/util/time.ts`): each display segment carries `eta_s` = seconds from `start_time` at the segment END. A depot's `depart_s = eta_s + stop_minutes*60`. `secondsToClock(eta_s, startTime)` renders wall-clock and wraps past midnight. `PlanResult.total_time_s = rolling_time_s + stop_time_s`.
- **C GPX prep** (`packages/core/src/ingest/gpx.ts`, `types.ts`): coincident points are de-duplicated; elevation is smoothed with a moving average of window `ele_smooth_window` = 5; grade = Δele/Δdist clamped to ±`max_grade` (0.18 = 18%); the first `neutral_distance_km` (1 km) is a neutral block ridden at `neutral_speed_kmh` (20 km/h) outside the NP model (mass start).
- **D weather clock** (`packages/core/src/weather/ensemble.ts:283`): each segment's weather is sampled at its lat/lon AND the hour-of-day the rider reaches it: `queryHour = floor((startClockUTC + timeS) / 3600) % 24`. Weather is an ensemble aggregated into cells in **space and time**; a per-(lat,lon,hour) cache speeds the lookup. (`cache_ttl_h` = 3 governs the upstream fetch cache.)
- **E tempokort band + watch** (`types.ts` `band_pct` 0.05, `segmentation.ts:136-137`, `ciq/source/NextControlPace.mc`): the card's pull-watt column is a band `pull × (1 ± 5%)`, not a single number. The optional Garmin data field (`NextControlPace`) reads the loaded course live and shows next control, distance remaining, segment speed, ETA and ± minutes vs the planned time parsed from each course-point name.
- **F effort anchor** (`packages/core/src/ingest/fit.ts`, `apps/web/src/lib/pipeline.ts:180-187`): an optional FIT power file yields an anchor: a **long representative ride (>2 h)** uses that ride's normalized power directly; a short test or no file falls back to **0.60 × FTP**. Rider NP is group-size-independent (same anchor for 8 or 12 riders, spec 8.1). **In the web flow the anchor is informational** (surfaced in `plan.json`): `solveForTargetTime` still bisects NP in `[60, FTP]` to hit your target time. The copy MUST NOT claim the anchor sets the plan's pace.

---

## File Structure

- **Modify only:** `apps/web/src/components/HowItWorks.tsx`
  - Add 6 figure functions (`SegmentFigure`, `EtaClockFigure`, `RoadPrepFigure`, `WeatherClockFigure`, `CardWatchFigure`, `AnchorFigure`) alongside the existing figure functions (after `ScenarioFigure`, before `export function HowItWorks`).
  - Add 6 `<Section>` blocks inside the returned JSX at the anchors below.
- **No other files change.** No CSS (all `howto-*` classes exist in `apps/web/src/styles.css`). No new strings/props/routes.

### Final page order (existing sections unchanged, new ones interleaved)

1. Grundidén _(existing)_
2. **C — Från GPX till väg** _(new)_
3. Tre krafter du trampar mot _(existing)_
4. Luft, vind och terräng _(existing)_
5. **D — Vädret skiftar över dygnet** _(new)_
6. I grupp: lä och jämn ansträngning _(existing)_
7. **F — Vilken ansträngning planen håller** _(new)_
8. Hur vi räknar fram din tid _(existing)_
9. Tre vindscenarier _(existing)_
10. **A — Från rutt till tempokort** _(new)_
11. **B — Ankomst, depå och avgång** _(new)_
12. **E — Tempokortet och klockan på styret** _(new)_
13. footer _(existing)_

Insertion anchors are stable JSX strings (not line numbers), so tasks are order-independent — except the trailing trio (A, B, E) which all insert "before the footer" and MUST be applied in the order A → B → E so they stack 10/11/12.

### Shared conventions for every figure (match existing code)

- Signature `function XxxFigure() { return ( <svg ...>...</svg> ); }`.
- Root: `<svg width="100%" viewBox="0 0 680 H" role="img" aria-labelledby="figX-t figX-d">` with `<title id="figX-t">` and `<desc id="figX-d">` (unique ids per figure: use `seg`, `eta`, `road`, `wx`, `card`, `anchor`).
- Use ONLY palette `C.*` for colours. Reuse the arrow `<marker>` pattern from `ForcesFigure` (give each its own marker id).
- Wrap in a section via `<Section title=... figure={<XxxFigure />}>`.
- Deep dives use `<DeepDive>` with `howto-formula howto-formula-block` for multi-line formulas (newline-separated string children, exactly like existing deep dives).

---

### Task 1 (C): Section "Från GPX till väg"

**Goal:** Explain how the raw GPX becomes a clean road profile: point de-dup, elevation smoothing (window 5), grade clamp ±18%, and the neutral first km.

**Files:**

- Modify: `apps/web/src/components/HowItWorks.tsx` (add `RoadPrepFigure` after `ScenarioFigure`; insert `<Section>` before the `<Section title="Tre krafter du trampar mot"` block)

**Acceptance Criteria:**

- [ ] New `<Section title="Från GPX till väg">` renders between "Grundidén" and "Tre krafter du trampar mot".
- [ ] Figure shows a jagged raw elevation trace vs a smoothed line, a clipped steep spike, and a marked neutral first km.
- [ ] Copy names: punkt-dedup, glidande medel (5 punkter), lutning klampad ±18%, neutral första km 20 km/h.
- [ ] DeepDive states `ele_smooth_window=5`, `max_grade=0,18`, `neutral_distance_km=1`, `neutral_speed_kmh=20`.
- [ ] `npx tsc --noEmit -p apps/web/tsconfig.json` passes.

**Verify:** `npx tsc --noEmit -p apps/web/tsconfig.json` → "TypeScript compilation completed" / exit 0

**Steps:**

- [ ] **Step 1: Add the figure function** after `ScenarioFigure` (before `export function HowItWorks`):

```tsx
function RoadPrepFigure() {
  const raw =
    '40,120 90,96 140,128 190,84 240,150 290,92 340,116 390,70 440,150 490,104 560,88 640,108';
  const smooth = '40,116 140,112 240,118 340,100 440,108 560,96 640,104';
  return (
    <svg width="100%" viewBox="0 0 680 176" role="img" aria-labelledby="road-t road-d">
      <title id="road-t">Rå höjdkurva jämnas ut och brant lutning klampas</title>
      <desc id="road-d">
        En taggig rå höjdkurva med en utjämnad linje ovanpå, en avhuggen spik som visar
        lutningstaket, och en markerad neutral första kilometer.
      </desc>
      <rect x="40" y="40" width="80" height="120" fill={C.fill} opacity="0.7" />
      <text x="44" y="56" fontSize="11" fill={C.muted}>
        Neutral km
      </text>
      <polyline points={raw} fill="none" stroke={C.gray} strokeWidth="1.5" strokeDasharray="4 3" />
      <polyline
        points={smooth}
        fill="none"
        stroke={C.accent}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <line
        x1="380"
        y1="70"
        x2="400"
        y2="64"
        stroke={C.coral}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <text x="392" y="56" fontSize="12" fill={C.coral}>
        klampad till ±18 %
      </text>
      <text x="44" y="172" fontSize="12" fill={C.gray}>
        Rå GPX-höjd
      </text>
      <text x="640" y="172" fontSize="12" fill={C.accent} textAnchor="end" fontWeight="600">
        Utjämnad profil
      </text>
    </svg>
  );
}
```

- [ ] **Step 2: Insert the Section** immediately before `<Section title="Tre krafter du trampar mot" figure={<ForcesFigure />}>`:

```tsx
<Section title="Från GPX till väg" figure={<RoadPrepFigure />}>
  <p>
    Din GPX är en lista med punkter. Vi rensar dubblerade punkter, jämnar ut höjden med ett glidande
    medel så att barometerbrus inte blir falska backar, och delar rutten i hundratals små bitar. För
    varje bit räknar vi lutningen ur höjdskillnaden, och klampar orimligt branta värden så att en
    GPS-spik inte blåser upp effektkravet. Första kilometern är neutral: en lugn rullstart på 20
    km/h utanför ansträngningsmodellen, precis som masstarten.
  </p>
  <Formula caption="Utan utjämning skulle varje liten höjdvariation läsas som en backe och störa effektberäkningen.">
    lutning = höjdskillnad ÷ sträcka, klampad till ±18 %
  </Formula>
  <DeepDive>
    <p>Höjden filtreras med ett glidande medel innan lutningen beräknas per mikrosegment:</p>
    <div className="howto-formula howto-formula-block">
      {'höjd_utjämnad = glidande medel över 5 punkter\n'}
      {'lutning = (höjd_slut − höjd_start) ÷ längd\n'}
      {'lutning klampas till [−0,18, 0,18]  (±18 %)\n'}
      {'neutral: cum_distans < 1 km → 20 km/h, utanför NP-modellen'}
    </div>
    <p>
      Parametrar: utjämningsfönster 5 punkter, lutningstak 18 %, neutral sträcka 1 km vid 20 km/h.
      Sammanfallande punkter tas bort först så att en stillastående logg inte ger nolldistans-bitar.
    </p>
  </DeepDive>
</Section>
```

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit -p apps/web/tsconfig.json` — Expected: exit 0, "TypeScript compilation completed".

- [ ] **Step 4: Commit.**

```bash
git add apps/web/src/components/HowItWorks.tsx
git commit -m "feat(web): förklara GPX-bearbetning i Så funkar det"
```

---

### Task 2 (D): Section "Vädret skiftar över dygnet"

**Goal:** Explain that weather is sampled per location AND per hour-of-day the rider arrives, so morning calm can become afternoon wind on a long ride.

**Files:**

- Modify: `apps/web/src/components/HowItWorks.tsx` (add `WeatherClockFigure`; insert `<Section>` before `<Section title="I grupp: lä och jämn ansträngning"`)

**Acceptance Criteria:**

- [ ] New `<Section title="Vädret skiftar över dygnet">` renders between "Luft, vind och terräng" and "I grupp: lä och jämn ansträngning".
- [ ] Figure shows a route arc with clock markers at three points and wind arrows that grow/rotate along it.
- [ ] Copy explains weather is resolved per place AND per arrival hour; an ~11 h ride spans morning to afternoon.
- [ ] DeepDive shows `queryHour = floor((startklocka_UTC + förfluten tid) / 3600) mod 24` and the per-(lat,lon,timme) cell cache.
- [ ] `npx tsc --noEmit -p apps/web/tsconfig.json` passes.

**Verify:** `npx tsc --noEmit -p apps/web/tsconfig.json` → exit 0

**Steps:**

- [ ] **Step 1: Add the figure function** after `RoadPrepFigure`:

```tsx
function WeatherClockFigure() {
  const pts = [
    { x: 90, y: 150, t: '05:00', len: 16 },
    { x: 340, y: 96, t: '10:00', len: 30 },
    { x: 600, y: 120, t: '15:00', len: 46 },
  ];
  return (
    <svg width="100%" viewBox="0 0 680 196" role="img" aria-labelledby="wx-t wx-d">
      <title id="wx-t">Vinden ökar längs rutten under dagen</title>
      <desc id="wx-d">
        En båge som visar rutten med tre klockmarkörer. Vid varje punkt en vindpil som blir längre
        och vrider sig, från lugn morgon till blåsig eftermiddag.
      </desc>
      <defs>
        <marker
          id="wx-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      <path d="M60 160 Q340 40 620 132" fill="none" stroke={C.border} strokeWidth="3" />
      {pts.map((p) => (
        <g key={p.t}>
          <circle cx={p.x} cy={p.y} r="5" fill={C.accent} />
          <text
            x={p.x}
            y={p.y + 22}
            fontSize="12"
            fill={C.text}
            textAnchor="middle"
            fontWeight="600"
          >
            {p.t}
          </text>
          <line
            x1={p.x}
            y1={p.y - 8}
            x2={p.x + p.len}
            y2={p.y - 8 - p.len * 0.5}
            stroke={C.coral}
            strokeWidth="2.5"
            markerEnd="url(#wx-arrow)"
          />
        </g>
      ))}
      <text x="60" y="186" fontSize="12" fill={C.muted}>
        Lugn morgon
      </text>
      <text x="620" y="186" fontSize="12" fill={C.coral} textAnchor="end" fontWeight="600">
        Blåsig eftermiddag
      </text>
    </svg>
  );
}
```

- [ ] **Step 2: Insert the Section** immediately before `<Section title="I grupp: lä och jämn ansträngning" figure={<PacelineFigure />}>`:

```tsx
<Section title="Vädret skiftar över dygnet" figure={<WeatherClockFigure />}>
  <p>
    Vädret är inte en enda siffra för hela loppet. För varje sträcka slår vi upp vinden på just den
    platsen och vid den timme på dygnet du faktiskt är där. Ett varv tar runt elva timmar, så en
    lugn morgonstart kan möta helt annan vind på eftermiddagen. Prognosen läggs i ett rutnät i både
    rum och tid, och vi sparar uppslagen per cell och timme så att tusentals sträckor går snabbt att
    räkna.
  </p>
  <Formula caption="Klockan du når en plats avgör vilken prognostimme som gäller där, inte klockan vid start.">
    timme på platsen = starttid + din restid dit
  </Formula>
  <DeepDive>
    <p>
      Klocktiden vid en sträcka är starttiden plus ackumulerad restid. Den mappas till en heltimme
      och en cell i rutnätet (väderceller lagras i UTC):
    </p>
    <div className="howto-formula howto-formula-block">
      {'timme = ⌊(startklocka_UTC + förfluten_tid_s) ÷ 3600⌋ mod 24\n'}
      {'cellnyckel = lat | lon | timme  (närmaste cell, exakt cache)'}
    </div>
    <p>
      Ensemblen aggregeras till celler i rum och tid; uppslag per (lat, lon, timme) cachas så att
      den haversine-tunga sökningen bara körs en gång per cell. Den uppströms prognoshämtningen
      cachas i sin tur i 3 timmar.
    </p>
  </DeepDive>
</Section>
```

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit -p apps/web/tsconfig.json` — Expected: exit 0.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/src/components/HowItWorks.tsx
git commit -m "feat(web): förklara väder per plats och tid på dygnet i Så funkar det"
```

---

### Task 3 (F): Section "Vilken ansträngning planen håller"

**Goal:** Explain the effort anchor honestly: an optional FIT ride (>2 h → its NP; else 0.60×FTP) gives a personal reference NP shown in the plan, while the solver still finds the NP that hits your target time.

**Files:**

- Modify: `apps/web/src/components/HowItWorks.tsx` (add `AnchorFigure`; insert `<Section>` before `<Section title="Hur vi räknar fram din tid"`)

**Acceptance Criteria:**

- [ ] New `<Section title="Vilken ansträngning planen håller">` renders between "I grupp: lä och jämn ansträngning" and "Hur vi räknar fram din tid".
- [ ] Figure shows two input paths (lång tur >2h → turens NP; kort/ingen → 0,60×FTP) feeding a reference anchor.
- [ ] Copy is honest: anchor is a reference/verification number; the solver still solves NP for the target time (does NOT claim the FIT sets the pace).
- [ ] DeepDive states the >7200 s classification, 0.60×FTP fallback, group-size independence, and that `solveForTargetTime` bisects NP in [60, FTP].
- [ ] `npx tsc --noEmit -p apps/web/tsconfig.json` passes.

**Verify:** `npx tsc --noEmit -p apps/web/tsconfig.json` → exit 0

**Steps:**

- [ ] **Step 1: Add the figure function** after `WeatherClockFigure`:

```tsx
function AnchorFigure() {
  return (
    <svg width="100%" viewBox="0 0 680 176" role="img" aria-labelledby="anchor-t anchor-d">
      <title id="anchor-t">Två vägar till ett referensankare</title>
      <desc id="anchor-d">
        En lång tur över två timmar ger turens normaliserade effekt direkt; en kort tur eller ingen
        fil ger 0,60 gånger FTP. Båda landar i ett referensankare vid sidan av tidslösaren.
      </desc>
      <defs>
        <marker
          id="an-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      <rect
        x="30"
        y="34"
        width="210"
        height="40"
        rx="8"
        fill={C.fill}
        stroke={C.accent}
        strokeWidth="1"
      />
      <text x="135" y="50" fontSize="12" fill={C.text} textAnchor="middle" fontWeight="600">
        Lång representativ tur ({'>'}2 h)
      </text>
      <text x="135" y="66" fontSize="11" fill={C.muted} textAnchor="middle">
        turens NP används direkt
      </text>
      <rect
        x="30"
        y="102"
        width="210"
        height="40"
        rx="8"
        fill="#fff"
        stroke={C.gray}
        strokeWidth="1"
      />
      <text x="135" y="118" fontSize="12" fill={C.text} textAnchor="middle" fontWeight="600">
        Kort test eller ingen fil
      </text>
      <text x="135" y="134" fontSize="11" fill={C.muted} textAnchor="middle">
        0,60 × FTP
      </text>
      <line
        x1="240"
        y1="54"
        x2="372"
        y2="80"
        stroke={C.muted}
        strokeWidth="1.5"
        markerEnd="url(#an-arrow)"
      />
      <line
        x1="240"
        y1="122"
        x2="372"
        y2="92"
        stroke={C.muted}
        strokeWidth="1.5"
        markerEnd="url(#an-arrow)"
      />
      <rect
        x="380"
        y="64"
        width="150"
        height="44"
        rx="8"
        fill={C.fill}
        stroke={C.accent}
        strokeWidth="1.5"
      />
      <text x="455" y="82" fontSize="12" fill={C.text} textAnchor="middle" fontWeight="600">
        Referensankare
      </text>
      <text x="455" y="98" fontSize="11" fill={C.muted} textAnchor="middle">
        visas i planen
      </text>
      <line
        x1="530"
        y1="86"
        x2="600"
        y2="86"
        stroke={C.green}
        strokeWidth="2.5"
        markerEnd="url(#an-arrow)"
      />
      <text x="610" y="82" fontSize="11" fill={C.green} textAnchor="end">
        tidslösaren
      </text>
      <text x="610" y="98" fontSize="11" fill={C.green} textAnchor="end">
        räknar ändå NP
      </text>
    </svg>
  );
}
```

- [ ] **Step 2: Insert the Section** immediately before `<Section title="Hur vi räknar fram din tid" figure={<SolverFigure />}>`:

```tsx
<Section title="Vilken ansträngning planen håller" figure={<AnchorFigure />}>
  <p>
    Du kan ladda upp en valfri effektfil (FIT) från en representativ tur. Är den lång (mer än två
    timmar) använder vi turens normaliserade effekt som ett personligt ankare; är den kort, eller
    saknas helt, faller vi tillbaka på 0,60 × FTP. Ankaret är ett referensvärde som visas i planen
    så att du ser vilken ansträngning din måltid ungefär motsvarar. Själva planen löser ändå fram
    exakt den ansträngning som krävs för att träffa din tid, så ankaret styr inte tempot, det är
    till för att stämma av att kravet är rimligt för dig.
  </p>
  <Formula caption="Normaliserad effekt är gruppstorleks-oberoende, så samma ankare gäller oavsett om ni är 8 eller 12 i gänget.">
    ankare = lång tur ({'>'}2 h) ? turens NP : 0,60 × FTP
  </Formula>
  <DeepDive>
    <p>Ankaret bestäms ur effektströmmen (fit.ts), klassad på längd:</p>
    <div className="howto-formula howto-formula-block">
      {'längd > 7200 s  → long_representative → np_target = turens NP\n'}
      {'längd ≤ 7200 s  → short_test          → np_target = 0,60 × FTP\n'}
      {'ingen fil                              → np_target = 0,60 × FTP'}
    </div>
    <p>
      Förar-NP är det gruppstorleks-oberoende fysiologiska ankaret (spec 8.1): en referenstur i ett
      gäng på 8 (turtäthet 1/8) översätts till en plan för 12 (1/12) utan omräkning av ankaret. I
      webbflödet är ankaret informativt och visas i plan.json; tidslösaren bisekterar ändå mål-NP i
      intervallet [60, FTP] för att träffa måltiden (se nästa avsnitt).
    </p>
  </DeepDive>
</Section>
```

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit -p apps/web/tsconfig.json` — Expected: exit 0.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/src/components/HowItWorks.tsx
git commit -m "feat(web): förklara ansträngningsankaret (FIT/FTP) i Så funkar det"
```

---

### Task 4 (A): Section "Från rutt till tempokort"

**Goal:** Explain how micro-segments are grouped into the display segments you read, at which boundaries, how short/similar rows merge, the two views, and the note keywords (answers why the "Not" column appears only on hilly routes).

**Files:**

- Modify: `apps/web/src/components/HowItWorks.tsx` (add `SegmentFigure`; insert `<Section>` before the closing `<footer className="howto-footer">`)

**Acceptance Criteria:**

- [ ] New `<Section title="Från rutt till tempokort">` renders after "Tre vindscenarier" and before the footer (page position 10).
- [ ] Figure shows many thin micro-segment ticks collapsing into a few labelled display bars with control/depot dots.
- [ ] Copy names the boundary types (kontroll/depå, lutning korsar 3 %, vind vänder, start/mål), the tidy-up merges, that towns/depots are never merged away, the two views (styrkortsläge vs fullständigt), and the note keywords incl. why the column is conditional.
- [ ] Copy states web boundaries come from your depot stops (not a fixed town list).
- [ ] DeepDive states `min_segment_km=2`, `grade_merge_pct=0,3 %`, max 50 / 20 rader, time-weighted aggregation, SISTA UPPFÖR post-pass.
- [ ] `npx tsc --noEmit -p apps/web/tsconfig.json` passes.

**Verify:** `npx tsc --noEmit -p apps/web/tsconfig.json` → exit 0

**Steps:**

- [ ] **Step 1: Add the figure function** after `AnchorFigure`:

```tsx
function SegmentFigure() {
  const ticks = Array.from({ length: 40 }, (_, i) => 42 + i * 15);
  const bars = [
    { x: 42, w: 150, label: 'Flackt', color: C.accent },
    { x: 200, w: 96, label: 'Klättring', color: C.coral },
    { x: 304, w: 150, label: 'Flackt', color: C.accent },
    { x: 462, w: 174, label: 'Depå', color: C.green },
  ];
  return (
    <svg width="100%" viewBox="0 0 680 180" role="img" aria-labelledby="seg-t seg-d">
      <title id="seg-t">Hundratals mikrosegment grupperas till några få tempokortsrader</title>
      <desc id="seg-d">
        En rad med många tunna streck som visar mikrosegment, en pil nedåt, och nedanför några få
        breda etiketterade rader med markörer för kontroll och depå.
      </desc>
      <defs>
        <marker
          id="seg-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      {ticks.map((x) => (
        <line key={x} x1={x} y1="22" x2={x} y2="52" stroke={C.gray} strokeWidth="1.5" />
      ))}
      <text x="42" y="16" fontSize="11" fill={C.muted}>
        Mikrosegment (ett per GPX-punkt)
      </text>
      <line
        x1="340"
        y1="60"
        x2="340"
        y2="88"
        stroke={C.muted}
        strokeWidth="1.5"
        markerEnd="url(#seg-arrow)"
      />
      {bars.map((b) => (
        <g key={b.x}>
          <rect x={b.x} y="100" width={b.w - 6} height="28" rx="5" fill={b.color} opacity="0.85" />
          <text
            x={b.x + (b.w - 6) / 2}
            y="118"
            fontSize="12"
            fill="#fff"
            textAnchor="middle"
            fontWeight="600"
          >
            {b.label}
          </text>
        </g>
      ))}
      <circle cx="296" cy="100" r="5" fill={C.text} />
      <circle cx="630" cy="100" r="5" fill={C.text} />
      <text x="42" y="150" fontSize="11" fill={C.muted}>
        Visningssegment: ny rad där kontroll, lutning eller vind ändras
      </text>
    </svg>
  );
}
```

- [ ] **Step 2: Insert the Section** immediately before `<footer className="howto-footer">`:

```tsx
<Section title="Från rutt till tempokort" figure={<SegmentFigure />}>
  <p>
    Rutten körs i två upplösningar. Fysiken marscherar hundratals små mikrosegment, ett per
    GPX-punkt, så lutning och vind blir exakta. Men ett kort på styret behöver bara en handfull
    rader, så vi grupperar mikrosegmenten till visningssegment och klipper en ny rad där något
    verkligt ändras: vid en kontroll eller depå, där vägen växlar mellan flackt och backe (lutningen
    korsar 3 %), och där vinden vänder från mot till med. På den inlästa rutten kommer kontrollerna
    från dina depåstopp, plus start och mål.
  </p>
  <p>
    Sedan städar vi: korta stumpar slås ihop med den granne som har närmast effekt, rader med nästan
    samma lutning slås ihop, och totalen kapas så att kortet förblir läsbart. Orter och depåer slås
    aldrig bort. Varje rad får ett nyckelord, JÄMN FART, KLÄTTRING, SISTA UPPFÖR, BACKAR, TA DET
    LUGNT eller ÖKA, och Not-kolumnen visas bara när rutten faktiskt har något att säga, alltså inte
    på platta, vindstilla varv. Styrkortsläget klipper bara på kontroller och stopp för ett rent
    kort; fullständig vy lägger till lutnings- och vindgränserna.
  </p>
  <DeepDive>
    <p>Gränserna byggs ur mikrosegmenten, snäpps till närmaste segmentslut och grupperas:</p>
    <div className="howto-formula howto-formula-block">
      {'gräns = kontroll/depå | lutning korsar 3 % | vind vänder (>1 m/s) | start/mål\n'}
      {'slå ihop rader kortare än 2 km → granne med närmast snitt-effekt\n'}
      {'slå ihop rader med lutningsskillnad < 0,3 %  (samma nyckelord)\n'}
      {'kapa till ≤ 50 rader (styrkortsläge ≤ 20)'}
    </div>
    <p>
      All aggregering (fart, effekt, vind) är tidsviktad, eftersom mikrosegmentens längd följer
      GPX-punkternas täthet. En efterpass märker den sista klättringen före mål som SISTA UPPFÖR.
      Depå- och ortgränser korsas aldrig vid sammanslagning, så markörerna står kvar.
    </p>
  </DeepDive>
</Section>
```

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit -p apps/web/tsconfig.json` — Expected: exit 0.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/src/components/HowItWorks.tsx
git commit -m "feat(web): förklara segmentindelningen i Så funkar det"
```

---

### Task 5 (B): Section "Ankomst, depå och avgång"

**Goal:** Explain how each segment end gets a wall-clock time, how depot minutes add to it, and arrival vs departure.

**Files:**

- Modify: `apps/web/src/components/HowItWorks.tsx` (add `EtaClockFigure`; insert `<Section>` before the footer, AFTER the Task 4 section so it lands at position 11)

**Acceptance Criteria:**

- [ ] New `<Section title="Ankomst, depå och avgång">` renders after "Från rutt till tempokort" and before the footer (page position 11).
- [ ] Figure is a timeline: start clock → arrival at a control → depot block (+min) → departure → finish.
- [ ] Copy: each segment end = start + ackumulerad restid; depåminuter skjuter klockan framåt; ankomst vs avgång; total = rulltid + stopptid.
- [ ] DeepDive: `eta_s` = sekunder från start vid segmentslut, `avgång = ankomst + depåminuter`, klockan slår runt midnatt, total tid = rulltid + stopptid.
- [ ] `npx tsc --noEmit -p apps/web/tsconfig.json` passes.

**Verify:** `npx tsc --noEmit -p apps/web/tsconfig.json` → exit 0

**Steps:**

- [ ] **Step 1: Add the figure function** after `SegmentFigure`:

```tsx
function EtaClockFigure() {
  return (
    <svg width="100%" viewBox="0 0 680 150" role="img" aria-labelledby="eta-t eta-d">
      <title id="eta-t">Tidslinje med ankomst, depåstopp och avgång</title>
      <desc id="eta-d">
        En vågrät tidslinje från start till mål med en kontrollpunkt, ett markerat depåstopp som
        skjuter klockan framåt, och en avgångstid efter stoppet.
      </desc>
      <line x1="40" y1="80" x2="640" y2="80" stroke={C.border} strokeWidth="3" />
      <circle cx="60" cy="80" r="6" fill={C.accent} />
      <text x="60" y="64" fontSize="12" fill={C.text} textAnchor="middle" fontWeight="600">
        04:22
      </text>
      <text x="60" y="108" fontSize="11" fill={C.muted} textAnchor="middle">
        Start
      </text>
      <circle cx="300" cy="80" r="6" fill={C.text} />
      <text x="300" y="64" fontSize="12" fill={C.text} textAnchor="middle" fontWeight="600">
        07:22
      </text>
      <text x="300" y="108" fontSize="11" fill={C.muted} textAnchor="middle">
        Ankomst depå
      </text>
      <rect x="300" y="74" width="90" height="12" fill={C.coral} opacity="0.85" />
      <text x="345" y="124" fontSize="11" fill={C.coral} textAnchor="middle">
        +15 min stopp
      </text>
      <circle cx="390" cy="80" r="6" fill={C.green} />
      <text x="390" y="64" fontSize="12" fill={C.green} textAnchor="middle" fontWeight="600">
        07:37
      </text>
      <text x="390" y="108" fontSize="11" fill={C.muted} textAnchor="middle">
        Avgång
      </text>
      <circle cx="640" cy="80" r="6" fill={C.accent} />
      <text x="640" y="64" fontSize="12" fill={C.text} textAnchor="end" fontWeight="600">
        Mål
      </text>
    </svg>
  );
}
```

- [ ] **Step 2: Insert the Section** immediately before `<footer className="howto-footer">` (it renders right after the Task 4 "Från rutt till tempokort" section):

```tsx
<Section title="Ankomst, depå och avgång" figure={<EtaClockFigure />}>
  <p>
    När farten är känd på varje sträcka kan vi sätta en klocka på kortet. Varje rads slut får en
    klocktid: starttiden plus all restid dit. Vid en depå lägger vi på dina stoppminuter, så kortet
    visar både ankomst och avgång, och alla tider efter depån skjuts fram lika mycket. Sluttiden är
    summan av rulltid och stopptid, så längre depåstopp syns direkt i måltiden.
  </p>
  <Formula caption="Depåtiden är inte bortkastad, den ligger inbakad i varje klockslag efter stoppet.">
    ankomst = starttid + restid dit · avgång = ankomst + depåminuter
  </Formula>
  <DeepDive>
    <p>Varje segment bär sekunder-från-start vid sitt slut; depåer lägger till stopptid:</p>
    <div className="howto-formula howto-formula-block">
      {'eta_s = sekunder från start vid segmentets slut\n'}
      {'avgång_s = eta_s + depåminuter × 60\n'}
      {'klockslag = (starttid + eta_s) mod 24 h   (slår runt midnatt)\n'}
      {'total tid = rulltid + stopptid'}
    </div>
    <p>
      Klockan visas som lokal tid och hanterar varv som passerar midnatt. Depåstopp är hårda gränser
      i kortet: de slås aldrig ihop med grannrader, så ankomst- och avgångstiden står alltid kvar på
      sin egen rad.
    </p>
  </DeepDive>
</Section>
```

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit -p apps/web/tsconfig.json` — Expected: exit 0.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/src/components/HowItWorks.tsx
git commit -m "feat(web): förklara ankomst/depå/avgång-klockan i Så funkar det"
```

---

### Task 6 (E): Section "Tempokortet och klockan på styret"

**Goal:** Explain the ±5% pull-watt band on the card and the optional Garmin data field that reads the loaded course live (next control, distance, speed, ETA, ± minutes vs plan).

**Files:**

- Modify: `apps/web/src/components/HowItWorks.tsx` (add `CardWatchFigure`; insert `<Section>` before the footer, AFTER the Task 5 section so it lands at position 12)

**Acceptance Criteria:**

- [ ] New `<Section title="Tempokortet och klockan på styret">` renders after "Ankomst, depå och avgång" and before the footer (page position 12).
- [ ] Figure shows a watt band bracket (±5%) and a watch face with next control / km / km/h / ETA / ± min.
- [ ] Copy: card shows a watt band not a single number; optional Garmin field reads the loaded course live and shows next control, distance, speed, ETA and ± minutes vs plan.
- [ ] DeepDive: `band = drag × (1 ± 5 %)`, watch target pull/avg, field parses the planned time from each course-point name (relative `+m:ss` vs absolute clock) and colours the ± minutes.
- [ ] `npx tsc --noEmit -p apps/web/tsconfig.json` passes.

**Verify:** `npx tsc --noEmit -p apps/web/tsconfig.json` → exit 0

**Steps:**

- [ ] **Step 1: Add the figure function** after `EtaClockFigure`:

```tsx
function CardWatchFigure() {
  return (
    <svg width="100%" viewBox="0 0 680 200" role="img" aria-labelledby="card-t card-d">
      <title id="card-t">Effektband på kortet och ett Garmin-datafält</title>
      <desc id="card-d">
        Till vänster en tempokortsrad med en parentes som visar ett effektband plus minus fem
        procent. Till höger en klockskärm med nästa kontroll, avstånd, fart, ankomsttid och plus två
        minuter mot plan.
      </desc>
      <text x="40" y="40" fontSize="13" fill={C.text} fontWeight="600">
        Tempokortet
      </text>
      <rect
        x="40"
        y="56"
        width="280"
        height="40"
        rx="6"
        fill={C.fill}
        stroke={C.border}
        strokeWidth="1"
      />
      <text x="60" y="80" fontSize="13" fill={C.text}>
        Drageffekt
      </text>
      <text x="250" y="80" fontSize="15" fill={C.accent} fontWeight="700" textAnchor="middle">
        238–263 W
      </text>
      <path d="M196 100 H304" fill="none" stroke={C.coral} strokeWidth="1.5" />
      <text x="250" y="120" fontSize="11" fill={C.coral} textAnchor="middle">
        ±5 % band
      </text>
      <text x="430" y="40" fontSize="13" fill={C.text} fontWeight="600">
        Garmin-datafält
      </text>
      <rect x="430" y="52" width="190" height="120" rx="18" fill="#000" />
      <text x="525" y="78" fontSize="13" fill="#fff" textAnchor="middle" fontWeight="700">
        GRÄNNA
      </text>
      <text x="525" y="104" fontSize="20" fill="#fff" textAnchor="middle" fontWeight="700">
        12,3 km
      </text>
      <text x="525" y="126" fontSize="13" fill={C.accent} textAnchor="middle">
        31 km/h
      </text>
      <text x="525" y="146" fontSize="12" fill="#fff" textAnchor="middle">
        ETA 09:14
      </text>
      <text x="525" y="164" fontSize="13" fill={C.green} textAnchor="middle" fontWeight="700">
        +2 min
      </text>
    </svg>
  );
}
```

- [ ] **Step 2: Insert the Section** immediately before `<footer className="howto-footer">` (renders right after the Task 5 section):

```tsx
<Section title="Tempokortet och klockan på styret" figure={<CardWatchFigure />}>
  <p>
    Drageffekten på kortet visas som ett band, inte en exakt siffra, eftersom verkliga drag varierar
    och målet är ett spann att hålla dig inom, inte en omöjlig precision. Vill du ha planen live på
    styret finns ett valfritt Garmin-datafält. Det läser den inlästa banan direkt i klockan och
    visar nästa kontroll, avstånd kvar dit, din fart på sträckan, beräknad ankomsttid och hur många
    minuter före eller efter plan du ligger.
  </p>
  <Formula caption="Bandet ger marginal för verkliga drag, medan klockan visar om du tjänar eller tappar tid mot planen.">
    band = drageffekt × (1 ± 5 %)
  </Formula>
  <DeepDive>
    <p>
      Bandet är ±5 % kring den tidsviktade drageffekten per rad. Datafältet kan rikta sig mot
      antingen drageffekten eller snitteffekten. Det läser kontrollnamn och avstånd ur banan och
      tolkar den planerade tiden ur varje banpunkts namn:
    </p>
    <div className="howto-formula howto-formula-block">
      {'"Gränna 07:04"   → absolut klocktid\n'}
      {'"Gränna +2:42"   → tid sedan start (relativt läge)\n'}
      {'± min = projicerad ankomst − planerad tid  (färgad grön/gul/röd)'}
    </div>
    <p>
      Fältet är generiskt: inget om en specifik plan är inbyggt, allt når klockan via banfilen
      (course.fit). Avvikelsen mot plan färgas grön nära noll, gul vid måttlig drift och röd vid
      stor.
    </p>
  </DeepDive>
</Section>
```

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit -p apps/web/tsconfig.json` — Expected: exit 0.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/src/components/HowItWorks.tsx
git commit -m "feat(web): förklara effektband och Garmin-fältet i Så funkar det"
```

---

### Task 7: Full-page integration verification

**Goal:** Confirm all six sections render in the correct order, the page builds and lints clean, and capture a screenshot of the live page.

**Files:**

- No source changes (verification only). If a defect is found, fix it in `apps/web/src/components/HowItWorks.tsx` under the owning task's pattern.

**Acceptance Criteria:**

- [ ] Page order top-to-bottom is exactly: Grundidén, Från GPX till väg, Tre krafter du trampar mot, Luft vind och terräng, Vädret skiftar över dygnet, I grupp, Vilken ansträngning planen håller, Hur vi räknar fram din tid, Tre vindscenarier, Från rutt till tempokort, Ankomst depå och avgång, Tempokortet och klockan på styret, footer.
- [ ] `npm run typecheck` exit 0 (covers web + api + core).
- [ ] `npm run build -w apps/web` succeeds.
- [ ] Lint clean (lefthook lint passes on commit; or `npm run lint` if present).
- [ ] A screenshot of the live `#sa-funkar-det` page shows the six new figures rendering (no broken SVG, no overflow).

**Verify:** `npm run typecheck && npm run build -w apps/web` → both exit 0; plus a browser screenshot of the "Så funkar det" page.

**Steps:**

- [ ] **Step 1: Confirm section order.** Run: `grep -n '<Section title=' apps/web/src/components/HowItWorks.tsx` — Expected: 12 lines in the order listed in the Acceptance Criteria.

- [ ] **Step 2: Typecheck the monorepo.** Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 3: Build the web app.** Run: `npm run build -w apps/web` — Expected: build completes, no errors.

- [ ] **Step 4: Visual check.** Start the dev server (`preview_start`), navigate to the app, click the "Så funkar det" link (or append `#sa-funkar-det`), and take a `preview_screenshot` scrolled through the new C/D/F/A/B/E sections. Confirm each figure renders and copy is present. (Per the project memory, the dev server has no weather API; the "Så funkar det" page is static and needs no plan run.)

- [ ] **Step 5: Commit (only if a fix was needed in steps 1–4).**

```bash
git add apps/web/src/components/HowItWorks.tsx
git commit -m "fix(web): rätta sektionsordning/figurer i Så funkar det"
```

---

## Self-Review

**Spec coverage:** A (Task 4), B (Task 5), C (Task 1), D (Task 2), E (Task 6), F (Task 3), plus integration (Task 7). All six requested concepts covered, each as one infographic Section with figure + copy + DeepDive.

**Placeholder scan:** No TODO/TBD; every figure function and Section block is complete inline code; every constant is a real verified value.

**Type consistency:** Figure function names are unique (`RoadPrepFigure`, `WeatherClockFigure`, `AnchorFigure`, `SegmentFigure`, `EtaClockFigure`, `CardWatchFigure`); each is referenced exactly once via `figure={<XxxFigure />}`. Marker ids are unique (`wx-arrow`, `an-arrow`, `seg-arrow`). aria id pairs are unique (`road-*`, `wx-*`, `anchor-*`, `seg-*`, `eta-*`, `card-*`). All reuse the existing `C`, `Section`, `Formula`, `DeepDive` symbols already defined in the file.

**Risks / notes:**

- F is honest-by-design: the anchor is informational in the web flow. The copy was written to avoid claiming the FIT sets the pace. Keep that framing if edited.
- Figures are valid, themed starter SVGs; coordinate polish (spacing, overlap on narrow screens) is expected during Task 7's visual check, not a correctness blocker.
- All six tasks touch the same file. In subagent-driven execution run them sequentially (review between). The trailing trio (A→B→E) must be applied in that order because they share the "before footer" anchor.
