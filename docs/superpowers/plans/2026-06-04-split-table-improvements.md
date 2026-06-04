# Split Table Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add avg speed (km/h) column to the Split plan table, and hide the Scenario summary when all three scenarios are identical (no weather data).

**Architecture:** Two independent UI changes in `apps/web`. Task 1 adds a computed display column derived from existing `SplitRow` fields. Task 2 adds a conditional render guard in `App.tsx` using a reference-equality check on the `ThreeScenarios` object (which `calmThreeScenarios` sets to the same reference for all three slots).

**Tech Stack:** React, TypeScript, Vitest + @testing-library/react

---

### Task 1: Add avg speed column to SplitTable

**Goal:** Display avg riding speed in km/h for each leg in the Split plan table, positioned after the Leg time column.

**Files:**
- Modify: `apps/web/src/lib/format.ts`
- Modify: `apps/web/src/components/SplitTable.tsx`
- Modify: `apps/web/tests/SplitTable.test.tsx`

**Acceptance Criteria:**
- [ ] `avgSpeedKmh(distanceM, timeS)` exported from `format.ts`, returns `"0.0"` when `timeS <= 0`
- [ ] SplitTable renders a new "Avg (km/h)" column header after "Leg time"
- [ ] Each row shows avg speed to one decimal (e.g. `"31.2"`)
- [ ] Existing tests still pass

**Verify:** `pnpm -w test --project web` → all tests pass, including the new avg speed assertion

**Steps:**

- [ ] **Step 1: Write failing test for avgSpeedKmh**

In `apps/web/tests/SplitTable.test.tsx`, add below the existing tests:

```tsx
it('displays avg speed in km/h for the first leg', () => {
  // leg: 40_200 m in 4200 s → 40.2 km / 1.1667 h ≈ 34.5 km/h
  const { container } = render(<SplitTable splits={fixture} startTime="06:00" />);
  const firstRow = container.querySelector('tbody tr:first-child');
  expect(firstRow?.textContent).toContain('34.5');
});
```

Also add a direct unit test for the helper (import `avgSpeedKmh` from `'../src/lib/format'`):

```tsx
import { avgSpeedKmh } from '../src/lib/format';

it('avgSpeedKmh returns 0.0 for zero time', () => {
  expect(avgSpeedKmh(1000, 0)).toBe('0.0');
});

it('avgSpeedKmh computes correctly', () => {
  // 40200 m / 4200 s = 9.571 m/s = 34.457 km/h → "34.5"
  expect(avgSpeedKmh(40_200, 4200)).toBe('34.5');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm -w test --project web
```
Expected: FAIL — `avgSpeedKmh` not exported, column not rendered.

- [ ] **Step 3: Add `avgSpeedKmh` to format.ts**

In `apps/web/src/lib/format.ts`, append:

```ts
/** Leg avg speed in km/h to one decimal. Returns "0.0" if timeS is zero. */
export function avgSpeedKmh(distanceM: number, timeS: number): string {
  if (timeS <= 0) return '0.0';
  return ((distanceM / timeS) * 3.6).toFixed(1);
}
```

- [ ] **Step 4: Update SplitTable.tsx**

In `apps/web/src/components/SplitTable.tsx`:

```tsx
import { secondsToHMM, metersToKm1, avgSpeedKmh } from '../lib/format';
```

Add the column header after `<th className="num">Leg time</th>`:

```tsx
<th className="num">Avg (km/h)</th>
```

Add the cell in the row after the leg time cell:

```tsx
<td className="num">{avgSpeedKmh(row.leg_distance_m, row.leg_time_s)}</td>
```

Full updated thead and tbody row:

```tsx
<thead>
  <tr>
    <th>Leg</th>
    <th className="num">Distance (km)</th>
    <th className="num">Leg time</th>
    <th className="num">Avg (km/h)</th>
    <th className="num">Arrival</th>
    <th className="num">Stop (min)</th>
    <th className="num">Departure</th>
    <th className="num">Cumulative</th>
  </tr>
</thead>
```

```tsx
<tr key={`${row.fromControl}-${row.toControl}-${i}`}>
  <td>{row.fromControl} to {row.toControl}</td>
  <td className="num">{metersToKm1(row.leg_distance_m)}</td>
  <td className="num">{secondsToHMM(row.leg_time_s)}</td>
  <td className="num">{avgSpeedKmh(row.leg_distance_m, row.leg_time_s)}</td>
  <td className="num">{secondsToClock(row.arrive_s, startTime)}</td>
  <td className="num">{row.stop_minutes > 0 ? row.stop_minutes : ''}</td>
  <td className="num">{secondsToClock(row.depart_s, startTime)}</td>
  <td className="num">{secondsToHMM(row.cumulative_s)}</td>
</tr>
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm -w test --project web
```
Expected: all tests PASS including the new avg speed assertions.

---

### Task 2: Hide ScenarioSummary when all three scenarios are identical

**Goal:** Only render the Scenario summary card when the three scenarios actually differ (i.e. when live weather data was used). In calm/no-weather mode the three scenarios are the same object, so the table adds no information.

**Files:**
- Modify: `apps/web/src/App.tsx`

**Acceptance Criteria:**
- [ ] ScenarioSummary is not rendered when `scenarios.optimistic === scenarios.expected && scenarios.pessimistic === scenarios.expected`
- [ ] ScenarioSummary IS rendered when scenarios differ (e.g. when Open-Meteo weather is used)
- [ ] No changes to ScenarioSummary component itself

**Verify:** `pnpm -w test --project web` → all tests pass; visual check: load app without weather → summary gone; load with weather → summary visible.

**Steps:**

- [ ] **Step 1: Update App.tsx**

In `apps/web/src/App.tsx`, inside the `{status === 'done' && result && (...)` block, replace:

```tsx
<ScenarioSummary scenarios={result.scenarios} />
```

with:

```tsx
{result.scenarios.optimistic !== result.scenarios.expected ||
  result.scenarios.pessimistic !== result.scenarios.expected ? (
  <ScenarioSummary scenarios={result.scenarios} />
) : null}
```

- [ ] **Step 2: Run tests**

```bash
pnpm -w test --project web
```
Expected: all tests PASS (no existing test asserts ScenarioSummary presence).
