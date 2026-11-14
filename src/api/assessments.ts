import type {
  AssessmentAssignmentsRow,
  AssessmentContextRow,
  AssessmentProtocolsRow,
  AssessmentResultsRow,
  AssessmentScheduleTemplatesRow,
  AssessmentSessionsRow,
  AssessmentTrialsRow,
  CognitiveComparisonsRow,
  MetricDefinitionsRow,
} from '@/types/tables';
import { callEndpoint } from './client';
import type {
  AssessmentOversightRow,
  AssignmentsQuery,
  CompleteSessionRequest,
  ContextInput,
  CreateAssignmentsRequest,
  DueAssessment,
  GrantAccessRequest,
  MissionMindSummary,
  Page,
  PageQuery,
  ScheduleTemplateInput,
  SessionCompletion,
  SessionsQuery,
  StartSessionRequest,
  SubmitTrialsRequest,
  SubmitTrialsResponse,
} from './types';

export const assessmentsApi = {
  protocols: () => callEndpoint<AssessmentProtocolsRow[]>('assessments.protocols'),
  metricDefinitions: () => callEndpoint<MetricDefinitionsRow[]>('assessments.metricDefinitions'),
  due: (astronautId?: string) =>
    callEndpoint<DueAssessment[]>('assessments.due', {}, { query: { astronaut_id: astronautId } }),

  listSessions: (query: SessionsQuery = {}) =>
    callEndpoint<Page<AssessmentSessionsRow>>('assessments.listSessions', {}, { query }),
  startSession: (body: StartSessionRequest) =>
    callEndpoint<AssessmentSessionsRow>('assessments.startSession', {}, { body }),
  submitTrials: (sessionId: string, body: SubmitTrialsRequest) =>
    callEndpoint<SubmitTrialsResponse>('assessments.submitTrials', { sessionId }, { body }),
  listTrials: (sessionId: string, query: PageQuery = {}) =>
    callEndpoint<Page<AssessmentTrialsRow>>('assessments.listTrials', { sessionId }, { query }),
  /** The backend scores the session; the response carries the scores to display. */
  completeSession: (sessionId: string, body: CompleteSessionRequest) =>
    callEndpoint<SessionCompletion>('assessments.completeSession', { sessionId }, { body }),
  sessionResults: (sessionId: string) =>
    callEndpoint<AssessmentResultsRow[]>('assessments.sessionResults', { sessionId }),

  submitContext: (body: ContextInput) =>
    callEndpoint<AssessmentContextRow>('assessments.submitContext', {}, { body }),

  listTemplates: () => callEndpoint<AssessmentScheduleTemplatesRow[]>('assessments.listTemplates'),
  createTemplate: (body: ScheduleTemplateInput) =>
    callEndpoint<AssessmentScheduleTemplatesRow>('assessments.createTemplate', {}, { body }),

  listAssignments: (query: AssignmentsQuery = {}) =>
    callEndpoint<Page<AssessmentAssignmentsRow>>('assessments.listAssignments', {}, { query }),
  createAssignments: (body: CreateAssignmentsRequest) =>
    callEndpoint<AssessmentAssignmentsRow[]>('assessments.createAssignments', {}, { body }),
  grantAccess: (assignmentId: string, body: GrantAccessRequest) =>
    callEndpoint<AssessmentAssignmentsRow>('assessments.grantAccess', { assignmentId }, { body }),
  revokeAccess: (assignmentId: string) =>
    callEndpoint<AssessmentAssignmentsRow>('assessments.revokeAccess', { assignmentId }),

  oversight: () => callEndpoint<AssessmentOversightRow[]>('assessments.oversight'),
  /** Comparisons outside the personal reference: "flagged for contextual review". */
  flagged: (astronautId?: string) =>
    callEndpoint<CognitiveComparisonsRow[]>(
      'assessments.flagged',
      {},
      { query: { astronaut_id: astronautId } },
    ),
  /** Daily Mission Mind hub: today's games, estimate, streak and today's results. */
  missionMindSummary: (astronautId: string) =>
    callEndpoint<MissionMindSummary>(
      'assessments.missionMindSummary',
      {},
      { query: { astronaut_id: astronautId } },
    ),
};
