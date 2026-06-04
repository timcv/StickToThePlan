import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyDefaults, loadConfig } from '../src/config.js';

describe('applyDefaults (unit, no disk IO)', () => {
  it('loading the committed config.json fields and defaults', () => {
    const raw = {
      race_date: '2026-06-13',
      start_time: '04:22',
      gpx_path: 'data/vatternrundan-315km.gpx',
      fit_path: 'data/23066238193_ACTIVITY.fit',
      ftp: 272,
      n_riders: 12,
      target_total_hm: '11:45',
      stops: [
        { control: 'Gränna',    km: 77,  minutes: 10 },
        { control: 'Fagerhult', km: 134, minutes: 10 },
        { control: 'Boviken',   km: 226, minutes: 15 },
        { control: 'Askersund', km: 256, minutes: 15 },
      ],
    };
    const cfg = applyDefaults(raw);
    expect(cfg.ftp).toBe(272);
    expect(cfg.cda_pull).toBe(0.32);
    expect(cfg.pull_cap_soft).toBe(250);
    expect(cfg.pull_cap_hard).toBe(272);
    expect(cfg.solo).toBe(false);
    expect(cfg.watch_target).toBe('pull');
    expect(cfg.m).toBe(96);
    expect(cfg.k_yaw).toBe(0.04);
    expect(cfg.climb_threshold).toBe(0.03);
  });

  it('n_riders:1 and no fit_path yields solo=true and watch_target="avg"', () => {
    const raw = {
      race_date: '2026-06-10',
      start_time: '09:00',
      gpx_path: 'data/test-ride.gpx',
      ftp: 272,
      n_riders: 1,
      target_total_hm: '3:30',
      stops: [] as Array<{ control: string; km: number; minutes: number }>,
    };
    const cfg = applyDefaults(raw);
    expect(cfg.solo).toBe(true);
    expect(cfg.watch_target).toBe('avg');
    expect(cfg.fit_path).toBeUndefined();
  });

  it('provided watch_target overrides default even in solo mode', () => {
    const raw = {
      race_date: '2026-06-10',
      start_time: '09:00',
      gpx_path: 'data/test-ride.gpx',
      ftp: 272,
      n_riders: 1,
      target_total_hm: '3:30',
      stops: [] as Array<{ control: string; km: number; minutes: number }>,
      watch_target: 'pull' as const,
    };
    const cfg = applyDefaults(raw);
    expect(cfg.watch_target).toBe('pull');
  });

  it('throws with a clear error when gpx_path is missing', () => {
    const raw = {
      race_date: '2026-06-13',
      start_time: '04:22',
      ftp: 272,
      n_riders: 12,
      target_total_hm: '11:45',
      stops: [] as Array<{ control: string; km: number; minutes: number }>,
    };
    expect(() => applyDefaults(raw as never)).toThrow(/gpx_path/);
  });

  it('throws with a clear error when race_date is missing', () => {
    const raw = {
      start_time: '04:22',
      gpx_path: 'data/vatternrundan-315km.gpx',
      ftp: 272,
      n_riders: 12,
      target_total_hm: '11:45',
      stops: [] as Array<{ control: string; km: number; minutes: number }>,
    };
    expect(() => applyDefaults(raw as never)).toThrow(/race_date/);
  });

  it('throws with a clear error when start_time is missing', () => {
    const raw = {
      race_date: '2026-06-13',
      gpx_path: 'data/vatternrundan-315km.gpx',
      ftp: 272,
      n_riders: 12,
      target_total_hm: '11:45',
      stops: [] as Array<{ control: string; km: number; minutes: number }>,
    };
    expect(() => applyDefaults(raw as never)).toThrow(/start_time/);
  });

  it('pull_cap_soft is 0.92*ftp rounded', () => {
    const raw = {
      race_date: '2026-06-13',
      start_time: '04:22',
      gpx_path: 'data/x.gpx',
      ftp: 300,
      n_riders: 2,
      target_total_hm: '5:00',
      stops: [] as Array<{ control: string; km: number; minutes: number }>,
    };
    const cfg = applyDefaults(raw);
    expect(cfg.pull_cap_soft).toBe(Math.round(0.92 * 300));
  });

  it('provided pull_cap_hard overrides ftp default', () => {
    const raw = {
      race_date: '2026-06-13',
      start_time: '04:22',
      gpx_path: 'data/x.gpx',
      ftp: 272,
      n_riders: 2,
      target_total_hm: '5:00',
      stops: [] as Array<{ control: string; km: number; minutes: number }>,
      pull_cap_hard: 260,
    };
    const cfg = applyDefaults(raw);
    expect(cfg.pull_cap_hard).toBe(260);
  });

  it('np_target is undefined (resolved later)', () => {
    const raw = {
      race_date: '2026-06-13',
      start_time: '04:22',
      gpx_path: 'data/x.gpx',
      ftp: 272,
      n_riders: 2,
      target_total_hm: '5:00',
      stops: [] as Array<{ control: string; km: number; minutes: number }>,
    };
    const cfg = applyDefaults(raw);
    expect(cfg.np_target).toBeUndefined();
  });
});

describe('loadConfig (disk IO)', () => {
  it('loads the committed config.json from project root', () => {
    // Resolve relative to this test file's directory up two levels to project root
    const projectRoot = path.resolve(new URL(import.meta.url).pathname, '../../');
    const cfg = loadConfig(path.join(projectRoot, 'config.json'));
    expect(cfg.ftp).toBe(272);
    expect(cfg.cda_pull).toBe(0.32);
    expect(cfg.pull_cap_soft).toBe(250);
    expect(cfg.pull_cap_hard).toBe(272);
    expect(cfg.solo).toBe(false);
    expect(cfg.watch_target).toBe('pull');
    expect(cfg.m).toBe(96);
    expect(cfg.k_yaw).toBe(0.04);
    expect(cfg.climb_threshold).toBe(0.03);
  });

  it('loading a solo config written to a temp file yields solo=true', () => {
    const tmp = path.join(os.tmpdir(), `vattern-test-${Date.now()}.json`);
    const solo = {
      race_date: '2026-06-10',
      start_time: '09:00',
      gpx_path: 'data/test-ride.gpx',
      ftp: 272,
      n_riders: 1,
      target_total_hm: '3:30',
      stops: [],
    };
    fs.writeFileSync(tmp, JSON.stringify(solo));
    try {
      const cfg = loadConfig(tmp);
      expect(cfg.solo).toBe(true);
      expect(cfg.watch_target).toBe('avg');
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
