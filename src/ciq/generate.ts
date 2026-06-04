/**
 * Connect IQ plan-delta data field generation (spec section 12.5).
 *
 * The planner re-generates a Monkey C data field on every run, embedding a
 * distance/elapsed lookup table for the current plan, then best-effort compiles
 * it to a sideloadable .prg with the Connect IQ SDK (monkeyc).
 *
 * Per spec 12.5 the compile is BEST-EFFORT: if the SDK is absent or the compile
 * fails, we log nothing here (the caller logs), still write the generated .mc
 * source for inspection, and never fail the run. The hard, tested gate is source
 * generation plus a monotonic lookup table (compilePlanDelta is not exercised in
 * the unit tests).
 *
 * Exports:
 *   buildLookupTable        - pure: display-segment boundaries -> lookup entries
 *   generatePlanDeltaSource - fill the .mc template placeholders
 *   writePlanDeltaSource    - write the .mc source (outDir + ciq source dir)
 *   compilePlanDelta        - ensure dev key, run monkeyc, never throw
 *   generateCiq             - generate + write + (optional) compile
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { DisplaySegment, PlanResult, Config } from '../types.js';
import { clockToSeconds } from '../util/time.js';

// ---------------------------------------------------------------------------
// Path resolution (works under tsx and compiled dist, ESM)
// ---------------------------------------------------------------------------

function thisDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function projectRoot(): string {
  // src/ciq/generate.ts -> ../.. is the repo root.
  return resolve(thisDir(), '..', '..');
}

const TEMPLATE_PATH = join(thisDir(), 'PlanDelta.mc.tmpl');
const CIQ_DIR = join(projectRoot(), 'ciq');
const CIQ_SOURCE_DIR = join(CIQ_DIR, 'source');
const CIQ_SOURCE_FILE = join(CIQ_SOURCE_DIR, 'PlanDelta.mc');
const CIQ_JUNGLE = join(CIQ_DIR, 'monkey.jungle');
const CIQ_DEV_KEY = join(CIQ_DIR, 'developer_key.der');
const FENIX_DEVICE = 'fenix7x';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LookupEntry {
  distance_m: number;
  elapsed_s: number;
}

// ---------------------------------------------------------------------------
// Lookup table
// ---------------------------------------------------------------------------

/**
 * Build the distance/elapsed lookup table from the display-segment boundaries.
 *
 * Each display segment contributes one boundary: the cumulative distance at its
 * end (to_km * 1000 metres) paired with the planned elapsed seconds at that
 * point (eta_s, which includes stop time, the correct basis for a vs-plan
 * comparison). The table starts at the {0, 0} origin and is made monotonic
 * non-decreasing in distance by dropping out-of-order points and deduping equal
 * distances (keeping the larger elapsed). The result includes the final
 * boundary.
 */
export function buildLookupTable(displaySegments: DisplaySegment[], _plan: PlanResult): LookupEntry[] {
  const raw: LookupEntry[] = [{ distance_m: 0, elapsed_s: 0 }];
  for (const seg of displaySegments) {
    raw.push({ distance_m: Math.round(seg.to_km * 1000), elapsed_s: Math.round(seg.eta_s) });
  }

  // Sort by distance, then by elapsed, so equal distances are adjacent with the
  // larger elapsed last (it wins on dedupe).
  raw.sort((a, b) => (a.distance_m - b.distance_m) || (a.elapsed_s - b.elapsed_s));

  const out: LookupEntry[] = [];
  for (const e of raw) {
    const prev = out[out.length - 1];
    if (prev === undefined) {
      out.push(e);
      continue;
    }
    if (e.distance_m === prev.distance_m) {
      // Same distance: keep the larger elapsed (raw is sorted so e wins).
      if (e.elapsed_s > prev.elapsed_s) {
        prev.elapsed_s = e.elapsed_s;
      }
      continue;
    }
    // Distance increases. Keep elapsed non-decreasing too.
    if (e.elapsed_s < prev.elapsed_s) {
      out.push({ distance_m: e.distance_m, elapsed_s: prev.elapsed_s });
    } else {
      out.push(e);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Source generation
// ---------------------------------------------------------------------------

/**
 * Render the lookup table as a Monkey C array literal of [distance, elapsed]
 * pairs, e.g. [[0,0],[76900,9300],[134000,17880]].
 */
function lookupLiteral(table: LookupEntry[]): string {
  const pairs = table.map((e) => `[${e.distance_m},${e.elapsed_s}]`);
  return `[${pairs.join(',')}]`;
}

/**
 * Generate the PlanDelta.mc source by filling the template placeholders with
 * the lookup table, total planned time, and start clock for this plan.
 */
export function generatePlanDeltaSource(
  displaySegments: DisplaySegment[],
  plan: PlanResult,
  cfg: Config,
): string {
  const template = readFileSync(TEMPLATE_PATH, 'utf-8');
  const table = buildLookupTable(displaySegments, plan);

  const source = template
    .replace('/*__LOOKUP__*/', lookupLiteral(table))
    .replace('/*__PLAN_TOTAL_S__*/', String(Math.round(plan.total_time_s)))
    .replace('/*__START_CLOCK_S__*/', String(clockToSeconds(cfg.start_time)));

  return source;
}

// ---------------------------------------------------------------------------
// Source writing
// ---------------------------------------------------------------------------

/**
 * Write the generated source to <outDir>/PlanDelta.mc (for inspection) and to
 * the ciq source directory (ciq/source/PlanDelta.mc, where the jungle points)
 * so a subsequent compile picks it up. Returns the outDir copy path.
 */
export function writePlanDeltaSource(source: string, outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  const inspectPath = join(outDir, 'PlanDelta.mc');
  writeFileSync(inspectPath, source, 'utf-8');

  mkdirSync(CIQ_SOURCE_DIR, { recursive: true });
  writeFileSync(CIQ_SOURCE_FILE, source, 'utf-8');

  return inspectPath;
}

// ---------------------------------------------------------------------------
// Compile (best-effort)
// ---------------------------------------------------------------------------

/**
 * Ensure a developer key exists at ciq/developer_key.der, generating one with
 * openssl if missing. Throws on failure (caller catches).
 */
function ensureDeveloperKey(): void {
  if (existsSync(CIQ_DEV_KEY)) {
    return;
  }
  mkdirSync(CIQ_DIR, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'ciq-key-'));
  const pem = join(tmp, 'k.pem');
  // 4096-bit RSA key, then convert to unencrypted PKCS8 DER for monkeyc.
  execFileSync('openssl', ['genrsa', '-out', pem, '4096'], { stdio: 'pipe' });
  execFileSync(
    'openssl',
    ['pkcs8', '-topk8', '-inform', 'PEM', '-outform', 'DER', '-in', pem, '-out', CIQ_DEV_KEY, '-nocrypt'],
    { stdio: 'pipe' },
  );
}

/**
 * Best-effort compile of the generated data field to prgOutPath via monkeyc.
 *
 * Ensures a developer key, then runs monkeyc against the jungle for the fenix7x
 * device with the repo root as cwd. On success returns {compiled:true, ...}; on
 * ANY error (monkeyc missing, openssl missing, compile error) catches it and
 * returns {compiled:false, message}. Never throws.
 */
export function compilePlanDelta(prgOutPath: string): { compiled: boolean; message: string } {
  try {
    ensureDeveloperKey();
  } catch (err) {
    return { compiled: false, message: `developer key generation failed: ${errText(err)}` };
  }

  try {
    execFileSync(
      'monkeyc',
      ['-f', CIQ_JUNGLE, '-d', FENIX_DEVICE, '-o', prgOutPath, '-y', CIQ_DEV_KEY],
      { cwd: projectRoot(), stdio: 'pipe' },
    );
    return { compiled: true, message: `compiled ${prgOutPath}` };
  } catch (err) {
    return { compiled: false, message: errText(err) };
  }
}

/**
 * Extract a useful message from an execFileSync error: prefer stderr/stdout,
 * fall back to the error message.
 */
function errText(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    const stdout = e.stdout ? e.stdout.toString().trim() : '';
    const combined = [stderr, stdout].filter((s) => s.length > 0).join('\n');
    if (combined.length > 0) {
      return combined;
    }
    if (e.message) {
      return e.message;
    }
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Generate the data field source, write it, and (unless opts.compile is false)
 * attempt a best-effort compile to <outDir>/PlanDelta.prg.
 */
export function generateCiq(
  displaySegments: DisplaySegment[],
  plan: PlanResult,
  cfg: Config,
  outDir: string,
  opts: { compile?: boolean } = {},
): { sourcePath: string; compiled: boolean; message: string } {
  const source = generatePlanDeltaSource(displaySegments, plan, cfg);
  const sourcePath = writePlanDeltaSource(source, outDir);

  if (opts.compile === false) {
    return { sourcePath, compiled: false, message: 'compile skipped' };
  }

  const result = compilePlanDelta(join(outDir, 'PlanDelta.prg'));
  return { sourcePath, compiled: result.compiled, message: result.message };
}
