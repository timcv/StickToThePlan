import { describe, it, expect } from 'vitest';
import {
  pedalPower,
  solveSpeedForPower,
  decomposeWind,
  airDensity,
  normalizedPower,
  yawCdaFactor,
} from '../src/physics.js';
import type { PhysicsParams } from '../src/types.js';

// Standard params from spec section 5 sanity table
const p: PhysicsParams = { m: 96, g: 9.81, crr: 0.0045, eta: 0.97, cda: 0.32, rho: 1.2 };

describe('pedalPower', () => {
  it('flat calm at 8.0 m/s (28.8 km/h) is within 8% of 135 W', () => {
    const pw = pedalPower(8.0, 0, 0, p);
    expect(pw).toBeGreaterThan(135 * 0.92);
    expect(pw).toBeLessThan(135 * 1.08);
  });

  it('flat with 20 km/h (5.56 m/s) headwind at 8.0 m/s is within 10% of 325 W', () => {
    const headwind = 20 / 3.6; // 5.556 m/s
    const pw = pedalPower(8.0, 0, headwind, p);
    expect(pw).toBeGreaterThan(325 * 0.90);
    expect(pw).toBeLessThan(325 * 1.10);
  });

  it('returns positive power going uphill', () => {
    expect(pedalPower(5, 0.05, 0, p)).toBeGreaterThan(0);
  });

  it('returns lower power with tailwind vs calm', () => {
    const calmPower = pedalPower(8, 0, 0, p);
    const tailwindPower = pedalPower(8, 0, -3, p);
    expect(tailwindPower).toBeLessThan(calmPower);
  });
});

describe('solveSpeedForPower', () => {
  it('5% grade target 270 W gives speed within 8% of 4.7 m/s (~17 km/h)', () => {
    const v = solveSpeedForPower(270, 0.05, 0, p);
    expect(v).toBeGreaterThan(4.7 * 0.92);
    expect(v).toBeLessThan(4.7 * 1.08);
  });

  it('flat calm 135 W inverts to ~8.0 m/s', () => {
    const v = solveSpeedForPower(135, 0, 0, p);
    expect(v).toBeGreaterThan(7.5);
    expect(v).toBeLessThan(8.5);
  });

  it('roundtrip: solveSpeedForPower(pedalPower(v)) ~= v', () => {
    const v0 = 8.0;
    const pw = pedalPower(v0, 0.02, 2, p);
    const v1 = solveSpeedForPower(pw, 0.02, 2, p);
    expect(v1).toBeCloseTo(v0, 1);
  });
});

describe('decomposeWind', () => {
  // Spec 6.2 check: wind from west (270), travel west (270) = pure headwind
  it('wind from 270, travel 270 -> headwind ~10, crosswind ~0', () => {
    const { headwind, crosswind } = decomposeWind(10, 270, 270);
    expect(headwind).toBeCloseTo(10, 1);
    expect(Math.abs(crosswind)).toBeLessThan(0.01);
  });

  // Wind from west (270), travel north (0): cos(270-0)=cos(270deg)=0, sin(270deg)=-1 -> crosswind -10
  it('wind from 270, travel 0 (north) -> headwind ~0, crosswind nonzero', () => {
    const { headwind, crosswind } = decomposeWind(10, 270, 0);
    expect(Math.abs(headwind)).toBeLessThan(0.01);
    // sin(radians(270-0)) = sin(270deg) = -1, so crosswind = 10*(-1) = -10
    expect(crosswind).toBeCloseTo(-10, 1);
  });

  // Wind from north (0), travel north (0) = pure headwind
  it('wind from 0, travel 0 (north) -> pure headwind 10', () => {
    const { headwind, crosswind } = decomposeWind(10, 0, 0);
    expect(headwind).toBeCloseTo(10, 1);
    expect(Math.abs(crosswind)).toBeLessThan(0.01);
  });

  // Wind from east (90), travel north (0): delta=90-0=90deg, headwind=W*cos(90)=0, crosswind=W*sin(90)=10
  it('wind from 90 (east), travel 0 (north) -> headwind ~0, crosswind ~10', () => {
    const { headwind, crosswind } = decomposeWind(10, 90, 0);
    expect(Math.abs(headwind)).toBeLessThan(0.01);
    expect(crosswind).toBeCloseTo(10, 1);
  });

  // Pure tailwind: wind from south (180), travel north (0)
  // delta = 180-0 = 180deg, headwind = W*cos(180) = -10 (tailwind)
  it('wind from 180 (south), travel 0 (north) -> headwind -10 (tailwind)', () => {
    const { headwind, crosswind } = decomposeWind(10, 180, 0);
    expect(headwind).toBeCloseTo(-10, 1);
    expect(Math.abs(crosswind)).toBeLessThan(0.01);
  });
});

describe('airDensity', () => {
  it('15 C, 101325 Pa -> within 2% of 1.225 kg/m^3 (ISA standard)', () => {
    const rho = airDensity(15, 101325);
    expect(rho).toBeGreaterThan(1.225 * 0.98);
    expect(rho).toBeLessThan(1.225 * 1.02);
  });

  it('returns lower density at higher temperature', () => {
    const rho20 = airDensity(20, 101325);
    const rho30 = airDensity(30, 101325);
    expect(rho30).toBeLessThan(rho20);
  });

  it('returns lower density at lower pressure', () => {
    const rhoSea = airDensity(15, 101325);
    const rhoAlt = airDensity(15, 95000);
    expect(rhoAlt).toBeLessThan(rhoSea);
  });
});

describe('yawCdaFactor', () => {
  it('zero crosswind returns 1.0', () => {
    expect(yawCdaFactor(0, 8, 0.04)).toBeCloseTo(1.0, 5);
  });

  it('raises factor with positive crosswind', () => {
    expect(yawCdaFactor(5, 8, 0.04)).toBeGreaterThan(1.0);
  });

  it('symmetric for positive and negative crosswind', () => {
    const pos = yawCdaFactor(5, 8, 0.04);
    const neg = yawCdaFactor(-5, 8, 0.04);
    expect(pos).toBeCloseTo(neg, 5);
  });
});

describe('normalizedPower', () => {
  it('constant power array returns same value (within 1 W)', () => {
    const samples = Array(120).fill(200);
    expect(normalizedPower(samples)).toBeCloseTo(200, 0);
  });

  it('short array (less than 30 s window) still returns a value', () => {
    const samples = Array(10).fill(150);
    expect(normalizedPower(samples)).toBeCloseTo(150, 0);
  });

  it('higher variability in power raises NP above mean', () => {
    // Use 60-second blocks so the 30-second rolling window sees pure 100 or pure 300,
    // not averaged mixtures. Mean = 200, NP should be significantly above 200.
    const samples: number[] = [];
    for (let i = 0; i < 120; i++) {
      samples.push(i < 60 ? 100 : 300);
    }
    const np = normalizedPower(samples);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(np).toBeGreaterThan(mean);
  });

  it('custom hz parameter works (60 Hz, 0.5 s window = same semantics)', () => {
    const samples = Array(120).fill(250);
    expect(normalizedPower(samples, 1)).toBeCloseTo(250, 0);
  });
});
