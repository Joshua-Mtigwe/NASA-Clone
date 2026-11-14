import type { RecoveryRecommendationsRow, ScheduledRecoveryRow } from '@/types/tables';
import { callEndpoint } from './client';
import type { AstronautRangeQuery, RecoveryRecommendRequest } from './types';

export const recoveryApi = {
  recommend: (body: RecoveryRecommendRequest) =>
    callEndpoint<RecoveryRecommendationsRow[]>('recovery.recommend', {}, { body }),
  recommendations: (query: { astronaut_id: string; mission_day?: number }) =>
    callEndpoint<RecoveryRecommendationsRow[]>('recovery.recommendations', {}, { query }),
  scheduled: (query: AstronautRangeQuery) =>
    callEndpoint<ScheduledRecoveryRow[]>('recovery.scheduled', {}, { query }),
};
