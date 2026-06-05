# Plan: reset button for saved settings (localStorage)

## Current state

- The form in [`apps/web/src/components/UploadForm.tsx`](../apps/web/src/components/UploadForm.tsx) saves to `localStorage['stp_form_v1']` via `saveToStorage`, and reads via `loadFromStorage` on mount.
- Persisted: `targetTotalHm, ftp, nRiders, m, watchTarget, raceDate, startTime, styrkortMaxRows, stops`. GPX/FIT are **not** persisted (GPX defaults to the bundled route, FIT is per-session).
- Weather state (mode, wind overrides) lives in `App.tsx` and is **not** persisted at all, so a page reload already clears it.
- **There is no reset.** The only "reset" today is the per-hour wind in `WindHourTable` (unrelated).

Conclusion: a reset only needs to clear the form. The single source of persistence is `stp_form_v1`.

## Problem with a naive solution

The default values currently sit as inline literals in the `useState` initializers (`saved.ftp ?? 272`). A reset button that restores `272` in a second place creates two sources of truth that drift apart. They must be extracted first.

## Proposed design

### 1. One source of truth for the defaults

Extract a `FORM_DEFAULTS` object at the top of `UploadForm.tsx`:

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

Use it both in the `useState` initializers (`saved.ftp ?? FORM_DEFAULTS.ftp`) and in reset. No loose literals left.

### 2. Reset handler

```ts
const handleReset = () => {
  localStorage.removeItem(LS_KEY);

  // Set all state from a single source.
  setTargetTotalHm(FORM_DEFAULTS.targetTotalHm);
  setFtp(FORM_DEFAULTS.ftp);
  setNRiders(FORM_DEFAULTS.nRiders);
  setM(FORM_DEFAULTS.m);
  setWatchTarget(FORM_DEFAULTS.watchTarget);
  setRaceDate(FORM_DEFAULTS.raceDate);
  setStartTime(FORM_DEFAULTS.startTime);
  setStyrkortMaxRows(FORM_DEFAULTS.styrkortMaxRows);
  setStops(FORM_DEFAULTS.stops);

  // GPX/FIT back to the bundled route + empty FIT.
  setGpxText(defaultRouteGpx);
  setGpxName(DEFAULT_ROUTE_NAME);
  setFitBytes(null);
  setFitName('');

  // Re-seed the parent (weather hours) with the default values. Build the payload
  // explicitly, NOT from state — setState is async, the closure sees stale values.
  onRun({
    gpxText: defaultRouteGpx,
    fitBytes: null,
    form: { ...FORM_DEFAULTS, target_total_hm: FORM_DEFAULTS.targetTotalHm /* map snake_case */ },
  });
};
```

Important: the `onRun` payload is built from `FORM_DEFAULTS`, not from the component's state, because `setState` has not propagated within the same tick. (Reuse `buildSubmit` by letting it take an optional override object.)

Note: we clear `stp_form_v1` but do not write it back immediately. The next field change `persist()`s the defaults again, which is fine. Alternatively call `persist(FORM_DEFAULTS)` right after reset if we want storage to mirror the defaults immediately.

### 3. Confirmation (against accidental deletion)

Reset discards the user's saved plan. Guard it with a confirmation. Three options:

- **A. `window.confirm`** (simplest, one line): `if (!confirm('Återställ alla inställningar till standard?')) return;`
- **B. Two-step inline** ("Återställ" → the button changes to "Bekräfta återställning" for a few seconds). More polish, more code.
- **C. No confirmation** but an undo toast ("Återställt. Ångra"). Most work.

Recommendation: **A** for now. Low friction, zero dependencies, matches the app's simple style. Can be upgraded to B later. (UI strings stay Swedish to match the app.)

### 4. Placement & UX

- A button in the `.actions` row next to "Använd inställningar", as a secondary `ghost` button: **"Återställ till standard"**.
- Show it only if something is saved (otherwise it is a no-op). Simple: `localStorage.getItem(LS_KEY) != null`. Low value, can be skipped in v1, but nice.
- A small confirmation note after reset (optional): reuse `.hint` "Inställningar återställda."

### 5. What reset does NOT touch

- Weather mode / wind overrides in `App.tsx` (not persisted; cleared on reload). If we want to clear those too it needs a callback up to `App` that sets `mode='calm'` and clears `overrides`/`baseRows`. **Recommendation: keep v1 to the form.** Weather is already ephemeral; mixing it in increases the surface for no clear gain.
- Results (the computed plan) live in solver state in `App` and disappear on re-run/reload. Leave it.

## Files changed

- `apps/web/src/components/UploadForm.tsx` — `FORM_DEFAULTS`, `handleReset`, button in `.actions`, possibly `buildSubmit(override?)`.
- `apps/web/src/styles.css` — probably nothing new (`ghost` exists); possibly minor spacing.
- Test: does `apps/web` have a testable form? Possibly add a simple vitest+jsdom test: render, change a field, click reset (mock `confirm`), assert the field is back to default and `localStorage` is cleared.

## Implementation steps

1. Extract `FORM_DEFAULTS`, point the `useState` initializers at it. (Pure refactor, no behavior change, run the tests.)
2. Add `buildSubmit(override?)` so reset can build the payload from defaults.
3. Add `handleReset` + the `confirm` guard.
4. Add the `ghost` button "Återställ till standard" in `.actions`.
5. Verify in preview: change a field → reload (persists) → reset → field default + `localStorage` empty.
6. (Optional) jsdom test for reset.

## Open questions for you

1. Confirmation: `confirm()` (A, recommended) or inline two-step (B)?
2. Should reset also clear weather mode/wind, or only the form (recommended)?
3. Button text: "Återställ till standard" / "Rensa sparat" / something else?
