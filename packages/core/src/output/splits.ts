import type { PlanResult, Config } from '../types.js';
import { type ControlPoint, VATTERN_CONTROLS } from '../segmentation.js';

export interface SplitRow {
  fromControl: string;
  toControl: string;
  leg_distance_m: number;
  leg_time_s: number;
  arrive_s: number;
  stop_minutes: number;
  depart_s: number;
  cumulative_s: number;
}

function nearestBoundaryCum(targetM: number, plan: PlanResult): number {
  const segs = plan.segments;
  let best = segs[0].micro.cum_distance_m;
  let bestDiff = Math.abs(best - targetM);
  for (const s of segs) {
    const d = Math.abs(s.micro.cum_distance_m - targetM);
    if (d < bestDiff) { bestDiff = d; best = s.micro.cum_distance_m; }
  }
  return best;
}

function boundaryIndex(cum: number, plan: PlanResult): number {
  return plan.segments.findIndex((s) => s.micro.cum_distance_m === cum);
}

export function buildSplitTable(
  plan: PlanResult,
  cfg: Config,
  controls: ControlPoint[] = VATTERN_CONTROLS,
): SplitRow[] {
  const segs = plan.segments;
  if (segs.length === 0) return [];

  const prefix: number[] = new Array(segs.length);
  let acc = 0;
  for (let i = 0; i < segs.length; i++) { acc += segs[i].time_s; prefix[i] = acc; }

  const stopByName = new Map<string, number>();
  for (const s of cfg.stops) stopByName.set(s.control, s.minutes);

  const arrivalAt = (km: number): { arrive: number; cum: number } => {
    // Route start: km 0 is the implicit start (cum 0, elapsed 0), matching how
    // segmentation treats the start marker. Avoids snapping to the first
    // microsegment boundary and dropping segment 0 from the opening leg.
    if (km <= 0) return { arrive: 0, cum: 0 };
    const cum = nearestBoundaryCum(km * 1000, plan);
    const idx = boundaryIndex(cum, plan);
    const rolling = idx >= 0 ? prefix[idx] : 0;
    let stopsBefore = 0;
    for (const s of cfg.stops) if (s.km < km) stopsBefore += s.minutes * 60;
    return { arrive: rolling + stopsBefore, cum };
  };

  const rows: SplitRow[] = [];
  for (let i = 0; i < controls.length - 1; i++) {
    const from = controls[i];
    const to = controls[i + 1];
    const a = arrivalAt(from.km);
    const b = arrivalAt(to.km);
    const fromStop = stopByName.get(from.name) ?? 0;
    const toStop = stopByName.get(to.name) ?? 0;
    const fromDepart = a.arrive + fromStop * 60;
    const arrive_s = b.arrive;
    const depart_s = arrive_s + toStop * 60;
    rows.push({
      fromControl: from.name,
      toControl: to.name,
      leg_distance_m: Math.max(0, b.cum - a.cum),
      leg_time_s: Math.max(0, arrive_s - fromDepart),
      arrive_s,
      stop_minutes: toStop,
      depart_s,
      cumulative_s: depart_s,
    });
  }
  return rows;
}
