import type { OrganDoseEstimatesRow, RadiationReadingsRow } from '@/types/tables';
import { callEndpoint } from './client';
import type { AstronautRangeQuery, TimeRangeQuery } from './types';

export const radiationApi = {
  /** Personal dosimetry: dose_rate and accumulated_dose are separate columns, never combined. */
  readings: (query: AstronautRangeQuery) =>
    callEndpoint<RadiationReadingsRow[]>('radiation.readings', {}, { query }),
  /** Modelled estimates, not measurements. */
  organDose: (query: AstronautRangeQuery) =>
    callEndpoint<OrganDoseEstimatesRow[]>('radiation.organDose', {}, { query }),
  /** External reference detector readings (NASA MSL RAD), not crew measurements. */
  reference: (query: TimeRangeQuery = {}) =>
    callEndpoint<RadiationReadingsRow[]>('radiation.reference', {}, { query }),
};
