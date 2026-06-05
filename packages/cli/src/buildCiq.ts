/**
 * Compile the static Next Control Pace data field to a sideloadable .prg.
 *
 * Generic field, no per-plan generation: this just ensures a developer key and
 * runs monkeyc against the static jungle for fenix7x. If the Connect IQ SDK is
 * not installed, or the fenix7x device database has not been downloaded, the
 * script reports it and exits 0 (nothing to fail in CI). Genuine compile errors
 * in the field source still exit 1.
 */
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

function projectRoot(): string {
  // packages/cli/src/buildCiq.ts -> ../../.. is the repo root.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

const ROOT = projectRoot();
const CIQ_DIR = join(ROOT, 'ciq');
const JUNGLE = join(CIQ_DIR, 'monkey.jungle');
const DEV_KEY = join(CIQ_DIR, 'developer_key.der');
const OUT_DIR = join(ROOT, 'output');
const OUT_PRG = join(OUT_DIR, 'NextControlPace.prg');
const DEVICE = 'fenix7x';

function ensureDeveloperKey(): void {
  if (existsSync(DEV_KEY)) {
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'ciq-key-'));
  const pem = join(tmp, 'k.pem');
  execFileSync('openssl', ['genrsa', '-out', pem, '4096'], { stdio: 'pipe' });
  execFileSync(
    'openssl',
    [
      'pkcs8',
      '-topk8',
      '-inform',
      'PEM',
      '-outform',
      'DER',
      '-in',
      pem,
      '-out',
      DEV_KEY,
      '-nocrypt',
    ],
    { stdio: 'pipe' },
  );
}

/** Combine an execFileSync error's stderr and stdout into one trimmed string. */
function combinedOutput(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string };
    return [e.stderr, e.stdout]
      .map((b) => (b ? b.toString() : ''))
      .filter((s) => s.length > 0)
      .join('\n')
      .trim();
  }
  return '';
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  try {
    ensureDeveloperKey();
  } catch (err) {
    console.error(`Could not create a developer key (need openssl): ${String(err)}`);
    process.exit(1);
  }
  try {
    execFileSync('monkeyc', ['-f', JUNGLE, '-d', DEVICE, '-o', OUT_PRG, '-y', DEV_KEY], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    console.log(`Compiled ${OUT_PRG}`);
  } catch (err) {
    const e = err as { code?: string };
    // monkeyc binary not installed at all: nothing to build, do not fail CI.
    if (e.code === 'ENOENT') {
      console.log('Connect IQ SDK (monkeyc) not found; skipping .prg build.');
      process.exit(0);
    }
    const out = combinedOutput(err);
    // SDK present but the target device database is not downloaded. That is an
    // incomplete-toolchain state, not a source error, so report it and skip
    // rather than fail the build.
    if (/invalid device id|device '.*' not|could not find.*device/i.test(out)) {
      console.log(
        `Connect IQ device '${DEVICE}' is not installed in the SDK; skipping .prg build. ` +
          `Open the Garmin SDK Manager and download the ${DEVICE} device to build locally.`,
      );
      process.exit(0);
    }
    // A genuine compile error in the field source: surface it and fail.
    console.error(out || 'monkeyc failed to compile the data field.');
    process.exit(1);
  }
}

main();
