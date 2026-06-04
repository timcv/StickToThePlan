import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cachePath, readCache, writeCache } from '../src/weather/cache.js';
import type { EnsembleField } from '../src/weather/ensemble.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_DATE = 'cache-test-9999-99-99'; // unique date, will not clash with real data

function makeField(): EnsembleField {
  return {
    cells: [
      {
        time_iso: '2026-06-13T06:00:00Z',
        lat: 58.0,
        lon: 15.0,
        windspeed_mean_ms: 5,
        winddir_from_deg: 270,
        windspeed_p10_ms: 2,
        windspeed_p90_ms: 8,
        temp_c: 12,
        pressure_pa: 101_000,
        n_sources: 3,
      },
    ],
    sources: ['src-A', 'src-B', 'src-C'],
    reduced: false,
  };
}

// Resolve the .cache directory relative to project root (two levels up from tests/)
const CACHE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '.cache');

afterEach(() => {
  // Clean up any files written by the test date
  const p = path.join(CACHE_DIR, `weather-${TEST_DATE}.json`);
  if (fs.existsSync(p)) {
    fs.rmSync(p);
  }
});

// ---------------------------------------------------------------------------
// cachePath
// ---------------------------------------------------------------------------

describe('cachePath', () => {
  it('returns path ending in weather-<date>.json', () => {
    const p = cachePath('2026-06-13');
    expect(p).toMatch(/weather-2026-06-13\.json$/);
    expect(p).toContain('.cache');
  });
});

// ---------------------------------------------------------------------------
// readCache: missing file
// ---------------------------------------------------------------------------

describe('readCache missing file', () => {
  it('returns null when file does not exist', () => {
    const result = readCache('nonexistent-date-xyz', 3, false);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// writeCache / readCache round-trip
// ---------------------------------------------------------------------------

describe('writeCache and readCache', () => {
  it('round-trips: write then read (fresh) returns the field', () => {
    const field = makeField();
    writeCache(TEST_DATE, field);

    const result = readCache(TEST_DATE, 3, false);
    expect(result).not.toBeNull();
    expect(result!.cells).toHaveLength(1);
    expect(result!.cells[0].windspeed_mean_ms).toBe(5);
    expect(result!.sources).toEqual(['src-A', 'src-B', 'src-C']);
  });
});

// ---------------------------------------------------------------------------
// Stale cache
// ---------------------------------------------------------------------------

describe('readCache staleness', () => {
  it('returns null when ttlH=0 and offline=false (stale)', () => {
    const field = makeField();
    writeCache(TEST_DATE, field);

    // ttlH=0 means any age is stale
    const result = readCache(TEST_DATE, 0, false);
    expect(result).toBeNull();
  });

  it('returns the field when ttlH=0 but offline=true (ignore staleness)', () => {
    const field = makeField();
    writeCache(TEST_DATE, field);

    const result = readCache(TEST_DATE, 0, true);
    expect(result).not.toBeNull();
    expect(result!.cells[0].windspeed_mean_ms).toBe(5);
  });
});
