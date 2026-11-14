export type RegionId =
  'whole_body' | 'head' | 'chest' | 'abdomen' | 'left_arm' | 'right_arm' | 'left_leg' | 'right_leg';

export interface RegionMeta {
  id: RegionId;
  label: string;
  /** What the side panel shows for this region. */
  panel: 'whole_body' | 'head' | 'chest' | 'abdomen' | 'arm' | 'leg';
  /** organ_dose_estimates.body_region values that belong to this region. */
  doseRegions: string[];
}

/** Order of the keyboard region list. The figure faces you: its left is on your right. */
export const REGIONS: RegionMeta[] = [
  { id: 'whole_body', label: 'Whole body', panel: 'whole_body', doseRegions: ['whole_body'] },
  { id: 'head', label: 'Head', panel: 'head', doseRegions: ['head', 'brain'] },
  {
    id: 'chest',
    label: 'Chest',
    panel: 'chest',
    doseRegions: ['chest', 'thorax', 'lungs', 'heart'],
  },
  {
    id: 'abdomen',
    label: 'Abdomen',
    panel: 'abdomen',
    doseRegions: ['abdomen', 'liver', 'stomach', 'colon'],
  },
  { id: 'left_arm', label: 'Left arm', panel: 'arm', doseRegions: ['left_arm'] },
  { id: 'right_arm', label: 'Right arm', panel: 'arm', doseRegions: ['right_arm'] },
  { id: 'left_leg', label: 'Left leg', panel: 'leg', doseRegions: ['left_leg'] },
  { id: 'right_leg', label: 'Right leg', panel: 'leg', doseRegions: ['right_leg'] },
];

export const regionById = (id: RegionId): RegionMeta => REGIONS.find((r) => r.id === id)!;

/**
 * Sequential ramp for modelled dose (one hue, dim -> bright on the dark surface).
 * Validated with the dataviz skill's validator (--ordinal, surface #0e1a30): PASS.
 */
export const DOSE_RAMP = ['#5a45b0', '#7458d8', '#9a82f4', '#c8b9fb'] as const;
export const NO_ESTIMATE_COLOR = '#2a4068';

/** Bin a value into the ramp for display. Scale is 0 to `max` (inclusive). */
export function doseColor(value: number, max: number): string {
  if (max <= 0) return DOSE_RAMP[0];
  const i = Math.min(DOSE_RAMP.length - 1, Math.floor((value / max) * DOSE_RAMP.length));
  return DOSE_RAMP[i]!;
}
