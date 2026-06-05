# UX copy: Swedish labels and tooltips

This is the single source of truth for all Swedish UI strings related to wind, exposure, power, and the uncertainty interval. When the UI adds or changes a label, update this file first.

---

## Power and effort

| Key                             | Label / copy                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| NP target                       | "Mål-NP" or "NP" (normalized power, the rider's target effort)                                                                  |
| IF (intensity factor)           | "IF" (intensitetsfaktor, NP / FTP)                                                                                              |
| IF warning                      | "Planen kräver IF X.XX (förar-NP YYY W av FTP ZZZ W). Det är en hård dagsinsats; kontrollera att gruppen håller den uthålligt." |
| Pull power                      | "Drag" (the power on the front)                                                                                                 |
| Draft power                     | "Slipström" (the power while drafting)                                                                                          |
| Mean power (tempokort W column) | "Medel W"                                                                                                                       |
| Power band                      | "Drag-band" or "+/- 5 %" (the +-5% pull-power range shown in the tempokort)                                                     |
| FTP                             | "FTP" (tröskeleffekt, threshold power)                                                                                          |

---

## Wind labels (tempokort rows)

| Condition | Label format |
| --------- | ------------ |
| Headwind  | "Mot X m/s"  |
| Tailwind  | "Med X m/s"  |
| Crosswind | "Sido X m/s" |

---

## Exposure classes (Swedish labels)

Used in the exposure selector and in data-quality tooltips.

| ExposureClass | Swedish label |
| ------------- | ------------- |
| `open`        | Öppet         |
| `semi_open`   | Halvöppet     |
| `sheltered`   | Skyddat       |
| `forest`      | Skog          |
| `urban`       | Bebyggt       |
| `water`       | Vattennära    |
| `bridge`      | Bro           |

---

## Effective wind

| Context                       | Label / copy                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effective wind tooltip        | "Effektiv vind: prognosen ges på 10 m höjd; cyklisten känner vinden på ca 1.2 m. Modellen skalar ned med logaritmisk vindprofil och terrängens skrovlighet (z0)." |
| Wind correction disabled note | "Vindkorrektion avstängd: vinden behandlas som redan på rytternivå (t.ex. egen uppskattad känsla)."                                                               |
| Roughness / terrain           | "Terrängklass" or "Exponering"                                                                                                                                    |

---

## Uncertainty interval (spann)

| Context                   | Label / copy                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headline with interval    | "Beräknad tid H:MM (rimligt spann H:MM–H:MM)"                                                                                                        |
| Headline, no interval     | "Beräknad tid H:MM (spann saknas)"                                                                                                                   |
| Spann explanation tooltip | "Spannet visas om optimistisk och pessimistisk vind-scenario ger mer än en minuts skillnad. Siffrorna speglar vindosäkerhet, inte rytterprestation." |
| Source label              | "Källa: scenario"                                                                                                                                    |

---

## Data quality (exposure and weather)

| Context                           | Label / copy                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| Exposure source, baked            | "Exponering: inbakad (OSM)"                                                             |
| Exposure source, terrain          | "Exponering: terrängselektorn (grov)"                                                   |
| Exposure coverage OK              | "Exponeringstäckning: XX %"                                                             |
| Exposure coverage warning (< 60%) | "Exponeringstäckning låg (XX %): terrängselektorn används för oklassificerade segment." |
| Weather source, manual            | "Vind: manuell"                                                                         |
| Weather source, forecast          | "Vind: prognos"                                                                         |

---

## Cap notes (inner solve, English in code, potentially surfaced in UI)

The inner-solve cap notes are already in English in the planner code. If ever surfaced in the Swedish UI, translate as:

| English                        | Swedish                            |
| ------------------------------ | ---------------------------------- |
| "hard cap bound on N segments" | "Hårdtak på N segment"             |
| "soft cap bound on N segments" | "Mjuktak på N segment (klättring)" |
| "spin-out cap on N segments"   | "Hastighetstak på N segment"       |
