/**
 * Derive the GPS checkpoint set (one point per styrkort row) from the compact
 * styrkort segmentation, so the GPX waypoints and FIT course points match what
 * the rider sees on the handlebar card. The count therefore follows the
 * "Max rader" (styrkort_max_rows) setting instead of a fixed control list.
 *
 * A Start point at km 0 is always prepended (a GPS course wants a start marker,
 * and no styrkort row ends at km 0). Rows that land on a named control keep that
 * name; split points with no town get a generic "km X" label.
 */

import type { DisplaySegment } from '../types.js';
import type { ControlPoint } from '../segmentation.js';

export function checkpointsFromStyrkort(
  styrkortSegments: DisplaySegment[],
  controls: ControlPoint[],
): ControlPoint[] {
  const startName = controls.length > 0 && controls[0].km === 0 ? controls[0].name : 'Start';
  const out: ControlPoint[] = [{ name: startName, km: 0 }];
  for (const seg of styrkortSegments) {
    if (seg.to_km <= 0) continue; // never duplicate the start marker
    out.push({ name: seg.town ?? `km ${seg.to_km}`, km: seg.to_km });
  }
  return out;
}
