# docs

Reference material for the calculator. The model itself is documented in [MODELL.md](../MODELL.md) at the repo root.

- [calculation-model.md](calculation-model.md): full reference of the calculation model and algorithm: physics, wind, group/NP, pacing solver, caps, scenarios, defaults, assumptions, and a validation checklist. Written so an external reviewer can check the model.
- [build-report.md](build-report.md): validation record: the numbers the model is checked against, from the M1–M8 build run and the subsequent wind-realism work. Cited by MODELL.md.
- [wind-model.md](wind-model.md): how forecast wind (10 m) is converted to effective rider-level wind (1.2 m) using the logarithmic wind profile, the roughness parameter z0, and the coarse terrain selector.
- [aero-model.md](aero-model.md): the vector apparent-wind formula in `pedalPower`, the yaw-angle CdA adjustment, and the 50-degree clamp for strong-tailwind cases.
- [exposure-model.md](exposure-model.md): the seven terrain exposure classes and their z0 values, the offline OSM bake pipeline for Vatternrundan, and the fallback for other routes.
- [ux-copy.md](ux-copy.md): single source for all Swedish UI labels and tooltip copy: wind, exposure, power, NP, IF, and the uncertainty interval.
- [validation.md](validation.md): the before/after NP figure from the height-correction change, what the uncertainty interval means, and the intended reference-ride replay method.
- [research/2026-05-30-reference-pass-wind.md](research/2026-05-30-reference-pass-wind.md): reference ride and historical wind data used to validate the physics and wind model.
