/**
 * Small display-only formatting helpers for the results tables.
 *
 * secondsToHMM renders a DURATION as H:MM (no day wrap, no zero-padded hour),
 * which is what the scenario totals, leg times and cumulative column want. It is
 * deliberately distinct from @stp/core's secondsToClock, which renders a
 * wall-clock HH:MM and wraps at 24 h (used for arrival / departure columns).
 */
export function secondsToHMM(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * Render a finish-time uncertainty interval. Returns the point value as H:MM
 * when the spread is under `minSpreadS` (default 60 s, i.e. sub-minute noise
 * we should not dress up as a range), otherwise "H:MM  ·  spann L–H". Reuses
 * secondsToHMM so the durations match the rest of the UI.
 */
export function formatFinishInterval(
  expectedS: number,
  lowS: number,
  highS: number,
  minSpreadS = 60,
): string {
  const point = secondsToHMM(expectedS);
  if (highS - lowS < minSpreadS) return point;
  return `${point}  ·  spann ${secondsToHMM(lowS)}–${secondsToHMM(highS)}`;
}

/** Wind speed in m/s rounded to one decimal with a Swedish decimal comma. */
export function windMs1(ms: number): string {
  return (Math.round(ms * 10) / 10).toFixed(1).replace('.', ',');
}

/** Metres to kilometres, fixed to one decimal (e.g. 40123 -> "40.1"). */
export function metersToKm1(m: number): string {
  return (m / 1000).toFixed(1);
}

/** Leg avg speed in km/h to one decimal. Returns "0.0" if timeS is zero. */
export function avgSpeedKmh(distanceM: number, timeS: number): string {
  if (timeS <= 0) return '0.0';
  return ((distanceM / timeS) * 3.6).toFixed(1);
}
