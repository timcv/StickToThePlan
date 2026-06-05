// Dev-only. Classifies the built-in route's microsegments from OpenStreetMap
// and writes a committed static exposure file. NOT run at solve time.
// Usage: node scripts/bake-exposure.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const GPX = 'data/vatternrundan-315km.gpx';
const OUT = 'data/vatternrundan-exposure.json';
const ROUTE_ID = 'vatternrundan-315km';
// Try the French mirror first — it tends to be less loaded.
// Fall back to the primary German instance on errors.
const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
// Overpass rate-limits to 2 concurrent slots; spacing requests avoids 429s.
const DELAY_MS = 2500;
const MAX_RETRIES = 6;

// Downsample route for tiled queries — one sample per ~5 km avoids
// querying tens-of-thousands of tiny boxes while still covering the route.
const TILE_STEP_KM = 5;
const TILE_PAD_DEG = 0.015; // ~1.67 km N-S, ~0.88 km E-W at 58°N; keep TILE_STEP_KM <= ~2x the smaller (E-W) value or tiles leave gaps

function parsePoints(xml) {
  const pts = [];
  const re = /<trkpt[^>]*lat="([\d.-]+)"[^>]*lon="([\d.-]+)"/g;
  let m;
  while ((m = re.exec(xml))) pts.push({ lat: +m[1], lon: +m[2] });
  return pts;
}

function haversine(a, b) {
  const R = 6371000; // Earth mean radius (m)
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLon = toR(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTile(bbox) {
  const q = `[out:json][timeout:90];
(
  way["natural"="wood"](${bbox});
  way["landuse"="forest"](${bbox});
  way["natural"="water"](${bbox});
  way["waterway"="riverbank"](${bbox});
  way["landuse"="residential"](${bbox});
  way["landuse"="commercial"](${bbox});
  way["landuse"="industrial"](${bbox});
  way["bridge"="yes"](${bbox});
);
out geom;`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[(attempt - 1) % OVERPASS_ENDPOINTS.length];
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(q)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'bake-exposure/1.0 (StickToThePlan dev tool; contact tim@haus.se)',
        },
        signal: AbortSignal.timeout(90_000),
      });
    } catch (fetchErr) {
      const wait = DELAY_MS * attempt;
      console.log(
        `  fetch error (attempt ${attempt}/${MAX_RETRIES}): ${fetchErr.message} — waiting ${wait} ms`,
      );
      await sleep(wait);
      continue;
    }
    if (res.status === 429 || res.status === 504 || res.status === 503 || res.status === 502) {
      const wait = DELAY_MS * attempt * 2;
      console.log(
        `  HTTP ${res.status} — waiting ${wait} ms before retry ${attempt}/${MAX_RETRIES} (${endpoint})`,
      );
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status} for bbox ${bbox} (${endpoint})`);
    const json = await res.json();
    return json.elements ?? [];
  }
  throw new Error(`Overpass: exceeded ${MAX_RETRIES} retries for bbox ${bbox}`);
}

function classOf(el) {
  const t = el.tags ?? {};
  if (t.bridge === 'yes') return 'bridge';
  if (t.natural === 'water' || t.waterway === 'riverbank') return 'water';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'forest';
  if (t.landuse === 'residential' || t.landuse === 'commercial' || t.landuse === 'industrial')
    return 'urban';
  return null;
}

function inPoly(pt, geom) {
  let inside = false;
  for (let i = 0, j = geom.length - 1; i < geom.length; j = i++) {
    const xi = geom[i].lon,
      yi = geom[i].lat,
      xj = geom[j].lon,
      yj = geom[j].lat;
    const hit =
      yi > pt.lat !== yj > pt.lat && pt.lon < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function classifyPoint(pt, polys) {
  // Priority: bridge > water > forest > urban > semi_open (default)
  const order = ['bridge', 'water', 'forest', 'urban'];
  for (const cls of order) {
    for (const poly of polys) {
      if (poly.cls === cls && poly.geom.length > 2 && inPoly(pt, poly.geom)) return cls;
    }
  }
  return 'semi_open';
}

function toRuns(perSegClass, cumKm) {
  const runs = [];
  let start = 0;
  for (let i = 1; i <= perSegClass.length; i++) {
    if (i === perSegClass.length || perSegClass[i] !== perSegClass[start]) {
      runs.push({
        from_km: +cumKm[start].toFixed(3),
        to_km: +cumKm[i].toFixed(3),
        class: perSegClass[start],
      });
      start = i;
    }
  }
  return runs;
}

// Build cumulative km distances and pick tile-centre points every TILE_STEP_KM.
function buildTileCentres(pts, cumKm) {
  const centres = [];
  let nextThreshold = 0;
  for (let i = 0; i < pts.length; i++) {
    if (cumKm[i] >= nextThreshold) {
      centres.push(pts[i]);
      nextThreshold = cumKm[i] + TILE_STEP_KM;
    }
  }
  // Always include last point so the tail of the route is covered.
  const last = pts[pts.length - 1];
  const prev = centres[centres.length - 1];
  if (prev.lat !== last.lat || prev.lon !== last.lon) centres.push(last);
  return centres;
}

// --- Main ---

const xml = readFileSync(GPX, 'utf8');
const pts = parsePoints(xml);
if (pts.length < 2) throw new Error('no trackpoints found in GPX');

// Build cumKm for all points first (needed for tile selection).
const cumKm = [0];
for (let i = 0; i < pts.length - 1; i++) {
  cumKm.push(cumKm[i] + haversine(pts[i], pts[i + 1]) / 1000);
}
const totalKm = cumKm[cumKm.length - 1];
console.log(`points=${pts.length}  totalKm=${totalKm.toFixed(1)}`);

const centres = buildTileCentres(pts, cumKm);
console.log(`tiles=${centres.length} (one per ~${TILE_STEP_KM} km, pad ±${TILE_PAD_DEG}°)`);

// Fetch all tiles, deduplicate polygons by element id.
const seen = new Set();
const polys = [];
let tilesDone = 0;

for (const c of centres) {
  const bbox = [
    (c.lat - TILE_PAD_DEG).toFixed(6),
    (c.lon - TILE_PAD_DEG).toFixed(6),
    (c.lat + TILE_PAD_DEG).toFixed(6),
    (c.lon + TILE_PAD_DEG).toFixed(6),
  ].join(',');

  // Respectful pacing — Overpass rate-limits to 2 concurrent slots.
  if (tilesDone > 0) await sleep(DELAY_MS);

  let elements;
  try {
    elements = await fetchTile(bbox);
  } catch (err) {
    console.error(`  tile ${tilesDone + 1}/${centres.length} FAILED: ${err.message}`);
    throw err;
  }

  for (const el of elements) {
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    const cls = classOf(el);
    const geom = el.geometry ?? [];
    if (cls && geom.length > 2) polys.push({ cls, geom });
  }

  tilesDone++;
  if (tilesDone % 10 === 0 || tilesDone === centres.length) {
    process.stdout.write(
      `  ${tilesDone}/${centres.length} tiles done, polys so far=${polys.length}\n`,
    );
  }
}

console.log(`\npolygons total (deduped)=${polys.length}`);

// Classify each segment midpoint.
const perSeg = [];
for (let i = 0; i < pts.length - 1; i++) {
  const mid = {
    lat: (pts[i].lat + pts[i + 1].lat) / 2,
    lon: (pts[i].lon + pts[i + 1].lon) / 2,
  };
  perSeg.push(classifyPoint(mid, polys));
}

const runs = toRuns(perSeg, cumKm);
const hist = perSeg.reduce((h, c) => ((h[c] = (h[c] ?? 0) + 1), h), {});
console.log('class histogram:', hist);
console.log(`runs: ${runs.length}`);

const bridgeRuns = runs.filter((r) => r.class === 'bridge');
if (bridgeRuns.length === 0) {
  console.warn(
    'WARNING: no bridge runs found. Bridge ways on Vättern are tagged bridge=yes ' +
      'on the way itself, which Overpass returns only when the tile covers that location. ' +
      'Consider raising TILE_PAD_DEG or checking the Overpass query.',
  );
} else {
  console.log(`bridge runs: ${bridgeRuns.length}`, bridgeRuns);
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      route_id: ROUTE_ID,
      generated_note:
        'OSM/Overpass bake; classes literature-mapped to z0 in core/weather/effective.ts',
      total_km: +totalKm.toFixed(3),
      runs,
    },
    null,
    2,
  ),
);
console.log(`\nwrote ${OUT}`);
