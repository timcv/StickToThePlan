# Wind model — effective wind and height correction

This document describes how the planner converts a forecast wind reading (given at 10 m height) into the wind that a cyclist at 1.2 m actually experiences, using a logarithmic wind profile with a terrain-roughness parameter.

**Important caveat.** This is not a CFD model. The roughness lengths (z0) are literature starting values and have not been calibrated against real rides. The correction makes the physics more consistent with how cycling aerodynamics textbooks treat boundary-layer wind; it does not claim to compute exact rider-level wind.

---

## 1. The problem: forecast height vs rider height

Numerical weather models report 10 m wind (the WMO standard). A rider on a bicycle sits at roughly 1.2 m. Wind speed in the boundary layer decreases with proximity to the ground; the difference is not trivial. Over smooth open terrain a 10 m forecast of 6 m/s corresponds to roughly 3.6 m/s at 1.2 m, a 40 % reduction.

Without the correction, using the 10 m forecast directly as rider-level wind overestimates aerodynamic drag, which forces the solver to claim that hitting a given target time requires more power than the rider actually needs.

---

## 2. The logarithmic (neutral) wind profile

The neutral logarithmic wind profile is the standard boundary-layer model for near-ground wind over flat terrain in neutral stability:

```
U(z) = (u* / kappa) * ln(z / z0)
```

where `u*` is the friction velocity, `kappa = 0.41` (von Karman), `z` is height above ground, and `z0` is the aerodynamic roughness length. For the ratio of two heights the constants cancel:

```
k = U(riderH) / U(forecastH) = ln(riderH / z0) / ln(forecastH / z0)
```

This is the height-correction factor. The planner applies it in `packages/core/src/weather/effective.ts`:

```
k = ln(riderH / z0) / ln(forecastH / z0)
k = clamp(k, 0.15, 1)          // floor 0.15, cap 1
effW = max(0, rawW * k)
```

The floor 0.15 exists because the bare log profile over very tall roughness classes (e.g. z0 = 0.50 for dense urban) formally yields very low k values for a 1.2 m rider, and the rider is on an open road surface, not inside the roughness elements. The cap of 1 ensures the model never predicts rider-level wind stronger than the 10 m forecast.

---

## 3. The roughness length z0

`z0` is the only free parameter and it quantifies how rough the local terrain is. Lower z0 means smoother surface and a smaller correction (e.g. open water, bridges). Higher z0 means rougher, more sheltered terrain and a larger correction.

### Coarse global selector

When no per-segment exposure data is available, `exposure_terrain` sets a single z0 for the whole route:

| `exposure_terrain` | z0 (m) | Typical scenario                     |
| ------------------ | ------ | ------------------------------------ |
| `open`             | 0.03   | Open farmland, minimal shelter       |
| `mixed` (default)  | 0.05   | Mixed terrain, Vatternrundan typical |
| `sheltered`        | 0.30   | Forest roads, urban streets          |

### Per-segment exposure classes

When baked exposure data is available (see `docs/exposure-model.md`), each microsegment carries its own `exposure_class` and corresponding z0:

| Class       | z0 (m) | Description                   |
| ----------- | ------ | ----------------------------- |
| `water`     | 0.001  | Open water surface            |
| `bridge`    | 0.002  | Bridge deck above water       |
| `open`      | 0.03   | Open farmland / meadow        |
| `semi_open` | 0.08   | Mixed scrub, sparse buildings |
| `forest`    | 0.30   | Dense forest                  |
| `urban`     | 0.40   | Residential / commercial      |
| `sheltered` | 0.50   | Enclosed roads, windbreaks    |

These are literature starting values, not calibrated values. See `packages/core/src/weather/effective.ts` for the `CLASS_Z0` table.

### Override

Set `wind_roughness_z0` in config to bypass both coarse terrain and per-segment data and use a single explicit z0. Useful for validating a specific route manually.

---

## 4. Factor table for 6 m/s forecast

For illustration, a 6 m/s forecast at 10 m maps to the following rider-level winds:

| Terrain         | z0   | k factor | Effective wind | Delta vs raw |
| --------------- | ---- | -------- | -------------- | ------------ |
| open            | 0.03 | 0.635    | 3.81 m/s       | -2.19 m/s    |
| mixed (default) | 0.05 | 0.600    | 3.60 m/s       | -2.40 m/s    |
| semi_open       | 0.08 | 0.561    | 3.37 m/s       | -2.63 m/s    |
| sheltered       | 0.30 | 0.395    | 2.37 m/s       | -3.63 m/s    |

---

## 5. Escape hatch: manual "felt" wind

If you set `rider_wind_height_m = 10` (the same as `forecast_wind_height_m`), the factor becomes exactly 1 and the raw wind passes through unchanged. This is the intended way to enter a "felt" wind directly.

Alternatively, set `apply_wind_height_correction: false` to disable the correction entirely. The planner then treats the wind input as already being at rider level. This is used for manually entered "felt" speeds where no height correction is appropriate.

---

## 6. Config parameters

| Parameter                      | Default | Meaning                                            |
| ------------------------------ | ------- | -------------------------------------------------- |
| `rider_wind_height_m`          | 1.2     | Height at which the cyclist experiences wind (m)   |
| `forecast_wind_height_m`       | 10      | Height the weather forecast reports at (m)         |
| `exposure_terrain`             | `mixed` | Coarse terrain selector when no per-segment data   |
| `wind_roughness_z0`            | (none)  | Explicit z0 override; bypasses terrain selector    |
| `apply_wind_height_correction` | `true`  | Set to false to skip correction (manual felt wind) |

---

## 7. Code references

| Concern                                                   | File                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| Height factor, adjustWindForHeight, CLASS_Z0, terrainToZ0 | `packages/core/src/weather/effective.ts`                        |
| Wiring into the inner solve (resolveZ0, effW)             | `packages/core/src/planner.ts` (lines ~88, ~162)                |
| Config fields                                             | `packages/core/src/config.ts`, `packages/core/src/types.ts`     |
| Per-segment exposure bake                                 | `scripts/bake-exposure.mjs`, `data/vatternrundan-exposure.json` |
| Exposure apply + coverage                                 | `packages/core/src/weather/exposure.ts`                         |
