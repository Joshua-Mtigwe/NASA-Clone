import type { AstronautsRow, CognitiveBaselinesRow, CrewReadinessRow } from '@/types/tables';
import { callEndpoint } from './client';
import type {
  Alert,
  AstronautProfile,
  AstronautSchedule,
  HealthSummary,
  ReadinessSummary,
} from './types';

export const astronautsApi = {
  list: () => callEndpoint<AstronautsRow[]>('astronauts.list'),
  get: (astronautId: string) => callEndpoint<AstronautProfile>('astronauts.get', { astronautId }),
  healthSummary: (astronautId: string) =>
    callEndpoint<HealthSummary>('astronauts.healthSummary', { astronautId }),
  /** `date` is YYYY-MM-DD; defaults to the current mission day on the backend. */
  schedule: (astronautId: string, date?: string) =>
    callEndpoint<AstronautSchedule>('astronauts.schedule', { astronautId }, { query: { date } }),
  baselines: (astronautId: string) =>
    callEndpoint<CognitiveBaselinesRow[]>('astronauts.baselines', { astronautId }),
  readiness: (astronautId: string) =>
    callEndpoint<CrewReadinessRow[]>('astronauts.readiness', { astronautId }),
  /** Which factors are within the personal reference. The backend assigns every status. */
  readinessSummary: (astronautId: string) =>
    callEndpoint<ReadinessSummary>('astronauts.readinessSummary', { astronautId }),
  alerts: (astronautId: string) => callEndpoint<Alert[]>('astronauts.alerts', { astronautId }),
};
