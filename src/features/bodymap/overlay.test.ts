import { describe, expect, it } from 'vitest';
import type { OrganDoseEstimatesRow } from '@/types/tables';
import { buildOverlay } from './overlay';
import { DOSE_RAMP, NO_ESTIMATE_COLOR } from './regions';

const row = (
  body_region: string,
  estimated_dose: number,
  timestamp_utc: string,
): OrganDoseEstimatesRow => ({
  estimate_id: `${body_region}-${timestamp_utc}`,
  astronaut_id: 'AST-001',
  mission_id: 'MIS-001',
  body_region,
  organ_name: body_region,
  estimated_dose,
  dose_unit: 'mSv',
  model_name: 'AEGIS_DEMO_ESTIMATE',
  model_version: 'v1',
  uncertainty: 'not_clinically_validated',
  timestamp_utc,
});

describe('radiation overlay model', () => {
  it('uses regional estimates where they exist, the whole-body estimate otherwise, and ignores the future', () => {
    const overlay = buildOverlay(
      [
        row('whole_body', 0.002, '2027-03-24T12:00:00Z'),
        row('whole_body', 0.004, '2027-03-25T12:00:00Z'),
        row('whole_body', 0.9, '2027-03-26T12:00:00Z'), // after the mission clock
        row('head', 0.001, '2027-03-25T12:00:00Z'),
      ],
      '2027-03-25T12:00:00Z',
    );
    expect(overlay.max).toBe(0.004);
    expect(overlay.unit).toBe('mSv');
    expect(overlay.hasRegional).toBe(true);
    expect(overlay.regions.head).toMatchObject({ basis: 'regional', color: DOSE_RAMP[1] });
    expect(overlay.regions.chest).toMatchObject({ basis: 'whole_body', color: DOSE_RAMP[3] });

    const empty = buildOverlay([], '2027-03-25T12:00:00Z');
    expect(empty.regions.chest).toEqual({
      color: NO_ESTIMATE_COLOR,
      basis: 'none',
      estimate: null,
    });
  });
});
