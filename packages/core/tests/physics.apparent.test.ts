import { describe, it, expect } from 'vitest';
import { pedalPower, yawCdaFactor } from '../src/physics.js';
import type { PhysicsParams } from '../src/types.js';

const p: PhysicsParams = { m: 80, g: 9.81, crr: 0.0045, eta: 0.97, cda: 0.3, rho: 1.2 };

describe('apparent-wind aero', () => {
  it('crosswind=0 reduces to the legacy axial formula', () => {
    const v = 8,
      hw = 3;
    const u = v + hw;
    const fRoll = p.m * p.g * p.crr;
    const fAero = 0.5 * p.rho * p.cda * u * Math.abs(u);
    const legacy = ((fRoll + fAero) * v) / p.eta;
    expect(pedalPower(v, 0, hw, p, 0)).toBeCloseTo(legacy, 6);
  });

  it('pure crosswind increases required power vs calm', () => {
    const calm = pedalPower(8, 0, 0, p, 0);
    const cross = pedalPower(8, 0, 0, p, 5);
    expect(cross).toBeGreaterThan(calm);
  });

  it('strong tailwind with crosswind is finite and not NaN', () => {
    const power = pedalPower(10, 0, -14, p, 3);
    expect(Number.isFinite(power)).toBe(true);
  });

  it('is strictly increasing in v even with crosswind', () => {
    const a = pedalPower(6, 0, 2, p, 4);
    const b = pedalPower(9, 0, 2, p, 4);
    expect(b).toBeGreaterThan(a);
  });
});

describe('yawCdaFactor clamp', () => {
  it('clamps the yaw angle to 50 degrees', () => {
    const f = yawCdaFactor(3, -4, 0.04); // atan2(3,-4) ~ 143 deg
    expect(f).toBeLessThanOrEqual(1 + (0.04 * 50) / 10 + 1e-9);
  });

  it('is unchanged for small yaw', () => {
    expect(yawCdaFactor(1, 10, 0.04)).toBeCloseTo(
      1 + (0.04 * ((Math.atan2(1, 10) * 180) / Math.PI)) / 10,
      9,
    );
  });
});
