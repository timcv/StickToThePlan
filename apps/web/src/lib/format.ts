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

/** Metres to kilometres, fixed to one decimal (e.g. 40123 -> "40.1"). */
export function metersToKm1(m: number): string {
  return (m / 1000).toFixed(1);
}
