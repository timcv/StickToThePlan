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

/**
 * UTC offset (minutes) of an IANA time zone at a given instant.
 * Positive east of Greenwich (Europe/Stockholm in June -> 120).
 */
function tzOffsetMinutes(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24, // Intl may emit "24" for midnight
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - utcMs) / 60_000;
}

/**
 * Absolute UTC epoch (ms) of a local wall-clock instant ("HH:MM" in the given
 * IANA zone on the given date). Two-pass offset correction handles the rare
 * start inside a DST transition.
 * Example: raceStartEpochMs("2026-06-13", "06:00", "Europe/Stockholm")
 *   -> Date.UTC(2026, 5, 13, 4, 0, 0) (04:00 UTC).
 */
export function raceStartEpochMs(dateIso: string, hhmm: string, timeZone: string): number {
  const wallAsUtcMs = Date.parse(`${dateIso}T${hhmm.padStart(5, '0')}:00Z`);
  if (Number.isNaN(wallAsUtcMs)) {
    throw new Error(`raceStartEpochMs: invalid date/time "${dateIso}" / "${hhmm}"`);
  }
  // Offset evaluated at the wall instant interpreted as UTC; a second pass with
  // the corrected instant handles the rare start inside a DST transition.
  let utcMs = wallAsUtcMs - tzOffsetMinutes(wallAsUtcMs, timeZone) * 60_000;
  utcMs = wallAsUtcMs - tzOffsetMinutes(utcMs, timeZone) * 60_000;
  return utcMs;
}

/**
 * Convert a local wall-clock start ("HH:MM" in the given IANA zone on the given
 * date) to UTC seconds since midnight. Weather cells are binned on UTC hours,
 * so the weather clock must run in UTC while ETAs stay in local time.
 * Example: utcStartClockSeconds("2026-06-13", "06:00", "Europe/Stockholm") -> 14400 (04:00 UTC).
 */
export function utcStartClockSeconds(dateIso: string, hhmm: string, timeZone: string): number {
  const d = new Date(raceStartEpochMs(dateIso, hhmm, timeZone));
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
}

/**
 * Whole-hour offset between local wall clock and UTC for the given date/zone
 * (Europe/Stockholm in June -> 2). Used by the UI to translate between
 * local display hours and the UTC hours weather cells are binned on.
 */
export function localUtcOffsetHours(dateIso: string, hhmm: string, timeZone: string): number {
  const localS = clockToSeconds(hhmm);
  const utcS = utcStartClockSeconds(dateIso, hhmm, timeZone);
  const diffS = (((localS - utcS) % 86400) + 86400) % 86400;
  return Math.round(diffS / 3600) % 24;
}

/**
 * Format an elapsed-seconds offset as H:MM with the hour not zero-padded.
 * Used for start-independent (relative) course-point labels.
 * Example: secondsToElapsed(9720) -> "2:42"
 */
export function secondsToElapsed(offsetS: number): string {
  const total = Math.max(0, Math.floor(offsetS));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  return `${hh}:${String(mm).padStart(2, '0')}`;
}
