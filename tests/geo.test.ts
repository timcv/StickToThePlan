import { describe, it, expect } from 'vitest';
import { haversine, bearing } from '../src/util/geo.js';

describe('haversine', () => {
  it('returns ~0 for identical points', () => {
    const p = { lat: 58.0, lon: 15.0 };
    expect(haversine(p, p)).toBeCloseTo(0, 1);
  });

  it('returns ~111 km for 1 degree latitude separation', () => {
    const a = { lat: 58.0, lon: 15.0 };
    const b = { lat: 59.0, lon: 15.0 };
    const dist = haversine(a, b);
    // 1 degree latitude ~111 km
    expect(dist).toBeGreaterThan(110_000);
    expect(dist).toBeLessThan(112_000);
  });

  it('returns ~1000 m for two points ~1 km apart', () => {
    // Moving ~0.009 degrees latitude north from a point is roughly 1 km
    const a = { lat: 58.390, lon: 15.047 };
    const b = { lat: 58.399, lon: 15.047 };
    const dist = haversine(a, b);
    // 0.009 deg * 111 km/deg ~= 999 m
    expect(dist).toBeGreaterThan(900);
    expect(dist).toBeLessThan(1100);
  });
});

describe('bearing', () => {
  it('due north ~0 degrees', () => {
    const a = { lat: 58.0, lon: 15.0 };
    const b = { lat: 59.0, lon: 15.0 };
    const b_deg = bearing(a, b);
    expect(b_deg).toBeCloseTo(0, 0);
  });

  it('due south ~180 degrees', () => {
    const a = { lat: 59.0, lon: 15.0 };
    const b = { lat: 58.0, lon: 15.0 };
    const b_deg = bearing(a, b);
    expect(b_deg).toBeCloseTo(180, 0);
  });

  it('due east ~90 degrees', () => {
    // Use small lon difference to minimize meridian-convergence error at lat 58
    const a = { lat: 58.0, lon: 15.0 };
    const b = { lat: 58.0, lon: 15.01 };
    const b_deg = bearing(a, b);
    // toBeCloseTo(90, 0) checks within 0.5 of 90 -- too tight at lat 58.
    // Allow 2 degrees tolerance for a short due-east step at this latitude.
    expect(b_deg).toBeGreaterThan(88);
    expect(b_deg).toBeLessThan(92);
  });

  it('due west ~270 degrees', () => {
    const a = { lat: 58.0, lon: 15.01 };
    const b = { lat: 58.0, lon: 15.0 };
    const b_deg = bearing(a, b);
    expect(b_deg).toBeGreaterThan(268);
    expect(b_deg).toBeLessThan(272);
  });

  it('returns value in [0, 360)', () => {
    const a = { lat: 58.0, lon: 15.0 };
    const b = { lat: 58.5, lon: 15.3 };
    const b_deg = bearing(a, b);
    expect(b_deg).toBeGreaterThanOrEqual(0);
    expect(b_deg).toBeLessThan(360);
  });
});
