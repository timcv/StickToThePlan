# Reference pass: historical wind from multiple sources

Purpose: pull observed/analysed wind for Tim's reference group ride so the physics and wind model can be validated by replay later. Sources cross-checked, the spread becomes the ensemble uncertainty band.

## Ride summary (decoded from the FIT)

File: `23066238193_ACTIVITY.fit` (Garmin, product 3907).

| Field | Value |
|---|---|
| Date | 2026-05-30 (Saturday) |
| Time | 07:04 to 11:03 UTC = 09:04 to 13:03 local (CEST, UTC+2) |
| Duration | 3.98 h |
| Distance | 99.8 km |
| Ascent | 472 m |
| Avg power | 139 W |
| Normalized power | 165 W (Garmin), 164 W (recompute) |
| Max power | 584 W |
| Avg HR | 122 bpm |
| Group | 8 in the bunch |
| Area | Västerås / Mälaren. bbox lat 59.495 to 59.770, lon 16.083 to 16.526. Centroid 59.627N 16.304E |

Anchor consequence: a near-4-hour steady group ride at NP 165 W, essentially equal to the 0.60 x FTP = 163 W default. So `np_target` is anchored on real data, not an FTP estimate. This confirms open item 2 in the design doc.

## Wind by source

Queried at the ride centroid (59.6271N, 16.3044E), 2026-05-30, hourly UTC. Wind speed in m/s, direction in degrees meteorological (where the wind comes from).

### Open-Meteo, best-match forecast (api.open-meteo.com, past_days)
| UTC | speed | gust | dir | temp | pressure |
|---|---|---|---|---|---|
| 07:00 | 1.4 | 3.5 | 148 | 16.0 | 1004.0 |
| 08:00 | 1.6 | 4.5 | 152 | 18.1 | 1004.0 |
| 09:00 | 2.0 | 6.3 | 168 | 19.6 | 1003.6 |
| 10:00 | 2.2 | 6.8 | 174 | 21.2 | 1003.5 |
| 11:00 | 2.4 | 6.8 | 209 | 21.7 | 1003.3 |

Ride-window mean: 1.9 m/s from 174 deg.

### Open-Meteo, ERA5 reanalysis (archive-api.open-meteo.com)
| UTC | speed | gust | dir | temp | pressure |
|---|---|---|---|---|---|
| 07:00 | 2.2 | 6.0 | 193 | 16.4 | 1004.0 |
| 08:00 | 2.8 | 7.3 | 197 | 17.8 | 1004.0 |
| 09:00 | 3.2 | 7.9 | 197 | 18.6 | 1003.8 |
| 10:00 | 3.5 | 8.5 | 210 | 19.2 | 1003.5 |
| 11:00 | 3.3 | 8.5 | 232 | 19.5 | 1003.3 |

Ride-window mean: 3.0 m/s from 207 deg.

### Open-Meteo, Historical Forecast (historical-forecast-api.open-meteo.com)
Identical to the best-match forecast above (same stored past-forecast field). Ride-window mean 1.9 m/s from 174 deg.

### SMHI observations, station Höksta (id 19025, 24 km from centroid)
Real measurements. Nearest active SMHI station with wind speed (param 4) and direction (param 3).

| UTC | speed (param 4) | dir (param 3) |
|---|---|---|
| 07:00 | 1.7 | 96 |
| 08:00 | 2.0 | 169 |
| 09:00 | 2.5 | 174 |
| 10:00 | 2.0 | 241 |
| 11:00 | 2.2 | 236 |

## Cross-source reading

- All sources agree on light wind, roughly 2 to 3 m/s, direction southerly early, veering toward southwest by midday.
- Open-Meteo best-match and Historical Forecast are the same field, so they are one independent stream, not two.
- ERA5 reanalysis runs about 1 m/s stronger and a touch more southwest. SMHI station obs (the real measurement) sit between best-match and ERA5 on speed, and confirm the S to SW veer.
- Genuine independent streams here: Open-Meteo best-match (blended models), Open-Meteo ERA5 (ECMWF reanalysis), SMHI station obs. Spread on the ride-window mean is about 1.9 to 3.0 m/s. That is the uncertainty band.

## Sources not used and why
- MET Norway: Locationforecast 2.0 is forecast only, no history. Their historical Frost API needs a registered client id. Add later if a key is available.
- Meteostat: station-network history, but recent days (a few days back) are often not yet ingested. Revisit for older validation rides.

## How this feeds the build
- Validation replay (design doc section 15): once `physics` and `weather` exist, replay this ride. Feed observed wind (light, S to SW) and the route, solve speed at NP 165 W, and check the modelled speed and time match the actual ride within tolerance. Because the wind was light, this is close to a calm-air check of the core power model.
- Ensemble method (design doc section 10.2): the across-source spread shown here is the template for the three race-day scenarios. Aim each segment lookup at its ETA and geographic point, average direction vectorially.

## Reproduce
Throwaway scripts used: `/tmp/decode_fit.py` (fitparse) and `/tmp/wind.py` (urllib, no key). The production versions live in the `ingest` and `weather` modules per the design doc.
