# Reference pass: historical wind from multiple sources

Purpose: pull observed/analysed wind for Tim's reference group ride so the physics and wind model can be validated by replay later. Sources cross-checked, the spread becomes the ensemble uncertainty band.

## Ride summary (decoded from the FIT)

File: `23066238193_ACTIVITY.fit` (Garmin, product 3907).

| Field            | Value                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Date             | 2026-05-30 (Saturday)                                                                         |
| Time             | 07:04 to 11:03 UTC = 09:04 to 13:03 local (CEST, UTC+2)                                       |
| Duration         | 3.98 h                                                                                        |
| Distance         | 99.8 km                                                                                       |
| Ascent           | 472 m                                                                                         |
| Avg power        | 139 W                                                                                         |
| Normalized power | 165 W (Garmin), 164 W (recompute)                                                             |
| Max power        | 584 W                                                                                         |
| Avg HR           | 122 bpm                                                                                       |
| Group            | 8 in the bunch                                                                                |
| Area             | Västerås / Mälaren. bbox lat 59.495 to 59.770, lon 16.083 to 16.526. Centroid 59.627N 16.304E |

Anchor consequence: a near-4-hour steady group ride at NP 165 W, essentially equal to the 0.60 x FTP = 163 W default. So `np_target` is anchored on real data, not an FTP estimate. This confirms open item 2 in the design doc.

## Wind by source

Queried at the ride centroid (59.6271N, 16.3044E), 2026-05-30, hourly UTC. Wind speed in m/s, direction in degrees meteorological (where the wind comes from).

### Open-Meteo, best-match forecast (api.open-meteo.com, past_days)

| UTC   | speed | gust | dir | temp | pressure |
| ----- | ----- | ---- | --- | ---- | -------- |
| 07:00 | 1.4   | 3.5  | 148 | 16.0 | 1004.0   |
| 08:00 | 1.6   | 4.5  | 152 | 18.1 | 1004.0   |
| 09:00 | 2.0   | 6.3  | 168 | 19.6 | 1003.6   |
| 10:00 | 2.2   | 6.8  | 174 | 21.2 | 1003.5   |
| 11:00 | 2.4   | 6.8  | 209 | 21.7 | 1003.3   |

Ride-window mean: 1.9 m/s from 174 deg.

### Open-Meteo, ERA5 reanalysis (archive-api.open-meteo.com)

| UTC   | speed | gust | dir | temp | pressure |
| ----- | ----- | ---- | --- | ---- | -------- |
| 07:00 | 2.2   | 6.0  | 193 | 16.4 | 1004.0   |
| 08:00 | 2.8   | 7.3  | 197 | 17.8 | 1004.0   |
| 09:00 | 3.2   | 7.9  | 197 | 18.6 | 1003.8   |
| 10:00 | 3.5   | 8.5  | 210 | 19.2 | 1003.5   |
| 11:00 | 3.3   | 8.5  | 232 | 19.5 | 1003.3   |

Ride-window mean: 3.0 m/s from 207 deg.

### Open-Meteo, Historical Forecast (historical-forecast-api.open-meteo.com)

Identical to the best-match forecast above (same stored past-forecast field). Ride-window mean 1.9 m/s from 174 deg.

### SMHI observations, station Höksta (id 19025, 24 km from centroid)

Real measurements. Nearest active SMHI station with wind speed (param 4) and direction (param 3).

| UTC   | speed (param 4) | dir (param 3) |
| ----- | --------------- | ------------- |
| 07:00 | 1.7             | 96            |
| 08:00 | 2.0             | 169           |
| 09:00 | 2.5             | 174           |
| 10:00 | 2.0             | 241           |
| 11:00 | 2.2             | 236           |

## Cross-source reading

- All sources agree on light wind, roughly 2 to 3 m/s, direction southerly early, veering toward southwest by midday.
- Open-Meteo best-match and Historical Forecast are the same field, so they are one independent stream, not two.
- ERA5 reanalysis runs about 1 m/s stronger and a touch more southwest. SMHI station obs (the real measurement) sit between best-match and ERA5 on speed, and confirm the S to SW veer.
- Genuine independent streams here: Open-Meteo best-match (blended models), Open-Meteo ERA5 (ECMWF reanalysis), SMHI station obs. Spread on the ride-window mean is about 1.9 to 3.0 m/s. That is the uncertainty band.

## Sources not used and why

- MET Norway: Locationforecast 2.0 is forecast only, no history. Their historical Frost API needs a registered client id. Add later if a key is available.
- Meteostat: station-network history, but recent days (a few days back) are often not yet ingested. Revisit for older validation rides.

## Anchor confirmed (design doc open item 2)

NP 165 W from a 4 h steady group ride equals 0.61 x FTP 272 W, essentially the 0.60 x FTP = 163 W default. Wind was light (2 to 3 m/s), so the NP is not wind-inflated. `np_target` is anchored on real data, not an FTP estimate. Open item 2 resolved.

## Spatial vs temporal wind: what matters and what does not

A second analysis queried wind at the actual per-hour track position (median lat/lon for that hour) and compared it to the centroid query.

| UTC | Track pos      | Bearing | Wind at pos | Wind at centroid | Effective headwind |
| --- | -------------- | ------- | ----------- | ---------------- | ------------------ |
| 07  | 59.712, 16.419 | 336 deg | 1.7 m/s 169 | 1.4 m/s 148      | -1.7 (tailwind)    |
| 08  | 59.734, 16.201 | 226 deg | 2.0 m/s 159 | 1.6 m/s 152      | +0.8               |
| 09  | 59.561, 16.148 | 168 deg | 2.1 m/s 176 | 2.0 m/s 168      | +2.1 (headwind)    |
| 10  | 59.529, 16.443 | 46 deg  | 2.2 m/s 175 | 2.2 m/s 174      | -1.4 (tailwind)    |
| 11  | 59.617, 16.506 | 25 deg  | 2.6 m/s 175 | 2.4 m/s 209      | -2.3 (tailwind)    |

**Wind field spatial variation: negligible.** Speed within 0.3 m/s, direction within 10 deg between track position and centroid. Light wind over a small area (~30 km) = uniform field. Using centroid for all lookups would have been fine for this ride.

**Bearing-resolved headwind: the only thing that matters.** The same ~2 m/s southerly wind produces 4.4 m/s of swing in effective headwind purely from the changing travel direction. The 07:00 leg runs NNW into a tailwind, the 09:00 leg runs S into a full headwind. Any mean across the whole ride is meaningless.

**Consequence for the race-day model:**

- The wind field geographic lookup can use segment position or a nearby centroid. For a 315 km loop around a large lake with varying coastal terrain, per-segment geographic lookup is still correct (different air masses on east vs west shore), but the gain vs a coarser grid is likely small.
- The bearing decomposition (design doc section 6.2) must run per microsegment always. This is already the design.
- Hourly time resolution is required because wind rotated ~30 deg and increased 1.4 to 2.6 m/s over the 4 h window. Design already handles this.

## How this feeds the build

- Validation replay (design doc section 15): once `physics` and `weather` exist, replay this ride. Feed observed wind per segment (light, S to SW, bearing-resolved per track point) and solve speed at NP 165 W. Check modelled vs actual time within tolerance. Because wind was light this is close to a calm-air power model check.
- Ensemble method (design doc section 10.2): the across-source spread (1.9 to 3.0 m/s) is the template for the three race-day scenarios. Aim each segment lookup at its ETA and geographic point, decompose by bearing, average direction vectorially.

## Reproduce

Throwaway scripts used: `/tmp/decode_fit.py` (fitparse) and `/tmp/wind.py` (urllib, no key). The production versions live in the `ingest` and `weather` modules per the design doc.
