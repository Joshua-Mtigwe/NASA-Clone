import type {
  ActivityRecordsRow,
  EnvironmentReadingsRow,
  SensorReadingsRow,
  SensorsRow,
} from '@/types/tables';
import { callEndpoint } from './client';
import type {
  AstronautRangeQuery,
  EnvironmentQuery,
  Page,
  PhysiologicalReference,
  VitalsHistoryQuery,
} from './types';

export const vitalsApi = {
  history: (query: VitalsHistoryQuery) =>
    callEndpoint<Page<SensorReadingsRow>>('vitals.history', {}, { query }),
  /** Personal reference for one measure; 404 when the backend has none yet. */
  reference: (query: { astronaut_id: string; measurement_type: string }) =>
    callEndpoint<PhysiologicalReference>('vitals.reference', {}, { query }),
  environment: (query: EnvironmentQuery = {}) =>
    callEndpoint<Page<EnvironmentReadingsRow>>('vitals.environment', {}, { query }),
  activity: (query: AstronautRangeQuery) =>
    callEndpoint<ActivityRecordsRow[]>('vitals.activity', {}, { query }),
  sensors: () => callEndpoint<SensorsRow[]>('vitals.sensors'),
};
