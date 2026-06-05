import { describe, it, expect } from 'vitest';
import { applyDefaults } from '../src/config.js';

describe('wind-model config defaults', () => {
  const base = { gpx_path: 'r.gpx', race_date: '2026-06-13', start_time: '04:22' };

  it('applies the wind-model defaults', () => {
    const cfg = applyDefaults(base);
    expect(cfg.rider_wind_height_m).toBe(1.2);
    expect(cfg.forecast_wind_height_m).toBe(10);
    expect(cfg.exposure_terrain).toBe('mixed');
    expect(cfg.apply_wind_height_correction).toBe(true);
    expect(cfg.wind_roughness_z0).toBeUndefined();
  });

  it('lets raw config override the wind-model fields', () => {
    const cfg = applyDefaults({ ...base, rider_wind_height_m: 10, exposure_terrain: 'open' });
    expect(cfg.rider_wind_height_m).toBe(10);
    expect(cfg.exposure_terrain).toBe('open');
  });
});
