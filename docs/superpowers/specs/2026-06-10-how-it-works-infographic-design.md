# "Så funkar det" infographic page — design

Date: 2026-06-10
Status: proposed (awaiting user review)

## Goal

A one-page infographic inside the web app that explains the concept and how the
pacing calculations work, in plain Swedish with credible-but-readable math. It is
reachable from the app header and is the target of a shared Facebook link, so the
author can post it and head off "how is this calculated?" questions.

Primary success test: a non-technical cyclist reads it top to bottom and walks away
understanding (a) the core idea, (b) roughly what the model accounts for, and (c)
that the math is real, without needing to ask follow-up questions.

## Decisions (locked with user)

- **Form:** In-app page, share-ready. One tall infographic that reads as a poster,
  reachable from the header, and openable directly via a shared URL.
- **Language:** Swedish.
- **Math depth:** Medium. Plain-language concept first, then the key formula shown
  but explained in one line. No constant dumps, no derivations.
- **Visual direction:** Stacked cards + small schematic inline SVG diagrams +
  monospace formula chips with a one-line explanation under each. Approved via mockup.
- **Facebook preview:** Full. Open Graph + Twitter meta tags plus a purpose-built
  1200x630 share image.

## Navigation approach (no router)

The app is a React 19 + Vite SPA with no routing library. We keep it that way.

- Add view state to `App.tsx`: `const [view, setView] = useState<'calculator' | 'how'>(...)`.
- Seed the initial view from `window.location.hash`: if the hash is `#sa-funkar-det`,
  start on the infographic. This makes a shared link land directly on the page.
- A header link "Så funkar det" calls `setView('how')` and sets
  `window.location.hash = 'sa-funkar-det'`.
- `HowItWorks` renders a "Tillbaka till kalkylatorn" link that calls `setView('calculator')`
  and clears the hash (`history.replaceState(null, '', window.location.pathname)`).
- Listen to `hashchange` so browser back/forward between the two views works.
- When `view === 'how'`, render only `<HowItWorks />` (and the GitHub ribbon); the
  calculator form/results are not rendered. When `view === 'calculator'`, the app is
  exactly as today plus the new header link.

Rationale: hash-based deep linking is a few lines, needs no dependency, and gives the
Facebook link a stable URL (`…/#sa-funkar-det`) that opens the infographic.

## Files

- **Create** `apps/web/src/components/HowItWorks.tsx` — the infographic page. One
  component, one default export, self-contained. Small private sub-components or
  inline SVG per section are fine; keep section copy/diagrams co-located and readable.
- **Modify** `apps/web/src/App.tsx` — view state, hash seeding/sync, header link,
  conditional render.
- **Modify** `apps/web/src/styles.css` — new classes scoped under a page wrapper
  (e.g. `.howto`, `.howto-hero`, `.howto-section`, `.howto-formula`, `.howto-figure`).
  Reuse existing tokens (`--surface`, `--border`, `--text`, `--muted`, `--accent`,
  `--bg`) so it matches the app. App is light-mode only; no dark-mode handling needed.
- **Modify** `apps/web/index.html` — add Open Graph + Twitter Card meta tags and a
  `<meta name="description">`.
- **Create** `apps/web/public/og-how-it-works.png` — 1200x630 share image (see below).

## Styling

Reuse the existing design language: white `--surface` cards on `--bg`, 1px `--border`,
8px radius, `--accent` (#1f6feb) for emphasis, `--muted` for secondary text. The page
sits inside the existing `.app` max-width container (1040px) but the infographic column
is narrower (target ~720px, centered) so it reads as a poster and screenshots cleanly.

- `.howto-hero`: accent-tinted band (light `#e7f0ff` fill, `--accent` left border or
  full tint), big title, one-sentence subtitle.
- `.howto-section`: a `.card`-like block: heading with a small leading icon-ish glyph
  (inline SVG, not an icon font), body paragraph, optional `.howto-figure` (SVG),
  optional `.howto-formula` chip + one-line caption.
- `.howto-formula`: monospace, `--zebra`/secondary background, 6px radius, padding.
  Use plain readable tokens (`effekt`, `backe`, `rull`, `luft`, `fart`) over raw
  symbols where it aids a lay reader; keep one real formula per relevant section.
- Diagrams: hand-authored inline SVGs using the app palette. Keep each schematic
  simple (a cyclist + arrows, wind arrows, a paceline, a finish-time fan). Every SVG
  carries `role="img"` + `<title>`/`<desc>` for screen readers. No external assets.
- Responsive: single column already; ensure SVGs use `width:100%` + `viewBox` so they
  scale on mobile. Verify at ~380px.

## Content sections (Swedish copy + figure + formula)

Copy below is the intended shipped text (may be lightly tightened in implementation).
Medium depth: concept sentence(s), then one explained formula where it adds credibility.

1. **Hero**
   - Title: "Så räknar StickToThePlan ut din tid"
   - Subtitle: "Vi håller din ansträngning jämn och låter farten variera med backar
     och vind. Sen letar vi upp exakt den ansträngning som träffar din måltid."

2. **Grundidén**
   - Body: "Backar bromsar, utförslöpor och medvind hjälper. I stället för en jämn
     fart håller vi en jämn effekt (watt). Farten får svaja, men känslan i benen är
     ungefär konstant hela varvet. Det är så en van cyklist faktiskt kör: lika hårt
     uppför som nerför, inte lika fort."
   - Figure: a height profile with a steady "effort" band over varying speed (simple).

3. **Tre krafter du trampar mot**
   - Body: "Varje sekund räknar vi hur många watt som krävs för att slå tre motstånd:
     tyngden i backen, däcken mot asfalten och luften framför dig. Luftmotståndet är
     i särklass störst på platt mark."
   - Figure: cyclist on a slope with three resisting arrows (luft largest, rull, tyngd)
     and a forward "du trampar" arrow. (As in approved mockup.)
   - Formula: `effekt = (backe + rull + luft) × fart ÷ verkningsgrad`
   - Caption: "Luftmotståndet växer med farten i kvadrat, därför betyder vind och
     kroppshållning så mycket."

4. **Luft, vind och terräng**
   - Body: "Tyngre luft = mer motstånd, så vi väger in temperatur och lufttryck.
     Vindprognosen gäller 10 meter upp, men du sitter på drygt en meter. Vi skalar
     ner vinden efter hur skyddat landskapet är: skog och bebyggelse dämpar, öppet
     vatten och broar släpper fram full vind. Sido- och motvind kostar olika mycket,
     så vi delar upp vinden i mot- och sidled för varje vägsträcka."
   - Figure: wind arrow split into headwind + crosswind against travel direction, or
     a terrain-roughness strip (water → forest → urban) damping a wind arrow.
   - Formula: `effektiv vind = prognosvind × terrängfaktor`
   - Caption: "Terrängfaktorn kommer ur en standardmodell för hur vind avtar nära
     marken (logaritmisk vindprofil)."

5. **I grupp: drafting och jämn ansträngning**
   - Body: "I ett kedjegäng ligger du mest i lä, där luftmotståndet är ungefär en
     femtedel lägre. Vi modellerar rotationen: korta, hårda ryck på täten och längre
     vila i klungan. För att fånga vad det gör med kroppen mäter vi din ansträngning
     som normaliserad effekt (NP), ett mått som straffar de hårda rycken mer än ett
     enkelt snitt gör."
   - Figure: a paceline (riders in a line, front one pulling), with a small "lä ≈ -20%"
     marker on the followers.
   - Formula: `NP = (medel av 30-sekunders rullande effekt⁴)^¼`
   - Caption: "Upphöjt till fyra gör att korta hårda ryck väger tyngre, precis som de
     känns i verkligheten."

6. **Hur lösaren hittar din tid**
   - Body: "Vi gissar en ansträngningsnivå, kör igenom hela rutten sträcka för sträcka,
     räknar fart och tid på varje, och summerar. Blev det för långsamt höjer vi
     ansträngningen, för snabbt sänker vi den, och halverar oss fram tills tiden
     träffar ditt mål på sekunden. Realistiska tak gör att vi aldrig planerar
     orimliga ryck i branta backar eller över 50 km/h."
   - Figure: a small bisection sketch (target time line, guesses converging) or a 4-step
     flow: gissa → marschera → summera → justera (loop).

7. **Tre vindscenarier**
   - Body: "Väder är osäkert, så vi räknar tre gånger: med lugnare vind än väntat
     (optimistiskt), med väntad vind, och med kraftigare vind (pessimistiskt). Då ser
     du hur mycket din tid kan vippa åt båda håll, inte bara en enda siffra."
   - Figure: a fan of three finish times (optimistisk / förväntad / pessimistisk).

8. **Footer**
   - In/ut, one line: "Du matar in: rutt (GPX), din FTP, antal i gruppen, måltid,
     depåstopp och väder. Du får ut: tempokort, depåtider och filer till klocka och
     Garmin."
   - "Allt räknas i din webbläsare, inga uppgifter sparas eller skickas vidare."
     (Consistent with the existing privacy note.)
   - Link: "Öppen källkod på GitHub" → `https://github.com/timcv/StickToThePlan`.
   - "Tillbaka till kalkylatorn" link (clears hash, returns to calculator view).

Accuracy note: copy is grounded in `packages/core` — `physics.ts` (pedalPower:
gravity + rolling + aero/η; air density from temp/pressure; wind decomposition; NP =
quartic mean of 30 s rolling power), `chaingang.ts` (draft ≈ 20% lower CdA, rotation,
rider NP), `planner.ts` (bisection to target time, caps, 50 km/h spin-out),
`weather/effective.ts` (10 m → 1.2 m log wind profile, terrain z0). Keep claims at this
level; do not invent numbers beyond what the model uses.

## Facebook link preview

`index.html` `<head>` gains:

- `<meta name="description" content="Så räknar StickToThePlan ut din tid för Vätternrundan: jämn ansträngning, variabel fart, vind och drafting. Här förklarar vi modellen.">`
- Open Graph: `og:type=website`, `og:title`, `og:description`, `og:url`
  (`https://sticktotheplan.vercel.app/#sa-funkar-det`), `og:image`
  (`https://sticktotheplan.vercel.app/og-how-it-works.png`), `og:image:width=1200`,
  `og:image:height=630`, `og:locale=sv_SE`.
- Twitter: `twitter:card=summary_large_image`, title, description, image.

Production origin confirmed: `https://sticktotheplan.vercel.app` (per README, verified
live). OG `og:url`/`og:image` use this absolute base.

### Share image (1200x630)

Purpose-built poster: app accent palette, title "Så räknar vi ut din tid", a one-line
subtitle, a simplified version of the cyclist-three-forces figure, and the
"StickToThePlan · Vätternrundan" wordmark. Authored as an SVG, then rasterized to PNG
and committed at `apps/web/public/og-how-it-works.png` (Vite serves `public/` at root).
Rasterization method (resvg / sharp / headless screenshot) decided in the plan; the
committed artifact is a static PNG so production needs no render step.

## Accessibility

- Page has a single `<h1>` (hero title); sections use `<h2>`.
- Every SVG: `role="img"` with `<title>` and `<desc>`.
- Color is never the only signal in a figure; arrows/labels carry meaning too.
- Links are real `<a>`/buttons with discernible text; "Tillbaka" is keyboard reachable.

## Verification

- `npm run dev -w apps/web`, open the app, click "Så funkar det", confirm the
  infographic renders, scroll all sections, check no console errors.
- Open `…/#sa-funkar-det` directly and confirm it lands on the infographic.
- Resize to ~380px: SVGs scale, no horizontal scroll, copy readable.
- "Tillbaka till kalkylatorn" returns to the working calculator (form still runs).
- `npm run build -w apps/web` succeeds; built HTML contains the OG tags; the share
  image is present in the build output.
- (Weather API is not exercised by this page, so the dev-server weather fallback is
  irrelevant here.)

## Out of scope

- No routing library, no new pages beyond this one.
- No CMS/markdown authoring; copy lives in the component.
- No analytics, no i18n framework (Swedish only).
- No changes to the pacing model itself.

## Roadmap candidates (not now)

- English translation / language toggle.
- "Download as PNG" of the live page (vs. the static OG image).
