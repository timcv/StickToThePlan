# UX copy — Swedish labels and tooltips

This is the single source of truth for all Swedish UI strings related to wind, exposure, power, and the uncertainty interval. When the UI adds or changes a label, update this file first.

---

## Power and effort

| Key                             | Label / copy                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| NP target                       | "Mal-NP" or "NP" (normalized power, the rider's target effort)                                                                   |
| IF (intensity factor)           | "IF" (intensitetsfaktor, NP / FTP)                                                                                               |
| IF warning                      | "Planen kraver IF X.XX (forar-NP YYY W av FTP ZZZ W). Det ar en hard dagsinsats; kontrollera att gruppen haller den uthallligt." |
| Pull power                      | "Drag" (the power on the front)                                                                                                  |
| Draft power                     | "Slipstrom" (the power while drafting)                                                                                           |
| Mean power (tempokort W column) | "Medel W"                                                                                                                        |
| Power band                      | "Drag-band" or "+/- 5 %" (the +-5% pull-power range shown in the tempokort)                                                      |
| FTP                             | "FTP" (troskeleleffekt, threshold power)                                                                                         |

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
| `open`        | Oppet         |
| `semi_open`   | Halvoppet     |
| `sheltered`   | Skyddat       |
| `forest`      | Skog          |
| `urban`       | Bebyggt       |
| `water`       | Vattennara    |
| `bridge`      | Bro           |

---

## Effective wind

| Context                       | Label / copy                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effective wind tooltip        | "Effektiv vind: prognosen ges pa 10 m hojd; cyklisten kanner vinden pa ca 1.2 m. Modellen skalar ned med logaritmisk vindprofil och terrangens kastrighet (z0)." |
| Wind correction disabled note | "Vindkorrektion avstangd: vinden behandlas som redan pa rytterniva (t.ex. egen uppskattad kansla)."                                                              |
| Roughness / terrain           | "Terrangklass" or "Exponering"                                                                                                                                   |

---

## Uncertainty interval (spann)

| Context                   | Label / copy                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Headline with interval    | "Beraknad tid H:MM (rimligt spann H:MM–H:MM)"                                                                                                          |
| Headline, no interval     | "Beraknad tid H:MM (spann saknas)"                                                                                                                     |
| Spann explanation tooltip | "Spannet visas om optimistisk och pessimistisk vind-scenario ger mer an en minuts skillnad. Siffrorna speglar vindosakekerhet, inte rytterprestation." |
| Source label              | "Kalla: scenario"                                                                                                                                      |

---

## Data quality (exposure and weather)

| Context                           | Label / copy                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| Exposure source, baked            | "Exponering: inbakad (OSM)"                                                             |
| Exposure source, terrain          | "Exponering: terrangselektor (grov)"                                                    |
| Exposure coverage OK              | "Exponeringstackning: XX %"                                                             |
| Exposure coverage warning (< 60%) | "Exponeringstackning lag (XX %) — terrangselektorn anvands for okassificerade segment." |
| Weather source, manual            | "Vind: manuell"                                                                         |
| Weather source, forecast          | "Vind: prognos"                                                                         |

---

## Cap notes (inner solve, English in code, potentially surfaced in UI)

The inner-solve cap notes are already in English in the planner code. If ever surfaced in the Swedish UI, translate as:

| English                        | Swedish                            |
| ------------------------------ | ---------------------------------- |
| "hard cap bound on N segments" | "Hardtak pa N segment"             |
| "soft cap bound on N segments" | "Mjuktak pa N segment (klattring)" |
| "spin-out cap on N segments"   | "Hastighetstak pa N segment"       |
