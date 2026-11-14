import type { AuditLogsRow } from '@/types/tables';
import { callEndpoint } from './client';
import type { AiStatus, DataIntegritySummary, MissionState, Page, PageQuery } from './types';

export const missionsApi = {
  currentState: () => callEndpoint<MissionState>('missions.currentState'),
  dataIntegrity: () => callEndpoint<DataIntegritySummary>('missions.dataIntegrity'),
  auditLog: (query: PageQuery = {}) =>
    callEndpoint<Page<AuditLogsRow>>('missions.auditLog', {}, { query }),
  aiStatus: () => callEndpoint<AiStatus>('missions.aiStatus'),
};
