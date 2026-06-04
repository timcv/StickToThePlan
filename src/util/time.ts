/**
 * Time conversion utilities.
 * All functions operate on plain strings and seconds (no Date objects).
 */

/**
 * Convert an h:mm or hh:mm duration string to total seconds.
 * Examples: "11:45" -> 42300, "0:50" -> 3000
 */
export function hmToSeconds(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 3600 + m * 60;
}

/**
 * Convert an HH:MM clock string to seconds since midnight.
 * Example: "04:22" -> 15720
 */
export function clockToSeconds(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 3600 + m * 60;
}

/**
 * Advance a start clock by offsetS seconds and return the resulting HH:MM string.
 * Wraps correctly past midnight using mod 86400.
 * Examples:
 *   secondsToClock(0, "04:22")    -> "04:22"
 *   secondsToClock(42300, "04:22") -> "16:07"
 */
export function secondsToClock(offsetS: number, startHHMM: string): string {
  const total = (clockToSeconds(startHHMM) + offsetS) % 86400;
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
