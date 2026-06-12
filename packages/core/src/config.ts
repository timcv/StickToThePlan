import type { Config, Stop } from './types.js';
import { STANDARD_RHO } from './physics.js';
import { STYRKORT_DEFAULT_MAX_ROWS } from './segmentation.js';

/**
 * Default values for all numeric/boolean parameters (spec section 5.4).
 * Mandatory fields (gpx_path, race_date, start_time) are NOT in this object.
 */
const DEFAULTS = {
  m: 96,
  cda_pull: 0.32,
  cda_draft: 0.21,
  crr: 0.0045,
  eta: 0.97,
  g: 9.81,
  rho_fallback: STANDARD_RHO,
  pull_seconds: 45,
  pull_cap_mult: 1.3,
  max_plan_speed_kmh: 50,
  sustain_if_warn: 0.75,
  climb_threshold: 0.03,
  climb_discount: true,
  k_yaw: 0.04,
  band_pct: 0.05,
  neutral_speed_kmh: 20,
  neutral_distance_km: 1,
  cache_ttl_h: 3,
  ele_smooth_window: 5,
  max_grade: 0.18,
  min_segment_km: 2,
  grade_merge_pct: 0.003,
  styrkort_max_rows: STYRKORT_DEFAULT_MAX_ROWS,
  rider_wind_height_m: 1.2,
  forecast_wind_height_m: 10,
  exposure_terrain: 'mixed' as const,
  apply_wind_height_correction: true,
  time_zone: 'Europe/Stockholm',
} as const;

/**
 * The raw shape accepted from config.json before defaults are applied.
 * All fields except the mandatory three are optional.
 */
export type RawConfig = Partial<Config> & {
  race_date?: string;
  start_time?: string;
  gpx_path?: string;
  ftp?: number;
  n_riders?: number;
  target_total_hm?: string;
  stops?: Stop[];
};

/**
 * Apply defaults to a raw config object, derive solo and watch_target,
 * and validate mandatory fields. Throws a descriptive Error if any
 * mandatory field is absent.
 *
 * Exported so tests can call it without touching the filesystem.
 */
export function applyDefaults(raw: RawConfig): Config {
  // Validate mandatory fields
  if (!raw.gpx_path) throw new Error('Config is missing mandatory field: gpx_path');
  if (!raw.race_date) throw new Error('Config is missing mandatory field: race_date');
  if (!raw.start_time) throw new Error('Config is missing mandatory field: start_time');

  // Merge defaults, then raw (raw overrides defaults)
  const merged = { ...DEFAULTS, ...raw } as Config & typeof DEFAULTS;

  // Derive solo
  const n_riders = raw.n_riders ?? 12;
  const solo = n_riders === 1;

  // Derive watch_target: use provided value if present, else solo ? 'avg' : 'pull'
  const watch_target: 'pull' | 'avg' =
    raw.watch_target !== undefined ? raw.watch_target : solo ? 'avg' : 'pull';

  // Derive pull caps from ftp if not overridden. The hard cap is a multiple of
  // ftp (pull_cap_mult): a 45 s paceline pull is a short supra-threshold effort,
  // so capping every pull at ftp wrongly throttles flat/headwind speed and leaves
  // sustainable rider-NP headroom unused. Sustainability is bounded by rider NP
  // (the outer solver's [60, ftp] range), not by the per-pull cap. The soft cap
  // (0.92*ftp) still discounts climbs so the group does not redline every ramp.
  const ftp = raw.ftp ?? 272;
  const pull_cap_mult = raw.pull_cap_mult ?? DEFAULTS.pull_cap_mult;
  const pull_cap_hard =
    raw.pull_cap_hard !== undefined ? raw.pull_cap_hard : Math.round(pull_cap_mult * ftp);
  const pull_cap_soft =
    raw.pull_cap_soft !== undefined ? raw.pull_cap_soft : Math.round(0.92 * ftp);

  // np_target is left undefined here: resolved later from FIT or fallback
  const np_target = raw.np_target; // may be undefined

  return {
    ...merged,
    ftp,
    n_riders,
    solo,
    watch_target,
    pull_cap_hard,
    pull_cap_soft,
    np_target,
  };
}
