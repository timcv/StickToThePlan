/**
 * gen-sample-route.mjs
 *
 * Deterministic synthetic cycling loop generator.
 * Produces examples/sample-route.gpx -- a copyright-safe route with no
 * connection to any real named road or race.
 *
 * Usage:
 *   node examples/scripts/gen-sample-route.mjs
 *
 * Requirements:
 *   - Node 22, ESM, zero external dependencies.
 *   - Deterministic: fixed LCG seed; re-runs produce byte-identical output.
 *   - Valid GPX 1.1 with <trk><trkseg> and <trkpt lat lon><ele>.
 *   - Closed-ish loop near lat 59.0, lon 15.0.
 *   - 600-1200 track points at realistic spacing.
 *   - Elevations 50-400 m, smooth, with a few climbs (200+ m total ascent).
 *
 * No em dashes anywhere in this file.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// LCG (Linear Congruential Generator) -- deterministic, seeded
// ---------------------------------------------------------------------------
// Parameters from Knuth Vol 2 (MMIX): multiplier 6364136223846793005,
// modulus 2^64. We work in 32-bit safe integer space using a simpler LCG.
// Parameters from Numerical Recipes: m=2^32, a=1664525, c=1013904223.

function makeLCG(seed) {
  let state = seed >>> 0; // force uint32
  return {
    // Returns a float in [0, 1)
    next() {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    },
    // Returns a float in [lo, hi)
    range(lo, hi) {
      return lo + this.next() * (hi - lo);
    },
  };
}

// ---------------------------------------------------------------------------
// Haversine distance (metres) between two lat/lon points
// ---------------------------------------------------------------------------

const R_EARTH = 6371000;

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------
// Route shape generator
//
// Strategy: parametric loop in lat/lon space. We walk around an oval path
// using a parameter t in [0, 1). Onto that base oval we add smooth
// perturbations (summed sinusoids) to give the route a realistic,
// non-trivial shape. Elevation follows a separate smooth profile with
// a few climbs.
// ---------------------------------------------------------------------------

const SEED = 0xdeadbeef; // fixed seed; never changes

// Base oval centred near Linkoping region (generic Swedish coordinates)
const BASE_LAT = 58.95;
const BASE_LON = 15.1;

// Oval semi-axes in degrees.
// At lat ~59: 1 deg lat ~ 111 km, 1 deg lon ~ 57 km.
// semi_lat=0.12 gives ~13 km N-S radius, semi_lon=0.18 gives ~10 km E-W radius.
// Oval circumference approx pi * sqrt(2*(13^2 + 10^2)) ~ 75 km before perturbations.
const SEMI_LAT = 0.12; // ~13 km N-S radius
const SEMI_LON = 0.18; // ~10 km E-W radius

// Number of track points to generate
const N_POINTS = 900;

function generateRoute() {
  const rng = makeLCG(SEED);

  // Pre-draw a set of sinusoidal perturbation parameters for lat and lon.
  // These are fixed (deterministic) because rng is seeded.
  const N_HARMONICS = 7;
  const latHarmonics = [];
  const lonHarmonics = [];
  for (let i = 0; i < N_HARMONICS; i++) {
    // Small amplitude perturbations: 0.003..0.012 degrees (~0.3..1.2 km)
    // Kept small so total distance stays in the 60-80 km target range.
    latHarmonics.push({
      amp: rng.range(0.003, 0.012),
      freq: 1 + Math.floor(rng.range(0, 5)),
      phase: rng.range(0, 2 * Math.PI),
    });
    lonHarmonics.push({
      amp: rng.range(0.003, 0.012),
      freq: 1 + Math.floor(rng.range(0, 5)),
      phase: rng.range(0, 2 * Math.PI),
    });
  }

  // Elevation profile: base elevation + a few smooth Gaussian bumps.
  // Each bump represents a climb.
  const BASE_ELE = 90; // metres at start
  const N_BUMPS = 5;
  const bumps = [];
  for (let i = 0; i < N_BUMPS; i++) {
    bumps.push({
      center: rng.range(0.05, 0.95), // position along route [0,1]
      height: rng.range(60, 180), // metres of gain at peak
      width: rng.range(0.04, 0.12), // fraction of route width
    });
  }

  const points = [];
  for (let i = 0; i < N_POINTS; i++) {
    const t = i / N_POINTS; // [0, 1)
    const theta = 2 * Math.PI * t;

    // Base oval
    let lat = BASE_LAT + SEMI_LAT * Math.sin(theta);
    let lon = BASE_LON + SEMI_LON * Math.cos(theta);

    // Add perturbations
    for (const h of latHarmonics) {
      lat += h.amp * Math.sin(h.freq * theta + h.phase) * 0.15;
    }
    for (const h of lonHarmonics) {
      lon += h.amp * Math.cos(h.freq * theta + h.phase) * 0.15;
    }

    // Elevation: base + sum of Gaussians
    let ele = BASE_ELE;
    for (const b of bumps) {
      const dt = t - b.center;
      ele += b.height * Math.exp(-(dt * dt) / (2 * b.width * b.width));
    }
    // Clamp to plausible range
    ele = Math.max(50, Math.min(400, ele));

    points.push({ lat, lon, ele });
  }

  // Close the loop by adding the first point again at the end
  points.push({ ...points[0] });

  return points;
}

// ---------------------------------------------------------------------------
// Compute summary statistics
// ---------------------------------------------------------------------------

function computeStats(points) {
  let totalDistM = 0;
  let totalAscentM = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    totalDistM += haversine(prev.lat, prev.lon, curr.lat, curr.lon);
    const dEle = curr.ele - prev.ele;
    if (dEle > 0) totalAscentM += dEle;
  }

  return {
    pointCount: points.length,
    distKm: totalDistM / 1000,
    ascentM: totalAscentM,
  };
}

// ---------------------------------------------------------------------------
// GPX 1.1 serializer
// ---------------------------------------------------------------------------

function toGpx(points) {
  const header = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gen-sample-route.mjs"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Synthetic Sample Route</name>
    <desc>Deterministically generated synthetic cycling loop. Not based on any real route. Copyright-safe.</desc>
  </metadata>
  <trk>
    <name>Synthetic Loop</name>
    <trkseg>
`;

  const trkpts = points
    .map((p) => {
      const lat = p.lat.toFixed(7);
      const lon = p.lon.toFixed(7);
      const ele = p.ele.toFixed(1);
      return `      <trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele></trkpt>`;
    })
    .join('\n');

  const footer = `
    </trkseg>
  </trk>
</gpx>
`;

  return header + trkpts + footer;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'sample-route.gpx');

const points = generateRoute();
const stats = computeStats(points);
const gpxContent = toGpx(points);

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, gpxContent, 'utf8');

console.log('Synthetic sample route written to:', OUTPUT_PATH);
console.log('  Points:        ', stats.pointCount);
console.log('  Distance:      ', stats.distKm.toFixed(1), 'km');
console.log('  Total ascent:  ', stats.ascentM.toFixed(0), 'm');
