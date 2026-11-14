/**
 * Single source of truth for every /api/v1 endpoint. The typed clients in
 * src/api/*.ts and the MSW handlers in src/mocks/handlers.ts both use these keys,
 * and a test asserts every key has a mock handler.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EndpointDef {
  method: HttpMethod;
  /** Path after the /api/v1 prefix, with :param placeholders. */
  path: string;
}

export const ENDPOINTS = {
  // auth
  'auth.login': { method: 'POST', path: '/auth/login' },
  'auth.logout': { method: 'POST', path: '/auth/logout' },
  'auth.me': { method: 'GET', path: '/auth/me' },
  'auth.demoAccounts': { method: 'GET', path: '/auth/demo-accounts' },
  'auth.demoSession': { method: 'POST', path: '/auth/demo-session' },

  // missions
  'missions.currentState': { method: 'GET', path: '/missions/current/state' },
  'missions.dataIntegrity': { method: 'GET', path: '/missions/current/data-integrity' },
  'missions.auditLog': { method: 'GET', path: '/missions/current/audit-log' },
  'missions.aiStatus': { method: 'GET', path: '/missions/current/ai-status' },

  // astronauts
  'astronauts.list': { method: 'GET', path: '/astronauts' },
  'astronauts.get': { method: 'GET', path: '/astronauts/:astronautId' },
  'astronauts.healthSummary': { method: 'GET', path: '/astronauts/:astronautId/health/summary' },
  'astronauts.schedule': { method: 'GET', path: '/astronauts/:astronautId/schedule' },
  'astronauts.baselines': { method: 'GET', path: '/astronauts/:astronautId/baselines' },
  'astronauts.readiness': { method: 'GET', path: '/astronauts/:astronautId/readiness' },
  'astronauts.readinessSummary': {
    method: 'GET',
    path: '/astronauts/:astronautId/readiness/summary',
  },
  'astronauts.alerts': { method: 'GET', path: '/astronauts/:astronautId/alerts' },

  // vitals
  'vitals.history': { method: 'GET', path: '/vitals/history' },
  'vitals.reference': { method: 'GET', path: '/vitals/reference' },
  'vitals.environment': { method: 'GET', path: '/vitals/environment' },
  'vitals.activity': { method: 'GET', path: '/vitals/activity' },
  'vitals.sensors': { method: 'GET', path: '/vitals/sensors' },

  // radiation
  'radiation.readings': { method: 'GET', path: '/radiation' },
  'radiation.organDose': { method: 'GET', path: '/radiation/organ-dose' },
  'radiation.reference': { method: 'GET', path: '/radiation/reference' },

  // sleep
  'sleep.records': { method: 'GET', path: '/sleep' },

  // assessments
  'assessments.protocols': { method: 'GET', path: '/assessments/protocols' },
  'assessments.metricDefinitions': { method: 'GET', path: '/assessments/metric-definitions' },
  'assessments.due': { method: 'GET', path: '/assessments/due' },
  'assessments.listSessions': { method: 'GET', path: '/assessments/sessions' },
  'assessments.startSession': { method: 'POST', path: '/assessments/sessions' },
  'assessments.submitTrials': { method: 'POST', path: '/assessments/sessions/:sessionId/trials' },
  'assessments.listTrials': { method: 'GET', path: '/assessments/sessions/:sessionId/trials' },
  'assessments.completeSession': {
    method: 'POST',
    path: '/assessments/sessions/:sessionId/complete',
  },
  'assessments.sessionResults': { method: 'GET', path: '/assessments/sessions/:sessionId/results' },
  'assessments.submitContext': { method: 'POST', path: '/assessments/context' },
  'assessments.listTemplates': { method: 'GET', path: '/assessments/schedule-templates' },
  'assessments.createTemplate': { method: 'POST', path: '/assessments/schedule-templates' },
  'assessments.listAssignments': { method: 'GET', path: '/assessments/assignments' },
  'assessments.createAssignments': { method: 'POST', path: '/assessments/assignments' },
  'assessments.grantAccess': {
    method: 'POST',
    path: '/assessments/assignments/:assignmentId/grant',
  },
  'assessments.revokeAccess': {
    method: 'POST',
    path: '/assessments/assignments/:assignmentId/revoke',
  },
  'assessments.oversight': { method: 'GET', path: '/assessments/oversight' },
  'assessments.flagged': { method: 'GET', path: '/assessments/flagged' },
  'assessments.missionMindSummary': { method: 'GET', path: '/assessments/mission-mind/summary' },

  // cognition
  'cognition.dailyResults': { method: 'GET', path: '/cognition/daily-results' },
  'cognition.comparisons': { method: 'GET', path: '/cognition/comparisons' },
  'cognition.summary': { method: 'GET', path: '/cognition/summary' },

  // planning
  'planning.overview': { method: 'GET', path: '/planning/overview' },
  'planning.listTaskSets': { method: 'GET', path: '/planning/task-sets' },
  'planning.getTaskSet': { method: 'GET', path: '/planning/task-sets/:taskSetId' },
  'planning.createTask': { method: 'POST', path: '/planning/tasks' },
  'planning.updateTask': { method: 'PATCH', path: '/planning/tasks/:taskId' },
  'planning.updateRequirements': { method: 'PUT', path: '/planning/tasks/:taskId/requirements' },
  'planning.crewOverview': { method: 'GET', path: '/planning/crew-overview' },
  'planning.optimize': { method: 'POST', path: '/planning/optimize' },
  'planning.optimizeStatus': { method: 'GET', path: '/planning/optimize/:runId' },
  'planning.listSchedules': { method: 'GET', path: '/planning/schedules' },
  'planning.getSchedule': { method: 'GET', path: '/planning/schedules/:scheduleVersionId' },
  'planning.overrideSchedule': {
    method: 'POST',
    path: '/planning/schedules/:scheduleVersionId/overrides',
  },
  'planning.approveSchedule': {
    method: 'POST',
    path: '/planning/schedules/:scheduleVersionId/approve',
  },
  'planning.recoveryCatalogue': { method: 'GET', path: '/planning/recovery/catalogue' },

  // recovery
  'recovery.recommend': { method: 'POST', path: '/recovery/recommend' },
  'recovery.recommendations': { method: 'GET', path: '/recovery/recommendations' },
  'recovery.scheduled': { method: 'GET', path: '/recovery/scheduled' },
  'recovery.publish': {
    method: 'POST',
    path: '/recovery/recommendations/:recommendationId/publish',
  },
  'recovery.published': { method: 'GET', path: '/recovery/published' },

  // research
  'research.overview': { method: 'GET', path: '/research/overview' },
  'research.variables': { method: 'GET', path: '/research/variables' },
  'research.listAnalyses': { method: 'GET', path: '/research/analyses' },
  'research.createAnalysis': { method: 'POST', path: '/research/analyses' },
  'research.getAnalysis': { method: 'GET', path: '/research/analyses/:analysisId' },
  'research.analysisResults': { method: 'GET', path: '/research/analyses/:analysisId/results' },
  'research.analysisCharts': { method: 'GET', path: '/research/analyses/:analysisId/charts' },
  'research.analysisReport': { method: 'GET', path: '/research/analyses/:analysisId/report' },
  'research.planningComparison': { method: 'GET', path: '/research/planning-comparison' },

  // simulation
  'simulation.listRuns': { method: 'GET', path: '/simulation/runs' },
  'simulation.createRun': { method: 'POST', path: '/simulation/runs' },
  'simulation.updateRun': { method: 'PATCH', path: '/simulation/runs/:runId' },
  'simulation.startRun': { method: 'POST', path: '/simulation/runs/:runId/start' },
  'simulation.pauseRun': { method: 'POST', path: '/simulation/runs/:runId/pause' },
  'simulation.selectRun': { method: 'POST', path: '/simulation/runs/:runId/select' },
  'simulation.listEvents': { method: 'GET', path: '/simulation/events' },
  'simulation.triggerEvent': { method: 'POST', path: '/simulation/events/:eventId/trigger' },
  'simulation.demoStory': { method: 'POST', path: '/simulation/demo-story' },

  // mind chat: served by the AEGIS Mind Companion service (server/mind-chat), never
  // by the MSW mock, so a reply can only ever come from the real model.
  'mindChat.status': { method: 'GET', path: '/mind-chat/status' },
  'mindChat.listConversations': { method: 'GET', path: '/mind-chat/conversations' },
  'mindChat.createConversation': { method: 'POST', path: '/mind-chat/conversations' },
  'mindChat.getConversation': { method: 'GET', path: '/mind-chat/conversations/:conversationId' },
  'mindChat.deleteConversation': {
    method: 'DELETE',
    path: '/mind-chat/conversations/:conversationId',
  },
  'mindChat.sendMessage': {
    method: 'POST',
    path: '/mind-chat/conversations/:conversationId/messages',
  },
} as const satisfies Record<string, EndpointDef>;

export type EndpointKey = keyof typeof ENDPOINTS;

/** Endpoints with no MSW handler on purpose (see the mind chat block above). */
export const UNMOCKED_ENDPOINTS: readonly EndpointKey[] = (
  Object.keys(ENDPOINTS) as EndpointKey[]
).filter((k) => k.startsWith('mindChat.'));

/** Fill :params in a path template. Values are URI-encoded. */
export function buildPath(template: string, params: Record<string, string> = {}): string {
  return template.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${template}`);
    return encodeURIComponent(value);
  });
}
