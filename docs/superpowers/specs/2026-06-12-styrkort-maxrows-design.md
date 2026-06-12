# Styrkort: fungerande "Max rader"

Datum: 2026-06-12

## Bakgrund

Styrkortet är det kompakta A6-kortet för styret (`buildStyrkortHtml`) plus dess
on-screen förhandsvisning ("Visa styrkortsläge" i `TempokortTable`). Båda renderar
sex kolumner från `styrkortSegments`.

**"Max rader i styrkortet" är en död knapp.** Användaren satte 20 men fick 10
rader. Orsak: i kompaktläge sätts radgränser enbart vid kontroller + depåer
(10 sträckor på Vätternrundan), och `maxSegments` kan bara slå ihop _nedåt_
(`segmentation.ts:498`). 10 < 20 → inget händer. Dessutom blockerar vakten
`a.town !== undefined` (`segmentation.ts:508`) all hopslagning i kompaktläge,
eftersom varje kompakt-rad slutar på en kontrollort. Knappen gör alltså ingenting:
vilket värde som helst ≥ kontrollantalet ger 10 rader.

Depåstoppen är redan korrekt hanterade: de är hårda gränser och hopslagning korsar
dem aldrig (`stop_minutes !== undefined` → continue, `segmentation.ts:507`). Det
beteendet bevaras.

## Mål

- "Max rader" ska fungera: höj värdet → fler, finare mellanrader. Default blir
  kontrollantalet (härlett ur koden), inte det missvisande 20.
- Depåer alltid med, alltid egen rad, aldrig delade.

Kolumnerna är oförändrade i den här ändringen (se Utanför scope).

## Design

### A. Ny default

En konstant härleds ur koden och blir default överallt:

```
// segmentation.ts
export const STYRKORT_DEFAULT_MAX_ROWS = VATTERN_CONTROLS.length - 1; // = 10
```

- `config.ts` sätter `styrkort_max_rows: STYRKORT_DEFAULT_MAX_ROWS`.
- Webbens `FORM_DEFAULTS.styrkortMaxRows` importerar samma konstant.
- Befintligt sparat värde i localStorage (t.ex. 20) respekteras fortfarande och
  ger nu faktiskt 20 rader. Ingen migrering behövs.

### B. Split-uppåt (nytt)

När `compactMode` är på och radantalet är färre än `maxSegments`, delas den längsta
raden upp tills antalet når målet:

- Hitta den `DisplaySegment` med störst `distance_m` som har minst två
  `micro_indices` (delbar).
- Dela vid den mikrogräns som ligger närmast sträckans avståndsmittpunkt.
- Aggregera om båda halvorna via det befintliga `aggregateGroup`:
  - Vänster halva: `controlAtEnd = undefined`, `stopMinutesAtEnd = undefined`
    (mellanpunkt, ingen ort/depå).
  - Höger halva: slår upp `controlAtCum` / `stopAtCum` på sin slut-`cum_distance_m`
    (samma gräns som originalet hade), så ort/depå följer med höger halva.
- Upprepa tills `displaySegs.length === maxSegments` eller ingen rad är delbar.

Resultat: 20 → 10 kontroller/depåer + 10 jämnt fördelade mellanrader för
takt-avstämning. Depåer delas aldrig (de sitter på höger halvas slut och förblir
en egen rad). Sätts `maxRows` under kontrollantalet händer inget (kontrollerna är
golvet, hopslagning blockeras av ort/depå-vakterna) - acceptabelt, det valda
beteendet är "fler rader".

**Gating (viktigt).** Split-uppåt körs **endast i `compactMode`**. Den
fullständiga `displaySegments` anropar `segment()` utan `maxSegments` (default 50)
och får inte paddas upp till 50 rader. Kompaktläget är enda anroparen som vill ha
ett exakt målantal.

### C. Algoritmplacering

Split-uppåt-passet läggs i `segment()` intill den befintliga merge-nedåt-loopen,
ömsesidigt uteslutande: `len > max` → slå ihop (befintligt), `compactMode &&
len < max` → dela (nytt). Återanvänder `aggregateGroup`, `micro_indices` och
`controlAtCum` / `stopAtCum` som redan finns i scope. Symmetriskt med merge-nedåt
och enkelt att enhetstesta.

Vald approach framför att för-injicera extra gränser före grupperingen, vilket
hade trasslat in sig i gräns- och kontrollkartorna.

## Filer

- `packages/core/src/segmentation.ts` - split-uppåt-pass (compact-only) + exportera
  `STYRKORT_DEFAULT_MAX_ROWS`.
- `packages/core/src/config.ts` - default `styrkort_max_rows` = konstanten.
- `apps/web/src/components/UploadForm.tsx` - `FORM_DEFAULTS.styrkortMaxRows` =
  konstanten (importerad från core).
- `apps/web/src/lib/strings.ts` - hjälptext för `maxRows` (förklara att den fyller
  på med finare mellanrader, default = antal kontroller).
- `packages/core/tests/tempokort.test.ts` (eller `segmentation.test.ts`) - nya
  test: split-uppåt radantal, default-värde, och depå-tidsinvariant (eta_s/depart_s
  oförändrade).

## Testning

- **Default:** `DEFAULT_CONFIG.styrkort_max_rows === VATTERN_CONTROLS.length - 1`.
- **Split-uppåt:** med `compactMode` och `maxSegments` = 2 × kontrollantal blir
  radantalet exakt det, depårader finns kvar och är odelade, mellanrader saknar
  ort.
- **Ingen padding av full vy:** `segment()` utan `maxSegments` (default 50) på en
  plan med färre naturliga rader paddar INTE upp till 50.
- **Depå-invariant:** ingen split korsar en depå; varje depå är exakt en rad.
- **Tid/hastighet mellan depåer oförändrad (kärninvariant).** Split återaggregerar
  bara mikrosegment, så `eta_s` på varje kontroll-/depårad är bit-för-bit identisk
  med osplittad `segment()`, och `depart_s` på varje depå är oförändrad. Eftersom
  spann-tiden mellan två depåer = differensen av deras `eta_s`, är total tid (och
  därmed snitthastighet) per depå-spann garanterat oförändrad. Test:
  - Kör samma plan genom `segment()` med och utan split-uppåt.
  - Plocka ut raderna där `town`/`stop_minutes` är satt (kontroller/depåer) och
    jämför deras `eta_s`- och `depart_s`-sekvens: exakt lika.
  - Sekundärt: summan av mellanradernas `distance_m` inom ett spann = osplittade
    radens `distance_m` (ingen sträcka tappas eller dubblas).

## Utanför scope

- **3-kolumnsläge för kortet** (Km / km/h / Ankomst, ta bort Ort + Avgång + W,
  avgång i parentes på depårader). Medvetet bortlyft ur den här ändringen, görs
  separat.
- Ortnamn, justerbar Ankomst-rubrik, ☕-markör.
- Sammanslagning under kontrollantalet (option "färre rader" valdes bort).
