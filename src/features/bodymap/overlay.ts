import type { OrganDoseEstimatesRow } from '@/types/tables';
import { doseColor, NO_ESTIMATE_COLOR, REGIONS, type RegionId } from './regions';

export interface RegionOverlay {
  color: string;
  /** regional = an estimate for this region; whole_body = the whole-body estimate; none. */
  basis: 'regional' | 'whole_body' | 'none';
  estimate: OrganDoseEstimatesRow | null;
}

export interface OverlayModel {
  regions: Record<RegionId, RegionOverlay>;
  /** Display scale: 0 to the largest estimate shown. */
  max: number;
  unit: string | null;
  hasRegional: boolean;
}

/** Latest estimate per body_region at or before the mission clock. */
export function latestByRegion(rows: OrganDoseEstimatesRow[], missionTime: string) {
  const latest = new Map<string, OrganDoseEstimatesRow>();
  for (const r of rows) {
    if (r.timestamp_utc > missionTime) continue;
    const prev = latest.get(r.body_region);
    if (!prev || r.timestamp_utc > prev.timestamp_utc) latest.set(r.body_region, r);
  }
  return latest;
}

/**
 * Colour each region by the backend's modelled estimate. Regions without their own
 * estimate show the whole-body estimate and say so; nothing is interpolated.
 */
export function buildOverlay(rows: OrganDoseEstimatesRow[], missionTime: string): OverlayModel {
  const latest = latestByRegion(rows, missionTime);
  const values = [...latest.values()];
  const max = values.reduce((m, r) => Math.max(m, r.estimated_dose), 0);
  const whole = latest.get('whole_body') ?? null;

  const regions = {} as Record<RegionId, RegionOverlay>;
  let hasRegional = false;
  for (const region of REGIONS) {
    const own = region.doseRegions.map((d) => latest.get(d)).find(Boolean) ?? null;
    if (own && region.id !== 'whole_body') hasRegional = true;
    const estimate = own ?? whole;
    regions[region.id] = estimate
      ? {
          color: doseColor(estimate.estimated_dose, max),
          basis: own ? 'regional' : 'whole_body',
          estimate,
        }
      : { color: NO_ESTIMATE_COLOR, basis: 'none', estimate: null };
  }
  return { regions, max, unit: values[0]?.dose_unit ?? null, hasRegional };
}
