# Beräkningsmodell och algoritm — StickToThePlan

Fullständig teknisk beskrivning av hur appen räknar ut en pacingplan (tempokort) för Vätternrundan och andra landsvägsrutter. Syftet är att en granskare (människa eller LLM) ska kunna kontrollera fysiken, algoritmen och rimligheten utan att läsa källkoden, men med exakta filreferenser för fördjupning.

All kod ligger i `packages/core/src/`. Webbappen (`apps/web`) och CLI (`packages/cli`) konsumerar enbart denna kärna.

---

## 0. Översikt och dataflöde

```
GPX-fil ──► ingest ──► microsegment[]  ─┐
                                        ├─► pacing-solver ─► PlanResult ─► segmentering ─► tempokort / FIT / plan.json
Väder (manuell/hämtad) ─► EnsembleField ┘
```

1. **Ingest** (`ingest/gpx.ts`): GPX → ordnad lista av `MicroSegment` (~66 m styck, 4764 st för Vätternrundan 315 km). Varje microsegment har distans, lutning, bäring, start-lat/lon.
2. **Väder** (`weather/*`): antingen manuell konstant vind, hämtad ensemble, eller vindstilla. Representeras som ett `EnsembleField` (rutnätsceller med vindstyrka/riktning) plus en `WeatherFn` som svarar på vind vid (lat, lon, klockslag).
3. **Pacing-solver** (`planner.ts`, `physics.ts`, `chaingang.ts`): håller konstant förar-NP över hela rutten, löser markfart per microsegment, applicerar effekttak, lägger in stopp. Yttre bisektion justerar NP för att träffa måltiden.
4. **Segmentering** (`segmentation.ts`): slår ihop microsegment till visningssegment (tempokort-rader).
5. **Utdata** (`output/*`): markdown/HTML-tempokort, FIT-träningspass, GPX-bana, `plan.json`.

---

## 1. Enheter och teckenkonventioner

| Storhet                         | Enhet                  | Tecken                                               |
| ------------------------------- | ---------------------- | ---------------------------------------------------- |
| Fart `v`                        | m/s internt, km/h i UI | alltid ≥ 0                                           |
| Lutning `grade`                 | decimal (0.05 = 5 %)   | + uppför, − nedför                                   |
| Medvind/motvind `headwind`      | m/s                    | **+ motvind (mot vinden), − medvind**                |
| Sidvind `crosswind`             | m/s                    | tecken = sida                                        |
| Vindriktning `winddir_from_deg` | grader, meteorologisk  | riktning vinden kommer **FRÅN** (0 = nord, 90 = öst) |
| Bäring `bearing_deg`            | grader                 | färdriktning (0 = nord, 90 = öst)                    |
| Effekt                          | W                      | pedaleffekt om inget annat sägs                      |

Den enda lätta fallgropen: `headwind > 0` betyder **motvind**. `v_air = v + headwind` blir alltså mindre än markfarten i medvind (negativ headwind).

---

## 2. Indata: rutt och microsegment

`ingestGpxString` (`ingest/gpx.ts:170`):

1. **Parse** GPX-punkter (lat, lon, ele).
2. **Dedupe** (`dedupePoints`): släng punkt om haversine-avstånd till föregående behållna < 0,5 m.
3. **Utjämna höjd** (`smoothElevation`): centrerat glidande medel, udda fönster `ele_smooth_window` (default 5), trunkerat symmetriskt vid ändar.
4. **Bygg microsegment** (`buildMicroSegments`): ett segment per konsekutivt punktpar.
   - `distance_m` = haversine (`util/geo.ts:18`).
   - `bearing_deg` = forward azimut (`util/geo.ts:37`), `atan2(sin Δlon·cos lat2, cos lat1·sin lat2 − sin lat1·cos lat2·cos Δlon)`.
   - `grade` = (ele_end − ele_start) / distance, **klippt till ±`max_grade`** (default 0,18).
   - `neutral` = sant om segmentets START-kumulativa distans < `neutral_distance_km`·1000 (default 1 km).
   - `lat/lon` = startpunktens koordinater (används för väderuppslag).

Microsegmentens längd varierar med GPX-täthet (ingen omsampling). För Vätternrundan ~66 m i snitt.

---

## 3. Fysikmodell (steady-state)

`pedalPower(v, grade, headwind, p)` i `physics.ts:20`. `p` är `{m, g, crr, eta, cda, rho}`.

```
theta    = atan(grade)
F_grav   = m · g · sin(theta)                         // gravitation längs vägen
F_roll   = m · g · cos(theta) · crr                   // rullmotstånd
v_air    = v + headwind                               // skenbar luftfart längs färdaxeln
F_aero   = 0.5 · rho · CdA · v_air · |v_air|          // signerad: medvind > markfart ⇒ skjuts på
P_wheel  = (F_grav + F_roll + F_aero) · v             // effekt vid hjulet (markfart!)
P_pedal  = P_wheel / eta                              // drivlinans verkningsgrad
```

Att kontrollera:

- `F_aero` använder `v_air·|v_air|` (inte `v_air²`) så tecknet bevaras: i kraftig medvind där `v_air < 0` blir aerokraften framåtdrivande. Korrekt.
- `P_wheel` multipliceras med **markfart `v`**, inte luftfart. Korrekt (effekt = kraft × markhastighet).
- Ingen acceleration/tröghet (steady-state per segment). Rimligt för planering.

**Invers (fart givet effekt)**: `solveSpeedForPower(target, grade, headwind, p)` (`physics.ts:40`), bisektion `v ∈ [0,5, 25] m/s` (= 1,8–90 km/h), 100 iterationer, tolerans 0,01 W. Antar enkel korsning i intervallet (gäller för positiv måleffekt; effektkurvan korsar målet en gång i det positiva området).

### 3.1 Luftdensitet

`airDensity(tempC, pressurePa, relHumidity=0)` (`physics.ts:91`):

```
Rd = 287.058 J/(kg·K),  T = tempC + 273.15
torr luft:  rho = p / (Rd · T)
fuktig (om RH>0):  Tv = T / (1 − (e/p)(1 − Rd/Rv)),  rho = p / (Rd · Tv)
   es = 611.2 · exp(17.67·(T−273.15)/(T−29.65))   [Tetens],  e = RH · es,  Rv = 461.5
```

Planeraren anropar `airDensity(temp, pressure)` utan fukt (torr). Manuell vind ger temp 10 °C, tryck 101325 Pa ⇒ rho ≈ 1,247. Neutralsegment använder `rho_fallback` (1,2) men har 0 effekt ändå.

### 3.2 Yaw-justerad CdA

`yawCdaFactor(crosswind, vAir, kYaw)` (`physics.ts:125`):

```
yaw    = atan2(crosswind, vAir)         // skenbar vindvinkel
factor = 1 + kYaw · |yaw_deg| / 10      // ≥ 1
```

Multipliceras på CdA (både drag- och draftläge). `k_yaw` default 0,04 ⇒ ~8 % CdA-ökning vid 20° yaw. Modellerar att sidvind ökar effektiv frontarea.

---

## 4. Vinddekomponering

`decomposeWind(W, phiFrom, beta)` (`physics.ts:70`):

```
delta     = (phiFrom − beta) · π/180
headwind  = W · cos(delta)              // + motvind, − medvind
crosswind = W · sin(delta)
```

`phiFrom` = riktning vinden kommer från, `beta` = färdriktning. Kontroll: färd norrut (`beta=0`) med vind från norr (`phiFrom=0`) ⇒ `delta=0` ⇒ `headwind=+W` (motvind). Färd norrut med vind från söder (`phiFrom=180`) ⇒ `headwind=−W` (medvind). Korrekt.

**Viktigt**: dekomponeringen sker **per microsegment** med segmentets egen bäring (`planner.ts`, anropet i inre solven). På en slinga som Vätternrundan (söderut östra sidan, norrut västra) ger en konstant vindriktning därför korrekt växling motvind/medvind utan extra logik.

---

## 5. Gruppmodell (chaingang / paceline)

`chaingang.ts`. Gruppen roterar: varje cyklist drar fronten `pull_seconds` (default 45) av varje varv om `n_riders · pull_seconds` sekunder, resten i drafting.

```
f_front = 1 / n_riders                  (= 1.0 om solo, n_riders = 1)     [chaingang.ts:14]
CdA_pull  = yawFactor · cda_pull         (default cda_pull = 0.32)
CdA_draft = yawFactor · cda_draft        (default cda_draft = 0.21, dvs ~34 % lägre drag)
pullPower  = pedalPower med CdA_pull      [chaingang.ts:56]
draftPower = pedalPower med CdA_draft     [chaingang.ts:71]
P_mean = f_front · pullPower + (1 − f_front) · draftPower                  [chaingang.ts:86]
```

### 5.1 Förarens normaliserade effekt (NP)

Förarens effekt över ett rotationsvarv är en fyrkantsvåg: `pullPower` i `pull_seconds` sekunder, sedan `draftPower` resten. NP definieras som vanligt:

```
NP = ( medel_över_tid( rullande_30s_medel(P)^4 ) )^(1/4)
```

Referensimplementation (`riderNpSquareWaveReference`, `chaingang.ts:135`): bygg per-sekund-array över ett varv, applicera **cirkulärt** (varvet upprepas) 30-sekunders bakåtblickande glidande medel, ta fjärde-rots-medlet.

**Sluten form** (`npFromMoments`, `chaingang.ts:240`) används i solvern för fart: varje rullande medel är en konvex kombination `a_i·Pp + (1−a_i)·Pd` där `a_i` = andel av 30s-fönstret i dragfasen. `(…)^4` expanderas binomiskt; momenten `c0..c4` av belastningen `a_i` förberäknas per `(n_riders, pull_seconds)` och cachas. NP blir då en O(1)-funktion av `(Pp, Pd)`. Testbevisad ekvivalent med fyrkantsvågen inom 1e−6 (`tests/chaingang.test.ts`).

`riderNpAtSpeed(v, …)` (`chaingang.ts:266`) ⇒ NP vid given fart. Solo: NP = pullPower (konstant serie).

**Invers**: `solveSpeedForRiderNp(npTarget, …)` (`chaingang.ts:290`), bisektion `v ∈ [0,5, 25]`, 60 iter, tolerans 0,1 W på NP. Antar NP monotont växande i v.

---

## 6. Pacing-solver

### 6.1 Inre solve — `runInnerSolve(micro, npTarget, weather, cfg, startClockS)` (`planner.ts:96`)

Marscherar rutten med **konstant förar-NP = `npTarget`**:

För varje microsegment:

- **Neutralsegment** (km 0–1): fast fart `neutral_speed_kmh` (20), ingen effekt/NP.
- **Effortsegment**:
  1. `w = weather(lat, lon, startClockS + elapsed)` → vind vid rätt klockslag.
  2. `rho = airDensity(temp, pressure)`; `(headwind, crosswind) = decomposeWind(W, dirFrom, bearing)`.
  3. `v = solveSpeedForRiderNp(npTarget, grade, headwind, crosswind, rho, cfg)` → okapad fart.
  4. `pPull = pullPower(v, …)`.
  5. **Hårt tak**: om `pPull > pull_cap_hard` ⇒ sänk v så `pull = pull_cap_hard`; markera `cap='hard'`.
  6. **Mjukt tak (endast klättring)**: annars om `grade > climb_threshold` (3 %) och `pPull > pull_cap_soft` ⇒ sänk till `pull = pull_cap_soft`; `cap='soft'`.
  7. **Spinn-ur-tak**: `vMax = max_plan_speed_kmh / 3.6`; om `v > vMax` ⇒ `v = vMax`; `cap='spinout'`. Överskuggar hård/mjuk klass (det är den bindande gränsen på slutfarten).
  8. Sluteffekter: om inget tak band ⇒ `p_pull = pPull`, `rider_np = npTarget`. Annars räkna om exakt vid slutlig v. Vid `spinout` klipps `p_pull`/`p_draft` till ≥ 0 (utför kan ge negativ pedaleffekt = frihjul).
  9. `p_mean = meanPower(p_pull, p_draft, f_front)`; `time = distance / v`.

**Stopp** (`planner.ts`, stops-loopen): varje stopp läggs vid första segmentgräns där kumulativ distans ≥ `stop.km·1000`. Stoppet fördröjer det segmentets och alla efterföljandes ankomsttid (`eta_s`) med `minutes·60`.

**Totaler**: `total_time` (inkl. neutral + stopp), `rolling_time = total − stopptid`.

### 6.2 Hållbarhet — ride-NP och IF (`planner.ts`, totals)

```
ride_NP = ( Σ_eff  rider_np_w_i^4 · t_i  /  Σ_eff t_i )^(1/4)      // tidsviktat fjärde-potens-medel
IF      = ride_NP / ftp
```

Om `IF > sustain_if_warn` (0,75) läggs en svensk varningsnot. `rider_np_ride_w` och `intensity_factor` returneras på `PlanResult` (visas i UI och `plan.json`).

### 6.3 Yttre solve — `solveForTargetTime(micro, weather, cfg)` (`planner.ts:266`)

Bisektion på `npTarget` för att träffa måltiden `target_total_hm`:

```
loNp = 60,  hiNp = ftp
fastest = runInnerSolve(hiNp)                  // snabbaste hållbara
om fastest.total_time > target:
    reachable = false; returnera fastest + förklarande not
annars: bisektion npTarget ∈ [60, ftp], 45 iter, tolerans 20 s på total_time
        (total_time monotont avtagande i npTarget)
```

Alltså: NP begränsas uppåt av FTP. Når man inte måltiden ens vid NP = FTP rapporteras `reachable=false` och snabbaste plan returneras.

### 6.4 Effekttaken — designval

- `pull_cap_hard = round(pull_cap_mult · ftp)`, default `pull_cap_mult = 1,3` ⇒ 354 W vid FTP 272. **Motivering**: en 45 s frontdragning är en kort över-tröskelinsats (~1,3× FTP är realistiskt). Hållbarheten styrs av förar-**NP** (yttre solvens [60, ftp]-intervall), inte av att varje dragning hålls under FTP. Tidigare tak = FTP ströp ~95 % av segmenten i motvind och rapporterade fel "ej hållbart".
- `pull_cap_soft = round(0,92 · ftp)` = 250 W. Endast klättring > 3 %. Hindrar att gruppen spikar varje backe.
- `max_plan_speed_kmh = 50`: planeringstak. En grupp planerar inte (och bör av säkerhetsskäl inte) en kedja fortare än så i medvind/utför; överskott blir buffert, inte bankad tid. Håller medvindssträckor trovärdiga för ett tempokort.

---

## 7. Väder och scenarier

### 7.1 EnsembleField

`buildEnsemble` (`weather/ensemble.ts:109`) grupperar vindprover per (lat avrundad 0,1°, lon 0,1°, timme). Per cell: vektormedelriktning (`u = −W·sin(dir)`, `v = −W·cos(dir)`, `dir = atan2(−ū, −v̄)`), p10/p90 av skalär vindstyrka, medeltemp/tryck.

`makeWeatherFn(field, scenario, startClockS, favorableWind)` (`weather/ensemble.ts`): för varje uppslag väljs närmaste cell via `score = avstånd_m/100000 + |timdiff|/12`. Vindstyrka per scenario:

```
expected     → windspeed_mean_ms
optimistic   → favorableWind ? p90 : p10
pessimistic  → favorableWind ? p10 : p90
```

### 7.2 Manuell vind

`buildManualField` (`weather/hourly.ts:77`): en cell per timme vid ruttens centroid, `p10 = p90 = mean = användarens vindstyrka`, riktning = användarens. Alla celler samma plats ⇒ varje microsegment får samma vind ⇒ **uniform konstant vind** över hela rutten. Riktningsvariationen i motvind/medvind kommer enbart från segmentens bäring.

### 7.3 Optimistisk/pessimistisk — riktningskorrigering

Problem: att alltid välja p90 som "pessimistisk" antar att mer vind = sämre. På en **medvindsrutt** är mer vind snabbare, så etiketterna inverterar.

`routeIsNetDownwind(micro, field)` (`planner.ts`): projicera rutten på fältets dominerande (vektormedel) vindriktning:

```
exponering = Σ_eff  cos(dirFrom − bearing) · distance      // + mot vinden, − medvind
favorableWind = exponering < −0,05 · total_distans          // tydligt nät-medvind
```

- Nät-motvind eller balanserad slinga (exponering ≈ 0, t.ex. Vätternrundan): `favorableWind=false`, pessimistisk = p90 (mer vind = något långsammare pga konvexitet).
- Nät-medvind: `favorableWind=true`, pessimistisk = p10 (minst medvind = långsammast).

Dödbandet (5 % av distansen) håller balanserade slingor på det konvext korrekta defaultet. Manuell vind opåverkad (p10=p90).

---

## 8. Segmentering och display

`segment()` (`segmentation.ts:277`) slår ihop microsegment till visningsrader vid: kontrollpunkter, stopp, lutningsövergångar (platt↔backe vid `climb_threshold`), vindteckenbyten, samt slås ihop till `≤ maxSegments` och bort under `min_segment_km`.

Per visningssegment:

- **Fart** = total distans / total tid (tidsviktat).
- **`avg_w`** = medel av `p_mean_w` (förarens rotationsmedeleffekt). **Detta är W-kolumnen i tempokortet.**
- **`pull_w_low/high`** = pull-medel · (1 ± `band_pct`), default ±5 %.
- **Vindetikett** från medel-headwind/crosswind: `Mot`/`Med`/`Sido` X m/s.

OBS skillnaden: tempokortets W-kolumn = **medeleffekt** (~190 W i exemplet), medan scenariots "Effektmål / NP" = `np_target_used` (mål-NP). Efter cap kan uppnådd ride-NP vara lägre; UI visar nu både mål-NP, förar-NP och IF.

---

## 9. Konstanter och defaults (`config.ts`)

| Parameter                | Default      | Roll                       |
| ------------------------ | ------------ | -------------------------- |
| `m`                      | 96 kg        | cyklist + cykel            |
| `cda_pull`               | 0,32         | CdA fronten                |
| `cda_draft`              | 0,21         | CdA drafting (~34 % lägre) |
| `crr`                    | 0,0045       | rullmotstånd               |
| `eta`                    | 0,97         | drivlina                   |
| `g`                      | 9,81         | tyngdacceleration          |
| `pull_seconds`           | 45           | dragningslängd             |
| `pull_cap_mult`          | 1,3          | hårt tak = mult · ftp      |
| `max_plan_speed_kmh`     | 50           | spinn-ur/planeringstak     |
| `sustain_if_warn`        | 0,75         | IF-varningströskel         |
| `climb_threshold`        | 0,03         | platt/backe-gräns          |
| `k_yaw`                  | 0,04         | yaw-CdA-känslighet         |
| `neutral_speed_kmh`      | 20           | neutralisering km 0–1      |
| `max_grade`              | 0,18         | klipp lutning              |
| `ele_smooth_window`      | 5            | höjdutjämning              |
| `band_pct`               | 0,05         | effektband ±5 %            |
| `ftp`                    | 272 (indata) | tröskeleffekt              |
| `n_riders`               | 12 (indata)  | gruppstorlek               |
| Härlett: `pull_cap_hard` | 354          | = round(1,3·272)           |
| Härlett: `pull_cap_soft` | 250          | = round(0,92·272)          |
| Härlett: `solo`          | false        | n_riders === 1             |

Ankaret `np_target` (FIT eller 0,60·FTP fallback, `ingest/fit.ts`) är informativt; den tidsstyrda solvern bisekterar NP oavsett.

---

## 10. Antaganden och kända begränsningar

För granskaren, detta är medvetna förenklingar:

1. **Steady-state per segment**: ingen acceleration/tröghet. Vid 66 m-segment försumbart.
2. **Konstant förar-NP över hela loppet**: modellen jämnar effekten. Mot-/medvinds-asymmetrin i fart är inneboende (konstant effekt ⇒ medvind ger hög fart, motvind låg). Spinn-ur-taket dämpar medvindssidan.
3. **`f_front = 1/n_riders`** oberoende av `pull_seconds` (dragningslängd påverkar bara NP-variabiliteten, inte medelandelen front).
4. **Draftmodell** = lägre CdA (0,21 vs 0,32), inte explicit avståndsberoende. Ger ~34 % dragreduktion i drafting.
5. **Pull-taket (1,3·FTP)** är en grov över-tröskelgräns, inte en kraft-varaktighetskurva. Skalar inte med `pull_seconds`.
6. **Spinn-ur-taket** är en planeringsgräns (50 km/h), inte en kadens/utväxlingsmodell. Kapar även branta utförsbackar (konservativt; ~0,5 min på 315 km vindstilla).
7. **Optimistisk/pessimistisk** fångar vindstyrke-osäkerhet (p10/p90) + nät-riktning, inte full riktningsosäkerhet per cell.
8. **Lutning klippt ±18 %**, höjd utjämnad (fönster 5). GPX-brus i höjd kan annars ge falska branta segment.
9. **NP mellan segment**: ride-NP approximeras som tidsviktat fjärde-potens-medel av segmentens NP (30 s-randeffekter mellan segment försummas).

---

## 11. Validering — vad en granskare bör kontrollera

### 11.1 Fysik mot lärobok (platt, ρ = 1,225, m = 96, CdA = 0,32, Crr = 0,0045, η = 0,97)

Vid konstant **pull-effekt 272 W**, markfart mot vind:

| motvind | +10  | +5   | +3   | 0    | −3   | −5   | −10 (medvind) |
| ------- | ---- | ---- | ---- | ---- | ---- | ---- | ------------- |
| km/h    | 19,0 | 27,1 | 31,0 | 37,4 | 44,5 | 49,5 | 62,8          |

Dessa matchar standardcykelfysik (`P = v·(Crr·m·g + 0,5·ρ·CdA·(v+hw)²)/η`) på decimalen. Kontrollera gärna 0-vindspunkten 37,4 km/h och +10-punkten 19,0 km/h för hand.

### 11.2 Föreslagna testfall (utöver befintliga 309)

- **Symmetri**: `decomposeWind(W, φ, β)` vs `decomposeWind(W, φ, β+180)` ⇒ headwind byter tecken, |crosswind| lika.
- **Grad/radian**: `pedalPower` med `grade = tan(5°)` ⇒ `F_grav = m·g·sin(atan(tan5°))`; verifiera mot `m·g·sin(5°)`.
- **Spinn-ur**: stark medvind + hög NP ⇒ inget effortsegment > `max_plan_speed_kmh`, någon `cap='spinout'`, ingen negativ effekt. (finns: `tests/headwind-caps.test.ts`)
- **Över-FTP-dragning**: motvind + NP nära FTP ⇒ någon `p_pull_w > ftp` men `≤ pull_cap_hard`. (finns)
- **IF-varning**: hård plan ⇒ `intensity_factor > sustain_if_warn` och not med "IF". (finns)
- **Nät-medvind-inversion**: medvindsrutt ⇒ pessimistisk långsammare än optimistisk. (finns: `tests/scenarios.test.ts`)
- **Monotoni-edge**: förar-NP vid stark medvind där `v_air` korsar 0 (pull kan bli negativ, fjärde-potens i NP). Idag löser cap/clamp det; bör täckas av test.

### 11.3 Rimlighetsgränser appen redan varnar för

- `reachable = false` när måltid ohållbar ens vid NP = FTP.
- IF-not när `ride_NP / ftp > 0,75`.
- Cap-not med antal hard/soft/spinout-bundna segment och flyttad tid.

### 11.4 Jämför vindens påverkan (0 / 3 / 5 / 10 m/s)

Kör samma rutt/config över vindstyrkorna och granska:

- Snittfart per kontrollsträcka och total tid.
- Att medvindssträckor ≤ `max_plan_speed_kmh`.
- Att motvindssträckor inte kollapsar (Vätternrundan: ~20 km/h vid 10 m/s, inte ~0).
- Att `np_target_used` och IF växer monotont med vindstyrkan.
- Att 0/3/5 m/s är `reachable=true` vid 11:45 och 10 m/s blir reachable med IF-varning (~0,80).

---

## 12. Filreferenser

| Område                                          | Fil                                     |
| ----------------------------------------------- | --------------------------------------- |
| Fysik (krafter, densitet, yaw, vind, NP)        | `packages/core/src/physics.ts`          |
| Gruppmodell (drag/draft, NP-sluten form)        | `packages/core/src/chaingang.ts`        |
| Pacing-solver (inre/yttre, caps, IF, scenarier) | `packages/core/src/planner.ts`          |
| Konfiguration och defaults                      | `packages/core/src/config.ts`           |
| Typer                                           | `packages/core/src/types.ts`            |
| Ingest GPX → microsegment                       | `packages/core/src/ingest/gpx.ts`       |
| Geo (haversine, bäring)                         | `packages/core/src/util/geo.ts`         |
| Väderensemble + WeatherFn                       | `packages/core/src/weather/ensemble.ts` |
| Manuell/timvis vind                             | `packages/core/src/weather/hourly.ts`   |
| Segmentering (tempokort-rader)                  | `packages/core/src/segmentation.ts`     |
| Tester                                          | `packages/core/tests/*.test.ts`         |
