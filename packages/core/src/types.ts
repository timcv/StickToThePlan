// config
export interface Stop {
  control: string;
  km: number;
  minutes: number;
}
export interface Config {
  race_date: string; // "2026-06-13"
  start_time: string; // "04:22" local race-day time
  gpx_path: string;
  fit_path?: string; // optional in solo mode
  ftp: number; // 272
  n_riders: number; // 12 group, 1 solo
  target_total_hm: string; // "11:45"
  stops: Stop[];
  m: number; // 96 kg
  np_target?: number; // resolved: from FIT, or 0.60*ftp
  cda_pull: number; // 0.32
  cda_draft: number; // 0.21
  crr: number; // 0.0045
  eta: number; // 0.97 drivetrain
  g: number; // 9.81
  rho_fallback: number; // 1.2
  pull_seconds: number; // 45
  pull_cap_hard: number; // = pull_cap_mult * ftp (short 45 s pulls run supra-FTP)
  pull_cap_soft: number; // 0.92*ftp = 250 (climb-only discount)
  pull_cap_mult: number; // 1.3: hard pull cap multiple of ftp. A 45 s paceline pull is a
  // short supra-threshold effort; sustainability is bounded by rider
  // NP, not by holding every pull under FTP.
  max_plan_speed_kmh: number; // 50: planning speed ceiling. A group will not plan a paceline
  // faster than this in a tailwind/descent; extra wind is buffer, not
  // banked time. Keeps tailwind splits realistic for a tempokort.
  sustain_if_warn: number; // 0.75: warn when ride intensity factor (rider NP / ftp) exceeds this
  climb_threshold: number; // 0.03 (3%)
  climb_discount: boolean; // true
  watch_target: 'pull' | 'avg';
  k_yaw: number; // 0.04 (yields ~8% cda rise at 20 deg yaw)
  band_pct: number; // 0.05 workout target band +/-5%
  neutral_speed_kmh: number; // 20
  neutral_distance_km: number; // 1
  cache_ttl_h: number; // 3
  ele_smooth_window: number; // 5 (microsegment moving-average window for elevation)
  max_grade: number; // 0.18 clip implausible gradients
  min_segment_km: number; // 2 merge display segments shorter than this
  grade_merge_pct: number; // 0.003 merge adjacent segments whose grade differs by less (0 disables)
  styrkort_max_rows: number; // 20 max rows in the compact handlebar card
  solo: boolean; // derived: n_riders === 1
}

// physics
export interface PhysicsParams {
  m: number;
  g: number;
  crr: number;
  eta: number;
  cda: number;
  rho: number;
}
export interface WindCond {
  windspeed_ms: number;
  winddir_from_deg: number;
  temp_c: number;
  pressure_pa: number;
}

// ingest
export interface RoutePoint {
  lat: number;
  lon: number;
  ele: number;
}
export interface MicroSegment {
  index: number;
  distance_m: number; // length of this segment
  cum_distance_m: number; // cumulative distance at segment END
  grade: number; // decimal, smoothed, clipped
  bearing_deg: number; // direction of travel 0..360
  lat: number;
  lon: number; // segment start point, used for weather lookup
  ele_start_m: number;
  ele_end_m: number;
  neutral: boolean; // true for km 0..1 neutral block
}
export interface FitPassMetrics {
  duration_s: number;
  mean_power_w: number;
  np_w: number;
  sample_count: number;
  classification: 'long_representative' | 'short_test';
  np_target_candidate: number;
  note: string; // how the anchor was determined (logged for Tim)
}

// planner
export interface SegmentPlan {
  micro: MicroSegment;
  v_ms: number;
  speed_kmh: number;
  p_pull_w: number;
  p_draft_w: number;
  p_mean_w: number;
  rider_np_w: number;
  time_s: number;
  eta_s: number; // eta_s = seconds from start_time at segment END
  headwind_ms: number;
  crosswind_ms: number;
  rho: number;
  cap_binding: 'none' | 'hard' | 'soft' | 'spinout';
}
export interface StopPlan {
  control: string;
  km: number;
  minutes: number;
  arrive_s: number;
  depart_s: number;
}
export interface PlanResult {
  np_target_used: number;
  rider_np_ride_w: number; // ride-level rider normalized power (sustainability measure)
  intensity_factor: number; // rider_np_ride_w / ftp; flags hard-to-sustain plans
  total_time_s: number;
  rolling_time_s: number;
  stop_time_s: number;
  segments: SegmentPlan[];
  stops: StopPlan[];
  reachable: boolean; // false if target time not sustainable
  notes: string[]; // logged decisions (caps binding sectors, reduced ensemble, etc.)
}

// weather
export interface WindSample {
  time_iso: string;
  lat: number;
  lon: number;
  windspeed_ms: number;
  winddir_from_deg: number;
  temp_c: number;
  pressure_pa: number;
  source: string;
}
export type Scenario = 'expected' | 'optimistic' | 'pessimistic';
// A weather provider answers wind at a place and a clock offset (seconds from start) for a scenario.
export type WeatherFn = (lat: number, lon: number, timeS: number) => WindCond;

// segmentation
export interface DisplaySegment {
  from_km: number;
  to_km: number;
  town?: string;
  distance_m: number;
  net_height_m: number;
  avg_grade: number;
  avg_speed_kmh: number; // average riding speed for this segment
  eta_s: number; // at segment end
  wind_label: string; // e.g. "Mot 6 m/s", "Med 4 m/s", "Sido 5 m/s"
  pull_w_low: number;
  pull_w_high: number;
  avg_w: number;
  note: string; // JÄMN FART, KLÄTTRING, ...
  stop_minutes?: number;
  depart_s?: number;
  micro_indices: number[]; // microsegments covered
}
