# UX-plan: StickToThePlan

Plan utifrån UX-granskningen (`sticktotheplan_ux_review_uppdaterad.md`). Mappad mot faktisk kod.

## Nuläge (kort)

- React 19 + Vite, monorepo (`apps/web`, `packages/core`).
- All CSS i en fil: `apps/web/src/styles.css`.
- Formulär: `components/UploadForm.tsx`, ~13 fält, mest **engelska** labels.
- Resultat: `SplitTable.tsx`, `TempokortTable.tsx`, `ScenarioSummary.tsx`, `Downloads.tsx`.
- Ingen i18n, inga tooltips, inga designtokens, ingen onboarding.
- State: `App.tsx` äger allt. Persist: localStorage-nyckel `stp_form_v1`.

## Gap mot granskningen

| Granskningens brist | Status i kod |
|---|---|
| Blandat språk (eng/sv) | Bekräftat. Form + SplitTable + Downloads engelska. |
| Tekniska termer utan förklaring | Inga tooltips finns. |
| Otydlig formulärhierarki | Platt `field-grid`, inga sektioner. |
| Ingen resultatsammanfattning | `ScenarioSummary` finns men engelsk + visas bara om scenarier skiljer sig. |
| Stora tabeller på mobil | `TempokortTable` har horisontell scroll, 10 kolumner i full vy. |
| Download-länkar utan förklaring | Råa filnamn (`workout.fit` osv). |
| Ingen onboarding / progressiv disclosure | Saknas helt. |

---

## Fas 1 - Språk & terminologi (grund, låg risk)

Allt annat bygger på enhetliga svenska labels. Gör detta först.

1. **Skapa central strängkälla.** Ny fil `apps/web/src/lib/strings.ts` med ett platt objekt (sv). Ingen i18n-lib behövs nu, men strukturen gör framtida språkval enkelt.
2. **Översätt alla labels till svenska** enligt granskningens 3A-tabell:
   - `Target total time` → **Måltid**
   - `FTP (W)` → **FTP (W)**
   - `Riders in group` → **Cyklister i gruppen**
   - `Rider + bike mass (kg)` → **Cyklist + cykel (kg)**
   - `Watch target` → **Klockmål** (pull → **Dragläge**, avg → **Gruppsnitt**)
   - `Race date` → **Tävlingsdatum**
   - `Start time` → **Starttid**
   - `Styrkortet max rows` → **Max rader i styrkortet**
   - `GPX route` → **GPX-rutt**, `FIT power file` → **FIT-effektfil**
   - Stops-kolumner `Control/km/Minutes` → **Kontroll / km / Minuter**
3. **Översätt resultatkomponenter:** `SplitTable` (Leg/Distance/Arrival...), `Downloads` (rubrik + brödtext), `ScenarioSummary` (Scenario/Total time/Required NP...).
4. **Standardisera begrepp:** samma ord överallt (t.ex. *Avgång*, *Ankomst*, *Medelhastighet*).

Filer: `UploadForm.tsx`, `SplitTable.tsx`, `Downloads.tsx`, `ScenarioSummary.tsx`, `TempokortTable.tsx`, ny `lib/strings.ts`.

---

## Fas 2 - Tooltips & hjälptexter

5. **Bygg `<InfoTip>`-komponent** (`components/InfoTip.tsx`). ⓘ-ikon bredvid label. Desktop = tooltip på hover/fokus, mobil = klickbar popover. Inte hover-only (touch). Tillgänglig: `aria-describedby`, fokuserbar.
6. **Koppla tooltip-text till fält** från granskningens 3A-tabell. Lagra texterna i `lib/strings.ts`.
7. **Synlig hjälprad** under de viktigaste fälten (Måltid, Starttid, FTP, Max rader i styrkortet). Liten grå text under input, t.ex. "Inklusive planerade stopp."

Filer: ny `components/InfoTip.tsx`, `UploadForm.tsx`, `lib/strings.ts`, `styles.css`.

---

## Fas 3 - Formulärstruktur & progressiv disclosure

8. **Gruppera fält i sektioner** med rubriker: *Mål & rutt*, *Kraft & grupp*, *Väder*, *Stopp*. Mjuk grå avgränsning. Ren CSS, ingen omskrivning av state.
9. **Basläge vs Avancerat.** Basläge visar bara Måltid + Starttid (+ rutt redan inläst). Standardvärden för FTP/massa/väder. Länk "Visa avancerade inställningar" fäller ut resten. State: en `showAdvanced`-flagga i `UploadForm`.
10. **Introblock högst upp** (`App.tsx`): kort svensk ingress, t.ex. "Ställ in ditt mål och få ett detaljerat körschema för Vätternrundan."

Filer: `UploadForm.tsx`, `App.tsx`, `styles.css`.

---

## Fas 4 - Resultatpresentation

11. **Sammanfattningskort överst** i resultatet: beräknad sluttid, total medelhastighet, snitteffekt, indikator om måltiden kräver kraft > FTP. Visa alltid (inte bara när scenarier skiljer). Data finns i `result.scenarios.expected` + `splits`.
12. **Förenkla split-tabellen:** visa default sträcka / tid / medelhastighet / ankomst. Resten (stopptid, avgång, ackumulerat) bakom "Visa mer" / expanderbar rad.
13. **Tempokort (styrkortsläge) som standardvy.** Gör växlingsknappen tydligare. Tooltip förklarar skillnaden ("Fullständigt visar mer terräng- och vindinfo").
14. **Färg & ikoner för stopp:** gul bakgrund finns redan i kompakt vy; lägg till ikon (kaffekopp/flaska) och förenkla notkolumnen.

Filer: ny `components/SummaryCard.tsx`, `SplitTable.tsx`, `TempokortTable.tsx`, `App.tsx`.

---

## Fas 5 - Responsiv design (mobil)

15. **Tempokort mobil:** visa färre kolumner på smal skärm. Accordionrad: basinfo synlig, klick expanderar detalj. CSS-media + liten state i raden.
16. **Split-tabell mobil:** samma princip, max ~halvdussin kolumner synliga.
17. **Typografi:** något mindre text + tightare radavstånd i tabeller på mobil.

Filer: `TempokortTable.tsx`, `SplitTable.tsx`, `styles.css`.

---

## Fas 6 - Nedladdningar

18. **Beskrivande knappar** istället för filnamn: "GPX för cykeldator", "FIT-fil med effektplan", "Utskrivbart tempokort", + kort beskrivning under varje.
19. **Gruppera** i sektioner: *Cykeldator*, *Garmin-klocka*, *Utskrift*.

Filer: `Downloads.tsx`, `lib/strings.ts`, `styles.css`.

---

## Fas 7 - Polish

20. **Felhantering:** tydliga svenska felmeddelanden vid orimliga värden (t.ex. för hög målfart) med åtgärdsförslag.
21. **Återkoppling efter Kör:** framdriftsindikator + bekräftelse "Planen är klar! Se sammanfattningen nedan."
22. **Visuell hierarki & spacing:** konsekvent avstånd/färg, designtokens i `styles.css` (`--space-*`, `--color-*`).

---

## Ordningsförslag

Fas 1 (språk) → Fas 4 (sammanfattning, hög synlig nytta) → Fas 2 (tooltips) → Fas 3 (struktur/disclosure) → Fas 5 (mobil) → Fas 6 (downloads) → Fas 7 (polish).

Varje fas är en egen PR. Fas 1 låser terminologin som allt annat refererar.
