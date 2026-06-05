import { describe, it, expect } from 'vitest';
import {
  heightFactor,
  adjustWindForHeight,
  terrainToZ0,
  exposureClassToZ0,
} from '../src/weather/effective.js';

describe('heightFactor', () => {
  it('reduces wind from 10m to 1.2m over typical roughness', () => {
    const k = heightFactor(0.05, 1.2, 10);
    expect(k).toBeGreaterThan(0.5);
    expect(k).toBeLessThan(0.7);
  });

  it('is 1 when rider height equals forecast height (escape hatch)', () => {
    expect(heightFactor(0.05, 10, 10)).toBeCloseTo(1, 10);
  });

  it('gives more wind (higher factor) over smoother ground', () => {
    expect(heightFactor(0.01, 1.2, 10)).toBeGreaterThan(heightFactor(0.5, 1.2, 10));
  });

  it('is floored at 0.15 and capped at 1', () => {
    expect(heightFactor(2.0, 1.2, 10)).toBe(0.15);
    expect(heightFactor(0.05, 1.2, 10)).toBeLessThanOrEqual(1);
  });

  it('throws on non-positive inputs', () => {
    expect(() => heightFactor(0, 1.2, 10)).toThrow();
    expect(() => heightFactor(0.05, 0, 10)).toThrow();
    expect(() => heightFactor(0.05, 1.2, 0)).toThrow();
  });

  it('caps at 1 when rider height exceeds forecast height', () => {
    expect(heightFactor(0.05, 10, 1.2)).toBe(1);
  });
});

describe('adjustWindForHeight', () => {
  it('scales wind and never goes negative', () => {
    expect(adjustWindForHeight(6, 0.05, 1.2, 10)).toBeCloseTo(6 * heightFactor(0.05, 1.2, 10), 10);
    expect(adjustWindForHeight(0, 0.05, 1.2, 10)).toBe(0);
  });

  it('clamps negative input wind to zero', () => {
    expect(adjustWindForHeight(-3, 0.05, 1.2, 10)).toBe(0);
  });
});

describe('roughness lookups', () => {
  it('orders terrain openness', () => {
    expect(terrainToZ0('open')).toBeLessThan(terrainToZ0('mixed'));
    expect(terrainToZ0('mixed')).toBeLessThan(terrainToZ0('sheltered'));
  });

  it('makes water/bridge windier than forest/sheltered at rider level', () => {
    const f = (z: number) => heightFactor(z, 1.2, 10);
    expect(f(exposureClassToZ0('water'))).toBeGreaterThan(f(exposureClassToZ0('forest')));
    expect(f(exposureClassToZ0('bridge'))).toBeGreaterThan(f(exposureClassToZ0('sheltered')));
  });
});
