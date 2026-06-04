/**
 * Weather ensemble cache.
 *
 * Stores the EnsembleField for a given race date in
 * .cache/weather-<raceDate>.json relative to the project root.
 *
 * Cache freshness rules (spec 10.4):
 *   - offline === true  : return cached data regardless of age
 *   - fresh (age < ttlH): return cached data
 *   - stale             : return null (caller re-fetches)
 *   - file absent       : return null
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EnsembleField } from './ensemble.js';

// ---------------------------------------------------------------------------
// Project root resolution (works whether called as CJS or ESM)
// ---------------------------------------------------------------------------

function projectRoot(): string {
  // __filename is not available in ESM; derive it from import.meta.url
  const thisFile = fileURLToPath(import.meta.url);
  // src/weather/cache.ts -> ../../..
  return path.resolve(path.dirname(thisFile), '..', '..');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the absolute path to the cache file for the given race date.
 * Creates nothing; purely a path computation.
 */
export function cachePath(raceDate: string): string {
  return path.join(projectRoot(), '.cache', `weather-${raceDate}.json`);
}

/**
 * Write the EnsembleField to the cache file.
 * Creates .cache/ if it does not exist.
 */
export function writeCache(raceDate: string, field: EnsembleField): void {
  const p = cachePath(raceDate);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(field, null, 2), 'utf-8');
}

/**
 * Read a cached EnsembleField.
 *
 * Returns the parsed field when:
 *   - The file exists AND
 *   - offline === true  (ignore freshness), OR
 *   - (now - mtime) < ttlH * 3600 * 1000 (fresh)
 *
 * Returns null when the file is absent or stale (and offline === false).
 */
export function readCache(
  raceDate: string,
  ttlH: number,
  offline: boolean,
): EnsembleField | null {
  const p = cachePath(raceDate);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    return null; // file absent
  }

  // stat.mtimeMs has sub-millisecond precision on macOS (e.g. 358.217).
  // Floor it so a file written moments ago has age >= 0 and ttlH=0 reliably means stale.
  const ageMs = Date.now() - Math.floor(stat.mtimeMs);
  const fresh = ageMs < ttlH * 3600 * 1000;

  if (!offline && !fresh) {
    return null; // stale and not offline
  }

  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw) as EnsembleField;
}
