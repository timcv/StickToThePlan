# Spec: Styrkort till tre kolumner + GPX/FIT-checkpoints som matchar styrkortet

Datum: 2026-06-12
Status: Godkänd, under implementation

Två relaterade men oberoende ändringar kring styrkortet.

- **Del A**: Förenkla styrkortet till tre kolumner (Km, km/h, Ankomst) och lägg
  in differens mot rakt rullsnitt i Ankomst-kolumnen.
- **Del B**: Låt checkpointsen i GPX/FIT-filerna matcha styrkortets rader
  ("Max rader") istället för en punkt per kontrollpunkt.

Gemensam källa: båda bygger på samma `styrkortSegments` (compact-segmenteringen
styrd av `styrkort_max_rows`). Det fullständiga tempokortet (A4, markdown,
`renderHtml`) lämnas orört.

---

## Del A: Styrkort, tre kolumner + diff mot rakt rullsnitt

### Slutstruktur

Tre kolumner:

|                       Km |                                                km/h | Ankomst               |
| -----------------------: | --------------------------------------------------: | --------------------- |
| `to_km` (endast slut-km) | `round(avg_speed_kmh)` (rullhastighet, exkl. stopp) | `HH:MM (±X[, HH:MM])` |

Borttaget: Ort, separat Avgång, W. ☕-emojin försvinner (låg i Ort-kolumnen).

### Diff mot rakt rullsnitt

"Rakt rullsnitt" = den visade planens egna rullsnitt, **uträknat** (ej hårdkodat):

```
refSpeedKmh  = totalDistanceKm / (expected.rolling_time_s / 3600)
totalAvgKmh  = totalDistanceKm / (expected.total_time_s   / 3600)
```

där `totalDistanceKm` = sista styrkort-radens `to_km`. För standardplanen ger
det ca 28,85 km/h (rullsnitt) och ca 26,81 km/h (totalsnitt inkl. pauser).

Per rad (depåtid utesluten ur ryttarens klocka så att stopp aldrig påverkar +/-):

```
movingEta  = eta_s - (summan av depåminuter för ALLA tidigare rader) * 60
refSeconds = to_km / refSpeedKmh * 3600
diffMin    = round((refSeconds - movingEta) / 60)   // + = före, - = efter
```

Diff baseras **alltid** på ankomst (`eta_s`), aldrig avgång (`depart_s`); radens
eget depåstopp räknas inte (ankomst sker före stoppet). Avgång visas endast som
extra info i parentesen. Eftersom referensen är rullsnittet (distans / rulltid)
och all depåtid dras bort, landar målradens diff på **±0** (ryttarens rulltid vid
mål = referensens rulltid där). Detta implementeras av `styrkortDiffsMin`.

Format:

- Vanlig passage: `08:26 (-25)`
- Depåstopp: `07:14 (-12, 07:24)` (ingen text "ut")
- Noll: `±0` (konsekvent symbol)
- Positiv: `+8`, negativ: `-12`

### Sidhuvud (två rader, både webb och A6)

```
Start 04:22 · Diff mot rakt rullsnitt 28,85 km/h · + = före, - = efter
Totalsnitt inkl. pauser: 26,81 km/h · Rullsnitt: 28,85 km/h
```

`·` som avgränsare, svensk decimalkomma, ingen em-dash.

### Ny core-modul: `packages/core/src/output/styrkort.ts`

Exporteras från `@stp/core`. Ren, testbar, delas av både React-vyn och A6-HTML
så att siffrorna aldrig kan divergera.

```ts
export interface StyrkortMeta {
  refSpeedKmh: number;
  totalAvgKmh: number;
}

export function styrkortMeta(expected: PlanResult, totalDistanceM: number): StyrkortMeta;
export function diffToStraightMin(toKm: number, etaS: number, refSpeedKmh: number): number;
export function formatDiff(min: number): string; // "+8" | "-12" | "±0"
export function formatAnkomst(etaClock: string, diffMin: number, departClock?: string): string;
```

Division-by-zero skyddas (0 in → 0 ut).

### Ändrade ytor

- `buildStyrkortHtml(displaySegments, cfg, meta)` (tempokort.ts): ny `meta`-param.
  Tre kolumner, tvåradigt sidhuvud, behåll `stop-row`-styling.
- `TempokortTable` (compact-vyn): nya props `refSpeedKmh`, `totalAvgKmh`.
  Tre kolumner + caption (två rader). Full-vyn oförändrad, ignorerar props.
- `pipeline.ts`: beräknar `styrkortMeta`, returnerar `refSpeedKmh`/`totalAvgKmh`.
- `App.tsx`: trådar props till `TempokortTable`.
- `Downloads.tsx`: skickar `meta` till `buildStyrkortHtml`.

### Oförändrat

`renderMarkdown` / `renderHtml` (A4 / fullständigt tempokort), full-vyn i
`TempokortTable`.

---

## Del B: GPX/FIT-checkpoints = styrkort-rader

### Mål

Checkpointsen (waypoints i GPX, course points i FIT) ska vara samma punkter som
styrkortet visar, styrt av "Max rader". Idag: en punkt per kontroll, frikopplat.

### Ny core-modul: `packages/core/src/output/checkpoints.ts`

```ts
export function checkpointsFromStyrkort(
  styrkortSegments: DisplaySegment[],
  controls: ControlPoint[],
): ControlPoint[];
```

Returnerar:

- **Start** först: `{ name: controls[0]?.km === 0 ? controls[0].name : 'Start', km: 0 }`
- sedan **en per styrkort-rad**: `{ name: seg.town ?? \`km ${seg.to_km}\`, km: seg.to_km }`

Namngivna kontroller behåller riktiga namn (town satt). Splittpunkter utan ort
får `km 240`. Antal checkpoints följer "Max rader".

### Inkoppling (build\*-funktionerna är oförändrade)

`buildCourseGpx` / `buildCourseFit` behåller signatur `(micro, plan, cfg, controls)`.
Endast anroparna byter listan de skickar in:

- `pipeline.ts`: `courseCheckpoints = checkpointsFromStyrkort(styrkortSegments, controls)`,
  returneras i `PipelineResult`.
- `Downloads.tsx`: skickar `result.courseCheckpoints` till båda byggarna.
- `cli.ts`: bygger en styrkort-segmentering (`compactMode`, `maxSegments:
cfg.styrkort_max_rows`), härleder checkpoints, skickar till
  `writeCourseGpx`/`writeCourseFit`.

Befintlig stopptid-logik i GPX (`cfg.stops`-uppslag på km) faller ut rätt:
matchar namngivna kontroller, missar splittpunkter. `<trkpt>`/FIT-records (linjen)
oförändrade.

### Oförändrat

`workout.fit` (`writeWorkout`/`fitWorkout`), track/record-tätheten, `plan.json`,
Connect IQ-fältet, `buildCourseGpx`/`buildCourseFit` internt.

---

## Tester

Del A (ny `styrkort.test.ts`):

- `diffToStraightMin(77, 10320, 28.85) === -12` (spec-exempel: 04:22 start, ank 07:14).
- `formatDiff`: `+8`, `-12`, `±0`.
- `formatAnkomst('07:14', -12, '07:24') === '07:14 (-12, 07:24)'`,
  `formatAnkomst('08:26', -25) === '08:26 (-25)'`.
- `styrkortMeta`: gett `rolling_time_s`/`total_time_s`/distans → rätt km/h.
- `buildStyrkortHtml`: tre kolumner, ingen "Ort"/"Avgång"/"W"-rubrik, ingen "ut".

Del B (ny `checkpoints.test.ts`):

- Start prepend (km 0).
- town-namn bevaras, splittpunkt → `km X`.
- antal checkpoints = styrkort-rader + 1 (Start).

Befintliga `course.test.ts`/`fitCourse.test.ts` står kvar (build\* oförändrade).

## Acceptanskriterier

Del A:

- Tabellen har endast Km, km/h, Ankomst.
- Km visar endast till-km.
- Ankomst innehåller diff mot rakt rullsnitt; depåavgång i parentes utan "ut".
- +/- mot uträknat rullsnitt; depåtid påverkar inte +/-.
- A6/print-layout fungerar.

Del B:

- Antal checkpoints i GPX/FIT följer "Max rader".
- Start (km 0) alltid med.
- Splittpunkter får `km X`, namngivna kontroller behåller namn.
- Gäller både webb och CLI.
