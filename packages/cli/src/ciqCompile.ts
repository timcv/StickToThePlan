/**
 * Connect IQ data-field writing and best-effort compilation (Node IO).
 *
 * The pure source generation (generatePlanDeltaSource / buildLookupTable) lives
 * in @stp/core. This module writes the generated .mc source to disk and runs the
 * Connect IQ SDK (monkeyc) to produce a sideloadable .prg.
 *
 * Per spec 12.5 the compile is BEST-EFFORT: if the SDK is absent or the compile
 * fails, we still write the generated .mc source for inspection and never fail
 * the run.
 *
 * Exports:
 *   writePlanDeltaSource    - write the .mc source (outDir + ciq source dir)
 *   compilePlanDelta        - ensure dev key, run monkeyc, never throw
 *   generateCiq             - generate + write + (optional) compile
 */

import { existsSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { generatePlanDeltaSource, type DisplaySegment, type PlanResult, type Config } from '@stp/core';

// ---------------------------------------------------------------------------
// Path resolution (works under tsx and compiled dist, ESM)
// ---------------------------------------------------------------------------

function thisDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function projectRoot(): string {
  // packages/cli/src/ciqCompile.ts -> ../../.. is the repo root.
  return resolve(thisDir(), '..', '..', '..');
}

const CIQ_DIR = join(projectRoot(), 'ciq');
const CIQ_SOURCE_DIR = join(CIQ_DIR, 'source');
const CIQ_SOURCE_FILE = join(CIQ_SOURCE_DIR, 'PlanDelta.mc');
const CIQ_JUNGLE = join(CIQ_DIR, 'monkey.jungle');
const CIQ_DEV_KEY = join(CIQ_DIR, 'developer_key.der');
const FENIX_DEVICE = 'fenix7x';

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
