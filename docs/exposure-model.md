# Exposure model: per-segment terrain classification

This document describes how the planner obtains terrain roughness (z0) for each microsegment, including the offline OSM bake pipeline for the built-in Vatternrundan route, the fallback coarse selector for other routes, and the seven exposure classes.

**Important caveat.** The per-segment exposure data sharpens where on the route wind is attenuated or strong (e.g. forests slow the wind, bridges over water do not). It does not claim to predict the exact amount. The z0 values are literature starting points, not calibrated from real rides. A future upgrade to use NMD (Naturvardverket) land-cover data would improve accuracy; that is noted as future work, not yet built.

---

## 1. The seven exposure classes

Each microsegment can carry one of seven `ExposureClass` values. The corresponding roughness lengths are literature starting values:

| Class       | z0 (m) | Swedish label | Description                                      |
| ----------- | ------ | ------------- | ------------------------------------------------ |
| `water`     | 0.001  | Vattennära    | Open water surface (lake, sea)                   |
| `bridge`    | 0.002  | Bro           | Bridge deck above water                          |
| `open`      | 0.03   | Öppet         | Open farmland, meadows, minimal obstacles        |
| `semi_open` | 0.08   | Halvöppet     | Mixed terrain, sparse scrub, scattered buildings |
| `forest`    | 0.30   | Skog          | Dense forest                                     |
| `urban`     | 0.40   | Bebyggt       | Residential, commercial, industrial              |
| `sheltered` | 0.50   | Skyddat       | Enclosed roads, dense windbreaks                 |

`semi_open` (z0 = 0.08) is the unclassified default used by the bake pipeline when no polygon matches a point. It sits between truly open and forest.

These values are defined in `packages/core/src/weather/effective.ts` in the `CLASS_Z0` table.

---

## 2. The offline OSM bake pipeline (built-in Vatternrundan route)

The bake script (`scripts/bake-exposure.mjs`) runs once offline to classify the built-in Vatternrundan route. The core never fetches exposure data; the result is committed as `data/vatternrundan-exposure.json`. The app layer injects the data via `applyExposure(microsegments, runs)` before the solver runs.

### Steps

1. **Read GPX.** Parse `data/vatternrundan-315km.gpx` to get trackpoints.
2. **Build cumulative distances.** Compute haversine distance along the route.
3. **Tile the route.** Select one representative tile centre per ~5 km (downsampled to keep Overpass queries manageable).
4. **Query OpenStreetMap via Overpass.** For each tile, fetch a bounding box padded 0.015 deg (~1.7 km) with polygons tagged as forest, water, urban, or bridge. Two endpoints are tried in order (French mirror, then German primary) with exponential back-off on rate-limit responses.
5. **Classify each segment midpoint.** For each consecutive point pair in the GPX, check its midpoint against all fetched polygons using a ray-casting point-in-polygon test. Priority order: bridge > water > forest > urban. Unmatched points become `semi_open`.
6. **Compress to RLE runs.** Convert the per-point class array to run-length-encoded runs: contiguous segments of the same class become one `{from_km, to_km, class}` run.
7. **Write to JSON.** Output `data/vatternrundan-exposure.json` with `route_id`, `total_km`, and `runs`.

### How to re-run

```bash
node scripts/bake-exposure.mjs
```

Requirements:

- The GPX file `data/vatternrundan-315km.gpx` must be present (it is gitignored personal route data).
- Network access to Overpass API.
- The script takes several minutes (tile fetch is rate-limited to 2500 ms between tiles).

The resulting `data/vatternrundan-exposure.json` is committed. Re-running regenerates it; diff it before committing to check for OSM updates.

### Coverage on Vatternrundan

The baked data covers approximately 100 % of the route distance. The class histogram is printed on each bake run; `semi_open` typically dominates (the rolling agricultural landscape around Vattern), with `forest`, `water`, and `urban` segments adding meaningful variation.

---

## 3. Data flow in the app

```
scripts/bake-exposure.mjs  (offline)
    -> data/vatternrundan-exposure.json  (committed)

App startup:
    ingestGpxString(xml, cfg)           -> MicroSegment[]
    applyExposure(microsegments, runs)  -> stamps exposure_class + z0_used per segment
    solveThreeScenarios(...)            -> reads z0_used from each segment in resolveZ0()
```

The core function `resolveZ0(micro, cfg)` applies a three-level priority:

1. `micro.z0_used` (per-segment from baked data) -- used when present.
2. `cfg.wind_roughness_z0` -- explicit config override for the whole route.
3. `terrainToZ0(cfg.exposure_terrain)` -- coarse selector (open/mixed/sheltered), the fallback.

---

## 4. Other routes: coarse terrain selector and opt-in fetch

For routes other than the built-in Vatternrundan:

- **Default:** the coarse `exposure_terrain` selector (open/mixed/sheltered, default `mixed`) applies a single z0 to the whole route. This is what the app uses when no exposure data is loaded.
- **Opt-in fetch:** the web UI has a "Hamta exponering" (fetch exposure) button which is currently a stub. A future implementation would run a similar Overpass query client-side (or via the API route) for an uploaded GPX and return per-segment exposure. This is scaffolded but not yet built.
- **NMD upgrade (future):** Naturvardverket's land-cover data (NMD, Nationella Marktackesdata) covers Sweden with higher spatial resolution than OpenStreetMap polygons. It is noted as a future upgrade path for the built-in route. Not yet built.

---

## 5. Code references

| Concern                                   | File                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------- |
| ExposureClass type, ExposureRun interface | `packages/core/src/types.ts`, `packages/core/src/weather/exposure.ts` |
| CLASS_Z0 table, exposureClassToZ0         | `packages/core/src/weather/effective.ts`                              |
| applyExposure, exposureCoveragePct        | `packages/core/src/weather/exposure.ts`                               |
| resolveZ0 (three-level priority)          | `packages/core/src/planner.ts`                                        |
| Bake script                               | `scripts/bake-exposure.mjs`                                           |
| Committed baked data                      | `data/vatternrundan-exposure.json`                                    |
