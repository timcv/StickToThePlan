# Aero model — vector apparent wind and yaw adjustment

This document describes the aerodynamic drag formula used in the pacing solver, specifically the vector apparent-wind extension added in Task 4 and the yaw-CdA adjustment from the original model.

---

## 1. Background: axial vs vector apparent wind

The original `pedalPower` formula used a purely axial apparent-wind model: it combined headwind and ground speed along the direction of travel and ignored the perpendicular crosswind component. This is the standard steady-state cycling power equation and is correct when there is no crosswind.

With crosswind, the true apparent-wind vector has two components: an axial component (along the road) and a perpendicular component (across the road). The drag force magnitude depends on the true apparent-wind magnitude, not just the axial component. The updated formula handles this correctly.

---

## 2. The vector apparent-wind formula

`pedalPower(v, grade, headwind, p, crosswind)` in `packages/core/src/physics.ts`:

```
theta   = atan(grade)
F_grav  = m * g * sin(theta)
F_roll  = m * g * cos(theta) * crr
u       = v_ground + headwind         // axial apparent wind, + into wind
v_app   = hypot(u, crosswind)         // true apparent-wind magnitude
F_aero  = 0.5 * rho * CdA * v_app * u  // drag magnitude v_app, projected on travel axis, sign from u
P_wheel = (F_grav + F_roll + F_aero) * v_ground
P_pedal = P_wheel / eta
```

The key change is in `F_aero`: the drag magnitude uses `v_app` (the true apparent-wind magnitude, `hypot(u, crosswind)`) while the projection onto the direction of travel uses `u`. When there is no crosswind (`crosswind = 0`), `v_app = |u|` and `F_aero = 0.5 * rho * CdA * |u| * u`, which is byte-identical to the legacy formula. No regression on calm or axial-wind paths.

The `F_aero` sign follows from `u`: a tailwind stronger than ground speed (`u < 0`) gives negative aerodynamic drag (forward-assisting force). This is physically correct.

### Why crosswind has two intended effects

Crosswind affects drag in two compounding ways:

1. **Raised apparent-wind magnitude.** `v_app = hypot(u, crosswind)` is always >= `|u|`. More apparent wind means more drag, even if the crosswind is exactly perpendicular and contributes nothing axially.
2. **Raised yaw angle.** The crosswind increases the yaw angle, which the yaw-CdA factor uses to scale up the effective CdA (see section 3).

Both effects compound and both are physically motivated. A rider in a crosswind sits at an angle to the apparent wind and presents more frontal area.

---

## 3. Yaw-adjusted CdA

`yawCdaFactor(crosswind, vAir, kYaw)` in `packages/core/src/physics.ts`:

```
yaw     = atan2(crosswind, vAir)       // apparent-wind yaw angle
yaw     = clamp(yaw, -50 deg, +50 deg)
factor  = 1 + kYaw * |yaw_deg| / 10
```

`kYaw = 0.04` (default) gives a factor of 1.08 at 20 degrees yaw (~8 % CdA rise). This factor is multiplied onto both `cda_pull` and `cda_draft` in the chaingang model.

The yaw angle is clamped to +-50 degrees. The primary motivation is the strong-tailwind edge case: when `u < 0` (tailwind faster than ground speed), `atan2` would return values near 180 degrees, producing a huge spurious CdA factor. The 50-degree clamp keeps the model within its wind-tunnel-valid range and prevents this blow-up.

---

## 4. Legacy compatibility

Setting `crosswind = 0` (the default argument) makes `pedalPower` produce exactly the same result as the pre-Task-4 formula:

```
v_app = hypot(u, 0) = |u|
F_aero = 0.5 * rho * CdA * |u| * u   // legacy form
```

The calm-wind solve (and any test using zero crosswind) is therefore unaffected.

---

## 5. Code references

| Concern                                    | File                                           |
| ------------------------------------------ | ---------------------------------------------- |
| pedalPower, yawCdaFactor                   | `packages/core/src/physics.ts`                 |
| Chaingang pull/draft with yaw              | `packages/core/src/chaingang.ts`               |
| Wind decomposition into headwind/crosswind | `packages/core/src/physics.ts` (decomposeWind) |
