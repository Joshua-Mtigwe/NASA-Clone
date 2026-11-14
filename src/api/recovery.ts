import type { RecoveryRecommendationsRow, ScheduledRecoveryRow } from '@/types/tables';
import { callEndpoint } from './client';
import type {
  AstronautRangeQuery,
  PublishedRoutine,
  PublishRoutineRequest,
  RecoveryRecommendRequest,
  RoutinePublication,
} from './types';

export const recoveryApi = {
  recommend: (body: RecoveryRecommendRequest) =>
    callEndpoint<RecoveryRecommendationsRow[]>('recovery.recommend', {}, { body }),
  recommendations: (query: { astronaut_id: string; mission_day?: number }) =>
    callEndpoint<RecoveryRecommendationsRow[]>('recovery.recommendations', {}, { query }),
  scheduled: (query: AstronautRangeQuery) =>
    callEndpoint<ScheduledRecoveryRow[]>('recovery.scheduled', {}, { query }),
  /** Check (dry_run) or publish a recommended routine to the astronaut's schedule. */
  publish: (recommendationId: string, body: PublishRoutineRequest) =>
    callEndpoint<RoutinePublication>('recovery.publish', { recommendationId }, { body }),
  /** Routines published to an astronaut's schedule on one date (YYYY-MM-DD). */
  published: (query: { astronaut_id: string; date: string }) =>
    callEndpoint<PublishedRoutine[]>('recovery.published', {}, { query }),
};
