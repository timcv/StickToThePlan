# Plan: reset-knapp för sparade inställningar (localStorage)

## Nuläge

- Formuläret i [`apps/web/src/components/UploadForm.tsx`](../apps/web/src/components/UploadForm.tsx) sparar till `localStorage['stp_form_v1']` via `saveToStorage`, och läser via `loadFromStorage` på mount.
- Persisterat: `targetTotalHm, ftp, nRiders, m, watchTarget, raceDate, startTime, styrkortMaxRows, stops`. GPX/FIT persistas **inte** (GPX defaultar till buntad rutt, FIT är per-session).
- Väderstate (läge, vindöverstyrningar) bor i `App.tsx` och persistas **inte** alls, så en sidladdning nollar redan det.
- **Ingen reset finns.** Den enda "återställ" idag är per-timmes vind i `WindHourTable` (orelaterat).

Slutsats: en reset behöver bara nolla formuläret. Den enda källan till persistens är `stp_form_v1`.

## Problem med en naiv lösning

Default-värdena ligger idag som inline-literaler i `useState`-initierarna (`saved.ftp ?? 272`). En reset-knapp som sätter tillbaka `272` på ett andra ställe skapar två sanningskällor som driver isär. Måste extraheras först.

## Föreslagen design

### 1. En sanningskälla för defaults

Bryt ut ett `FORM_DEFAULTS`-objekt högst upp i `UploadForm.tsx`:

```ts
const FORM_DEFAULTS = {
  targetTotalHm: '11:45',
  ftp: 272,
  nRiders: 12,
  m: 96,
  watchTarget: 'pull' as WatchTarget,
  raceDate: '2026-06-13',
  startTime: '04:22',
  styrkortMaxRows: 20,
  stops: DEFAULT_STOPS,
};
```

Använd det både i `useState`-initierarna (`saved.ftp ?? FORM_DEFAULTS.ftp`) och i reset. Inga lösa literaler kvar.

### 2. Reset-handler

```ts
const handleReset = () => {
  localStorage.removeItem(LS_KEY);

  // Sätt all state från en enda källa.
  setTargetTotalHm(FORM_DEFAULTS.targetTotalHm);
  setFtp(FORM_DEFAULTS.ftp);
  setNRiders(FORM_DEFAULTS.nRiders);
  setM(FORM_DEFAULTS.m);
  setWatchTarget(FORM_DEFAULTS.watchTarget);
  setRaceDate(FORM_DEFAULTS.raceDate);
  setStartTime(FORM_DEFAULTS.startTime);
  setStyrkortMaxRows(FORM_DEFAULTS.styrkortMaxRows);
  setStops(FORM_DEFAULTS.stops);

  // GPX/FIT tillbaka till buntad rutt + tom FIT.
  setGpxText(defaultRouteGpx);
  setGpxName(DEFAULT_ROUTE_NAME);
  setFitBytes(null);
  setFitName('');

  // Seeda om föräldern (vädertimmar) med default-värdena. Bygg payload
  // explicit, INTE från state — setState är asynkront, closuren ser gamla värden.
  onRun({
    gpxText: defaultRouteGpx,
    fitBytes: null,
    form: { ...FORM_DEFAULTS, target_total_hm: FORM_DEFAULTS.targetTotalHm /* mappa snake_case */ },
  });
};
```

Viktigt: `onRun`-payloaden byggs från `FORM_DEFAULTS`, inte från komponentens state, eftersom `setState` inte hunnit slå igenom i samma tick. (Återanvänd gärna `buildSubmit` genom att låta den ta ett valfritt override-objekt.)

Notera: vi tömmer `stp_form_v1` men sätter inte tillbaka det direkt. Nästa fält-ändring `persist()`:ar defaults igen, vilket är ok. Alternativt anropa `persist(FORM_DEFAULTS)` direkt efter reset om vi vill att lagringen ska spegla defaults omedelbart.

### 3. Bekräftelse (mot oavsiktlig radering)

Reset slänger användarens sparade plan. Skydda med en bekräftelse. Tre alternativ:

- **A. `window.confirm`** (enklast, en rad): `if (!confirm('Återställ alla inställningar till standard?')) return;`
- **B. Tvåstegs inline** ("Återställ" → knappen byter till "Bekräfta återställning" i några sekunder). Mer polish, mer kod.
- **C. Ingen bekräftelse** men en ångra-toast ("Återställt. Ångra"). Mest jobb.

Rekommendation: **A** nu. Lågt friktion, noll beroenden, matchar appens enkla stil. Kan uppgraderas till B senare.

### 4. Placering & UX

- Knapp i `.actions`-raden bredvid "Använd inställningar", som sekundär `ghost`-knapp: **"Återställ till standard"**.
- Visa den bara om det finns något sparat (annars är den en no-op). Enkelt: `localStorage.getItem(LS_KEY) != null`. Lågt värde, kan hoppas över i v1, men trevligt.
- Liten bekräftelsetext efter reset (valfritt): återanvänd `.hint` "Inställningar återställda."

### 5. Vad reset INTE rör

- Väderläge/vindöverstyrningar i `App.tsx` (inte persistat; nollas vid sidladdning). Om vi vill nolla även det krävs en callback upp till `App` som sätter `mode='calm'`, tömmer `overrides`/`baseRows`. **Rekommendation: håll v1 till formuläret.** Väder är redan flyktigt; att blanda in det ökar ytan utan tydlig vinst.
- Resultat (beräknad plan) ligger i solver-state i `App`, försvinner vid omkörning/sidladdning. Lämna.

## Filer som ändras

- `apps/web/src/components/UploadForm.tsx` — `FORM_DEFAULTS`, `handleReset`, knapp i `.actions`, ev. `buildSubmit(override?)`.
- `apps/web/src/styles.css` — inget nytt troligen (`ghost` finns); ev. liten spacing.
- Test: `apps/web` har testbar form? Lägg ev. ett enkelt vitest+jsdom-test: rendera, ändra ett fält, klicka reset (mocka `confirm`), assert att fältet är default igen och `localStorage` tömt.

## Implementationssteg

1. Extrahera `FORM_DEFAULTS`, peka om `useState`-initierare mot det. (Ren refaktor, ingen beteendeändring, kör test.)
2. Lägg `buildSubmit(override?)` så reset kan bygga payload från defaults.
3. Lägg `handleReset` + `confirm`-guard.
4. Lägg `ghost`-knapp "Återställ till standard" i `.actions`.
5. Verifiera i preview: ändra fält → reload (kvarstår) → reset → fält default + `localStorage` tomt.
6. (Valfritt) jsdom-test för reset.

## Öppna frågor till dig

1. Bekräftelse: `confirm()` (A, rek.) eller inline tvåstegs (B)?
2. Ska reset även nolla väderläge/vind, eller bara formuläret (rek.)?
3. Knapptext: "Återställ till standard" / "Rensa sparat" / annat?
