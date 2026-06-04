import { describe, it, expect } from 'vitest';
import {
  fFront,
  pullPower,
  draftPower,
  meanPower,
  riderNpAtSpeed,
  solveSpeedForRiderNp,
} from '../src/chaingang.js';
import { applyDefaults } from '../src/config.js';

// Build group config: 12 riders, not solo
const groupCfg = applyDefaults({
  race_date: 'x',
  start_time: '04:22',
  gpx_path: 'x',
  ftp: 272,
  n_riders: 12,
  target_total_hm: '11:45',
  stops: [],
});

// Build solo config: 1 rider, solo
const soloCfg = applyDefaults({
  race_date: 'x',
  start_time: '04:22',
  gpx_path: 'x',
  ftp: 272,
  n_riders: 1,
  target_total_hm: '11:45',
  stops: [],
});

// Common conditions: flat, calm, rho 1.2
const V = 8; // 8 m/s = 28.8 km/h
const GRADE = 0;
const HW = 0;
const CW = 0;
const RHO = 1.2;

describe('fFront', () => {
  it('returns 1/n for group of 12 riders', () => {
    expect(fFront(12, 45)).toBeCloseTo(1 / 12, 10);
  });

  it('returns 1.0 for solo (n_riders = 1)', () => {
    expect(fFront(1, 45)).toBe(1.0);
  });
});

describe('pullPower and draftPower', () => {
  it('pullPower > draftPower at flat calm 8 m/s (higher CdA on front)', () => {
    const pull = pullPower(V, GRADE, HW, CW, RHO, groupCfg);
    const draft = draftPower(V, GRADE, HW, CW, RHO, groupCfg);
    expect(pull).toBeGreaterThan(draft);
  });

  it('draftPower at flat calm 8 m/s is within 25% of 90 W (spec sanity)', () => {
    const draft = draftPower(V, GRADE, HW, CW, RHO, groupCfg);
    // Spec 5 sanity: "in draft on the flat about 90 W at 28.8 km/h"
    expect(draft).toBeGreaterThan(90 * 0.75);
    expect(draft).toBeLessThan(90 * 1.25);
  });
});

describe('meanPower', () => {
  it('meanPower is between draftPower and pullPower', () => {
    const pull = pullPower(V, GRADE, HW, CW, RHO, groupCfg);
    const draft = draftPower(V, GRADE, HW, CW, RHO, groupCfg);
    const ff = fFront(groupCfg.n_riders, groupCfg.pull_seconds);
    const mean = meanPower(pull, draft, ff);
    expect(mean).toBeGreaterThan(draft);
    expect(mean).toBeLessThan(pull);
  });

  it('meanPower with fFront=1 equals pullPower', () => {
    const pull = pullPower(V, GRADE, HW, CW, RHO, groupCfg);
    const draft = draftPower(V, GRADE, HW, CW, RHO, groupCfg);
    expect(meanPower(pull, draft, 1.0)).toBeCloseTo(pull, 5);
  });
});

describe('riderNpAtSpeed', () => {
  it('group: riderNpAtSpeed > meanPower (variability penalty from square wave)', () => {
    const pull = pullPower(V, GRADE, HW, CW, RHO, groupCfg);
    const draft = draftPower(V, GRADE, HW, CW, RHO, groupCfg);
    const ff = fFront(groupCfg.n_riders, groupCfg.pull_seconds);
    const mean = meanPower(pull, draft, ff);
    const np = riderNpAtSpeed(V, GRADE, HW, CW, RHO, groupCfg);
    expect(np).toBeGreaterThan(mean);
  });

  it('solo: riderNpAtSpeed equals pullPower exactly (no rotation, always on front)', () => {
    const pull = pullPower(V, GRADE, HW, CW, RHO, soloCfg);
    const np = riderNpAtSpeed(V, GRADE, HW, CW, RHO, soloCfg);
    expect(np).toBeCloseTo(pull, 5);
  });
});

describe('solveSpeedForRiderNp', () => {
  it('solving for 163 W NP then feeding result back gives NP within 0.5 W', () => {
    const npTarget = 163;
    const v = solveSpeedForRiderNp(npTarget, GRADE, HW, CW, RHO, groupCfg);
    const npCheck = riderNpAtSpeed(v, GRADE, HW, CW, RHO, groupCfg);
    expect(Math.abs(npCheck - npTarget)).toBeLessThan(0.5);
  });

  it('returns a positive speed in a reasonable range', () => {
    const v = solveSpeedForRiderNp(163, GRADE, HW, CW, RHO, groupCfg);
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(25);
  });
});
