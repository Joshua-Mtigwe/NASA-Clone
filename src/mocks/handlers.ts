/**
 * MSW handlers for every endpoint in src/api/endpoints.ts, backed by fixtures
 * generated from data/csv. Anything the real backend would calculate is stubbed in
 * src/mocks/compute/ and nowhere else.
 */
import type { HttpHandler } from 'msw';
import type { EndpointKey } from '@/api/endpoints';
import type {
  AnalysisStatus,
  AssessmentOversightRow,
  CognitiveComparisonView,
  CompleteSessionRequest,
  ContextInput,
  CreateAnalysisRequest,
  CreateAssignmentsRequest,
  CreateSimulationRunRequest,
  DataIntegritySummary,
  DemoAccount,
  DemoSessionRequest,
  DueAssessment,
  GrantAccessRequest,
  LoginRequest,
  LoginResponse,
  OptimizeRequest,
  ApproveScheduleRequest,
  PlanningTaskInput,
  PublishRoutineRequest,
  RecoveryRecommendRequest,
  ResearchOverview,
  Role,
  ScheduleOverrideRequest,
  ScheduleTemplateInput,
  StartSessionRequest,
  SubmitTrialsRequest,
  TaskRequirementsInput,
  UpdateSimulationRunRequest,
} from '@/api/types';
import type { AssessmentAssignmentsRow } from '@/types/tables';
import { cognitionSummary } from './compute/cognition';
import {
  analysisCharts,
  analysisFilters,
  draftReport,
  planningComparison,
  pseudonyms,
  RESEARCH_VARIABLES,
} from './compute/research';
import { astronautAlerts, astronautSchedule, healthSummary } from './compute/health';
import {
  commitMissionClock,
  currentMissionState,
  missionNow,
  missionPhaseAt,
} from './compute/mission';
import { broadcast, realtimeHandlers } from './realtime';
import { crewOverview } from './compute/planning';
import { publishedRoutines, publishRoutine } from './compute/recoveryPublish';
import { clearDurableRows } from './persist';
import {
  approveSchedule,
  ensureDayVersion,
  optimisationStatus,
  plannerOverview,
  planningTask,
  startOptimisation,
  scheduleDetail,
  upsertTask,
} from './compute/planningOps';
import { physiologicalReference, readinessSummary } from './compute/reference';
import { checkConditions, ensureDemoAssignments, missionMindSummary } from './compute/scheduler';
import { scoreSession } from './compute/scoring';
import { mockState, nextId, resetMockDb, table } from './db';
import {
  buildHandler,
  fieldError,
  forbidden,
  HttpError,
  inRange,
  notFound,
  paginate,
  required,
  type RouteContext,
  type RouteSpec,
} from './route';
import { bearerToken, findUserByUsername, MOCK_DEMO_PASSWORD, tokenFor } from './session';

const DASHBOARD_ROLES: readonly Role[] = [
  'astronaut',
  'mission_leader',
  'medical_researcher',
  'medical_officer',
];

/** Seeded accounts the demonstration role selector may open (no administrator). */
async function demoAccounts(): Promise<DemoAccount[]> {
  const [users, roles, astronauts] = await Promise.all([
    table('users'),
    table('roles'),
    table('astronauts'),
  ]);
  return users.flatMap((u) => {
    const role = roles.find((r) => r.role_id === u.role_id);
    const roleName = role?.role_name as Role | undefined;
    if (u.account_status !== 'active' || !roleName || !DASHBOARD_ROLES.includes(roleName)) {
      return [];
    }
    const astronaut =
      roleName === 'astronaut' ? astronauts.find((a) => a.user_id === u.user_id) : undefined;
    return [
      {
        username: u.username,
        role: roleName,
        role_description: role?.description ?? '',
        astronaut_id: astronaut?.astronaut_id ?? null,
        astronaut_code: astronaut?.astronaut_code ?? null,
        crew_role: astronaut?.crew_role ?? null,
        specialization: astronaut?.specialization ?? null,
      },
    ];
  });
}

/** Mission day the demo story starts on. */
export const DEMO_STORY_DAY = 25;

// ---------- role groups ----------
const CREW_DATA: readonly Role[] = ['astronaut', 'medical_officer', 'medical_researcher'];
const MEDICAL: readonly Role[] = ['medical_officer'];
const ASSESSMENT_RUNNERS: readonly Role[] = ['astronaut', 'medical_officer'];
const PLANNERS: readonly Role[] = ['mission_leader', 'mission_control_admin'];
const RESEARCH: readonly Role[] = ['medical_researcher'];
const ADMIN: readonly Role[] = ['mission_control_admin'];
const ADMIN_AND_LEAD: readonly Role[] = ['mission_control_admin', 'mission_leader'];

const pathAstronaut = (ctx: RouteContext) => ctx.params.astronautId;
const queryAstronaut = (ctx: RouteContext) => ctx.query('astronaut_id');

async function audit(
  ctx: RouteContext,
  action_type: string,
  entity_type: string,
  entity_id: string,
  change_summary: string,
) {
  (await table('audit_logs')).push({
    audit_id: nextId('AUD'),
    user_id: ctx.user?.user_id ?? null,
    action_type,
    entity_type,
    entity_id,
    action_timestamp: await missionNow(),
    action_result: 'success',
    change_summary,
  });
}

async function findAssignment(id: string): Promise<AssessmentAssignmentsRow> {
  const row = (await table('assessment_assignments')).find((a) => a.assignment_id === id);
  if (!row) throw notFound('Assessment assignment');
  return row;
}

async function runOrThrow(runId: string) {
  const run = (await table('simulation_runs')).find((r) => r.simulation_run_id === runId);
  if (!run) throw notFound('Simulation run');
  return run;
}

async function analysisOrThrow(analysisId: string) {
  const analysis = (await table('research_analyses')).find((a) => a.analysis_id === analysisId);
  if (!analysis) throw notFound('Analysis');
  return analysis;
}

/** Mind Companion endpoints are served by server/mind-chat and are never mocked. */
type MockedEndpoint = Exclude<EndpointKey, `mindChat.${string}` | `ai.${string}`>;

const routes: Record<MockedEndpoint, RouteSpec> = {
  // ---------------- auth ----------------
  'auth.login': {
    public: true,
    resolve: async (ctx): Promise<LoginResponse> => {
      const body = await ctx.body<Partial<LoginRequest>>();
      if (!body.username) throw fieldError('username', 'Field required');
      if (!body.password) throw fieldError('password', 'Field required');
      const user = await findUserByUsername(body.username);
      if (!user || body.password !== MOCK_DEMO_PASSWORD) {
        throw new HttpError(401, 'Incorrect username or password.');
      }
      return { access_token: tokenFor(user.user_id), token_type: 'bearer', user };
    },
  },
  'auth.logout': {
    resolve: (ctx) => {
      const token = bearerToken(ctx.request);
      if (token) mockState.revokedTokens.add(token);
      return undefined;
    },
  },
  'auth.me': { resolve: (ctx) => ctx.user },
  'auth.demoAccounts': {
    public: true,
    // Demonstration roster: every active account whose role has a dashboard.
    resolve: () => demoAccounts(),
  },
  'auth.demoSession': {
    public: true,
    resolve: async (ctx): Promise<LoginResponse> => {
      const body = await ctx.body<Partial<DemoSessionRequest>>();
      if (!body.username) throw fieldError('username', 'Field required');
      // Only accounts on the demonstration roster can be opened without a password.
      const account = (await demoAccounts()).find((a) => a.username === body.username);
      const user = account ? await findUserByUsername(account.username) : null;
      if (!user) throw new HttpError(404, 'No demonstration account has that name.');
      return { access_token: tokenFor(user.user_id), token_type: 'bearer', user };
    },
  },

  // ---------------- missions ----------------
  'missions.currentState': { public: true, resolve: () => currentMissionState() },
  'missions.dataIntegrity': {
    roles: ADMIN,
    resolve: async (): Promise<DataIntegritySummary> => ({
      lineage: await table('data_lineage'),
      sources: await table('data_sources'),
      sync_events: await table('sync_events'),
      sync_conflicts: await table('sync_conflicts'),
    }),
  },
  'missions.auditLog': {
    roles: ADMIN,
    resolve: async (ctx) =>
      paginate(
        [...(await table('audit_logs'))].sort((a, b) =>
          String(b.action_timestamp).localeCompare(String(a.action_timestamp)),
        ),
        ctx,
        100,
      ),
  },
  'missions.aiStatus': {
    roles: ADMIN,
    resolve: async () => {
      const logs = await table('ai_inference_logs');
      const last = logs[logs.length - 1];
      // No inference has been logged: report unknown rather than guessing.
      return {
        model_loaded: last ? last.status === 'success' : null,
        last_response_ms: last?.latency_ms ?? null,
        fallback_active: last ? last.status === 'fallback' : null,
        recent_inferences: logs.slice(-20),
      };
    },
  },

  // ---------------- astronauts ----------------
  'astronauts.list': { resolve: () => table('astronauts') },
  'astronauts.get': {
    subject: pathAstronaut,
    resolve: async (ctx) => {
      const astronaut = (await table('astronauts')).find(
        (a) => a.astronaut_id === ctx.params.astronautId,
      );
      if (!astronaut) throw notFound('Astronaut');
      const qualifications = (await table('astronaut_qualifications')).filter(
        (q) => q.astronaut_id === astronaut.astronaut_id,
      );
      return { astronaut, qualifications };
    },
  },
  'astronauts.healthSummary': {
    roles: CREW_DATA,
    subject: pathAstronaut,
    resolve: (ctx) => healthSummary(ctx.params.astronautId!),
  },
  'astronauts.schedule': {
    subject: pathAstronaut,
    resolve: (ctx) => astronautSchedule(ctx.params.astronautId!, ctx.query('date')),
  },
  'astronauts.baselines': {
    roles: CREW_DATA,
    subject: pathAstronaut,
    resolve: async (ctx) =>
      (await table('cognitive_baselines')).filter((b) => b.astronaut_id === ctx.params.astronautId),
  },
  'astronauts.readiness': {
    subject: pathAstronaut,
    resolve: async (ctx) =>
      (await table('crew_readiness'))
        .filter((r) => r.astronaut_id === ctx.params.astronautId)
        .sort((a, b) => b.assessment_date.localeCompare(a.assessment_date)),
  },
  'astronauts.alerts': {
    roles: CREW_DATA,
    subject: pathAstronaut,
    resolve: (ctx) => astronautAlerts(ctx.params.astronautId!),
  },
  'astronauts.readinessSummary': {
    roles: CREW_DATA,
    subject: pathAstronaut,
    resolve: (ctx) => readinessSummary(ctx.params.astronautId!),
  },

  // ---------------- vitals ----------------
  'vitals.reference': {
    roles: CREW_DATA,
    subject: queryAstronaut,
    resolve: async (ctx) => {
      const astronautId = required(ctx, 'astronaut_id');
      const measure = required(ctx, 'measurement_type');
      const reference = await physiologicalReference(astronautId, measure);
      if (!reference) throw new HttpError(404, 'No personal reference is available yet.');
      return reference;
    },
  },
  'vitals.history': {
    roles: CREW_DATA,
    subject: queryAstronaut,
    resolve: async (ctx) => {
      const astronautId = required(ctx, 'astronaut_id');
      const type = ctx.query('measurement_type');
      const from = ctx.query('from');
      const to = ctx.query('to');
      const rows = (await table('sensor_readings')).filter(
        (r) =>
          r.astronaut_id === astronautId &&
          (!type || r.measurement_type === type) &&
          inRange(r.timestamp_utc, from, to),
      );
      return paginate(rows, ctx);
    },
  },
  'vitals.environment': {
    resolve: async (ctx) => {
      const type = ctx.query('measurement_type');
      const rows = (await table('environment_readings')).filter(
        (r) =>
          (!type || r.measurement_type === type) &&
          inRange(r.timestamp_utc, ctx.query('from'), ctx.query('to')),
      );
      return paginate(rows, ctx);
    },
  },
  'vitals.activity': {
    roles: CREW_DATA,
    subject: queryAstronaut,
    resolve: async (ctx) => {
      const astronautId = required(ctx, 'astronaut_id');
      return (await table('activity_records')).filter(
        (r) =>
          r.astronaut_id === astronautId &&
          inRange(r.start_time, ctx.query('from'), ctx.query('to')),
      );
    },
  },
  'vitals.sensors': { resolve: () => table('sensors') },

  // ---------------- radiation ----------------
  'radiation.readings': {
    roles: CREW_DATA,
    subject: queryAstronaut,
    resolve: async (ctx) => {
      const astronautId = required(ctx, 'astronaut_id');
      return (await table('radiation_readings')).filter(
        (r) =>
          r.astronaut_id === astronautId &&
          inRange(r.timestamp_utc, ctx.query('from'), ctx.query('to')),
      );
    },
  },
  'radiation.organDose': {
    roles: CREW_DATA,
    subject: queryAstronaut,
    resolve: async (ctx) => {
      const astronautId = required(ctx, 'astronaut_id');
      return (await table('organ_dose_estimates')).filter(
        (r) =>
          r.astronaut_id === astronautId &&
          inRange(r.timestamp_utc, ctx.query('from'), ctx.query('to')),
      );
    },
  },
  'radiation.reference': {
    resolve: async (ctx) =>
      (await table('radiation_readings')).filter(
        (r) =>
          r.astronaut_id === null && inRange(r.timestamp_utc, ctx.query('from'), ctx.query('to')),
      ),
  },

  // ---------------- sleep ----------------
  'sleep.records': {
    roles: CREW_DATA,
    subject: queryAstronaut,
    resolve: async (ctx) => {
      const astronautId = required(ctx, 'astronaut_id');
      return (await table('sleep_records')).filter(
        (r) =>
          r.astronaut_id === astronautId &&
          inRange(r.sleep_start, ctx.query('from'), ctx.query('to')),
      );
    },
  },

  // ---------------- assessments ----------------
  'assessments.protocols': { resolve: () => table('assessment_protocols') },
  'assessments.metricDefinitions': { resolve: () => table('metric_definitions') },
  'assessments.due': {
    roles: ASSESSMENT_RUNNERS,
    subject: queryAstronaut,
    resolve: async (ctx): Promise<DueAssessment[]> => {
      const astronautId = ctx.query('astronaut_id') ?? ctx.user?.astronaut_id ?? undefined;
      if (astronautId) await ensureDemoAssignments(astronautId);
      const now = await missionNow();
      const [assignments, protocols, templates] = await Promise.all([
        table('assessment_assignments'),
        table('assessment_protocols'),
        table('assessment_schedule_templates'),
      ]);
      const open = assignments.filter(
        (a) =>
          (!astronautId || a.astronaut_id === astronautId) &&
          ['scheduled', 'authorized', 'in_progress'].includes(a.access_status),
      );
      const due: DueAssessment[] = [];
      for (const assignment of open) {
        const protocol = protocols.find((p) => p.protocol_id === assignment.protocol_id);
        if (!protocol) continue;
        const expired = assignment.access_expires_at !== null && assignment.access_expires_at < now;
        const granted = assignment.access_status !== 'scheduled';
        const authorized = granted && !expired;
        const conditions = await checkConditions(
          assignment.assessment_condition,
          assignment.astronaut_id,
        );
        due.push({
          assignment,
          protocol,
          authorized,
          conditions_met: conditions.met,
          blocking_reason: !granted
            ? 'Waiting for the medical officer to grant access.'
            : expired
              ? 'Access window has expired.'
              : conditions.reason,
          mission_phase:
            templates.find((t) => t.template_id === assignment.schedule_template_id)
              ?.mission_phase ?? (await missionPhaseAt(assignment.scheduled_at)),
        });
      }
      return due;
    },
  },
  'assessments.listSessions': {
    roles: CREW_DATA,
    subject: queryAstronaut,
    resolve: async (ctx) => {
      const astronautId = ctx.query('astronaut_id');
      const protocolId = ctx.query('protocol_id');
      const phase = ctx.query('mission_phase');
      const rows = (await table('assessment_sessions')).filter(
        (s) =>
          (!astronautId || s.astronaut_id === astronautId) &&
          (!protocolId || s.protocol_id === protocolId) &&
          (!phase || s.mission_phase === phase),
      );
      return paginate(rows, ctx, 200);
    },
  },
  'assessments.startSession': {
    roles: ASSESSMENT_RUNNERS,
    status: 201,
    resolve: async (ctx) => {
      const body = await ctx.body<Partial<StartSessionRequest>>();
      if (!body.assignment_id) throw fieldError('assignment_id', 'Field required');
      const assignment = await findAssignment(body.assignment_id);
      if (ctx.user?.role === 'astronaut' && assignment.astronaut_id !== ctx.user.astronaut_id) {
        throw forbidden('This assessment is assigned to another crew member.');
      }
      if (!['authorized', 'in_progress'].includes(assignment.access_status)) {
        throw forbidden('This assessment session is not authorised yet.');
      }
      const conditions = await checkConditions(
        assignment.assessment_condition,
        assignment.astronaut_id,
      );
      if (!conditions.met) {
        throw new HttpError(409, conditions.reason ?? 'Session conditions are not met.');
      }
      const startedAt = body.started_at ?? (await missionNow());
      const astronauts = await table('astronauts');
      const template = (await table('assessment_schedule_templates')).find(
        (t) => t.template_id === assignment.schedule_template_id,
      );
      const session = {
        session_id: nextId('SES'),
        assignment_id: assignment.assignment_id,
        astronaut_id: assignment.astronaut_id,
        protocol_id: assignment.protocol_id,
        mission_id:
          astronauts.find((a) => a.astronaut_id === assignment.astronaut_id)?.mission_id ?? '',
        mission_phase: template?.mission_phase ?? (await missionPhaseAt(startedAt)),
        assessment_condition: assignment.assessment_condition,
        started_at: startedAt,
        completed_at: startedAt,
        session_status: 'in_progress',
        quality_status: 'pending',
        time_since_waking_minutes: 0,
        time_since_activity_minutes: 0,
        context_id: '',
      };
      (await table('assessment_sessions')).push(session);
      assignment.access_status = 'in_progress';
      return session;
    },
  },
  'assessments.submitTrials': {
    roles: ASSESSMENT_RUNNERS,
    status: 201,
    resolve: async (ctx) => {
      const session = (await table('assessment_sessions')).find(
        (s) => s.session_id === ctx.params.sessionId,
      );
      if (!session) throw notFound('Session');
      if (session.session_status !== 'in_progress') {
        throw new HttpError(409, 'This session is already complete.');
      }
      const body = await ctx.body<Partial<SubmitTrialsRequest>>();
      if (!Array.isArray(body.trials)) throw fieldError('trials', 'Must be a list');
      const phase = body.phase ?? 'test';
      if (phase !== 'practice' && phase !== 'test') throw fieldError('phase', 'practice or test');
      const rows = body.trials.map((t) => ({
        ...t,
        trial_id: nextId(phase === 'practice' ? 'PRA' : 'TRL'),
        session_id: session.session_id,
      }));
      // Practice trials are kept apart and never reach scoring.
      if (phase === 'practice') {
        const list = mockState.practiceTrials.get(session.session_id) ?? [];
        list.push(...rows);
        mockState.practiceTrials.set(session.session_id, list);
      } else {
        (await table('assessment_trials')).push(...rows);
      }
      return { accepted: rows.length };
    },
  },
  'assessments.listTrials': {
    roles: CREW_DATA,
    resolve: async (ctx) =>
      paginate(
        (await table('assessment_trials')).filter((t) => t.session_id === ctx.params.sessionId),
        ctx,
        200,
      ),
  },
  'assessments.completeSession': {
    roles: ASSESSMENT_RUNNERS,
    resolve: async (ctx) => {
      const session = (await table('assessment_sessions')).find(
        (s) => s.session_id === ctx.params.sessionId,
      );
      if (!session) throw notFound('Session');
      if (session.session_status !== 'in_progress') {
        throw new HttpError(409, 'This session is already complete.');
      }
      const body = await ctx.body<Partial<CompleteSessionRequest>>();
      const completedAt = body.completed_at ?? (await missionNow());
      const trials = (await table('assessment_trials')).filter(
        (t) => t.session_id === session.session_id,
      );
      const contexts = (await table('assessment_context'))
        // The check-in nearest before completion; never one from later in the CSV.
        .filter((c) => c.astronaut_id === session.astronaut_id && c.timestamp_utc <= completedAt)
        .sort((a, b) => b.timestamp_utc.localeCompare(a.timestamp_utc));
      const results = await scoreSession(
        session.session_id,
        session.protocol_id,
        trials,
        contexts[0]?.fatigue_score ?? null,
        completedAt,
      );
      (await table('assessment_results')).push(...results);
      session.session_status = 'completed';
      session.completed_at = completedAt;
      session.quality_status =
        results.length === 0
          ? 'insufficient_data'
          : (body.interruption_count ?? 0) > 0
            ? 'valid_with_interruptions'
            : 'valid';
      const assignment = (await table('assessment_assignments')).find(
        (a) => a.assignment_id === session.assignment_id,
      );
      if (assignment) assignment.access_status = 'completed';
      return { session, results };
    },
  },
  'assessments.sessionResults': {
    roles: CREW_DATA,
    resolve: async (ctx) =>
      (await table('assessment_results')).filter((r) => r.session_id === ctx.params.sessionId),
  },
  'assessments.submitContext': {
    roles: ASSESSMENT_RUNNERS,
    status: 201,
    resolve: async (ctx) => {
      const body = await ctx.body<ContextInput>();
      if (!body.astronaut_id) throw fieldError('astronaut_id', 'Field required');
      if (ctx.user?.role === 'astronaut' && body.astronaut_id !== ctx.user.astronaut_id) {
        throw forbidden('Astronauts can only submit their own check-in.');
      }
      const row = { ...body, context_id: nextId('CTX') };
      (await table('assessment_context')).push(row);
      return row;
    },
  },
  'assessments.listTemplates': {
    roles: ['medical_officer', 'medical_researcher', 'astronaut'],
    resolve: () => table('assessment_schedule_templates'),
  },
  'assessments.createTemplate': {
    roles: MEDICAL,
    status: 201,
    resolve: async (ctx) => {
      const body = await ctx.body<Partial<ScheduleTemplateInput>>();
      if (!body.protocol_ids) throw fieldError('protocol_ids', 'Select at least one test');
      if (!body.mission_phase) throw fieldError('mission_phase', 'Field required');
      if (!body.assessment_condition) throw fieldError('assessment_condition', 'Field required');
      const row = {
        template_id: nextId('TPL'),
        mission_phase: body.mission_phase,
        assessment_condition: body.assessment_condition,
        local_hour: body.local_hour ?? 8,
        protocol_ids: body.protocol_ids,
        recurrence: body.recurrence ?? 'daily',
        // collection_start/end are proposed fields with no column; kept in the description.
        description: [
          body.description ?? '',
          body.collection_start
            ? `collection ${body.collection_start} to ${body.collection_end ?? 'open'}`
            : '',
        ]
          .filter(Boolean)
          .join(' · '),
      };
      (await table('assessment_schedule_templates')).push(row);
      return row;
    },
  },
  'assessments.listAssignments': {
    roles: ASSESSMENT_RUNNERS,
    subject: queryAstronaut,
    resolve: async (ctx) => {
      const astronautId = ctx.query('astronaut_id');
      const status = ctx.query('access_status');
      return paginate(
        (await table('assessment_assignments')).filter(
          (a) =>
            (!astronautId || a.astronaut_id === astronautId) &&
            (!status || a.access_status === status),
        ),
        ctx,
        200,
      );
    },
  },
  'assessments.createAssignments': {
    roles: MEDICAL,
    status: 201,
    resolve: async (ctx) => {
      const body = await ctx.body<Partial<CreateAssignmentsRequest>>();
      if (!body.astronaut_ids?.length)
        throw fieldError('astronaut_ids', 'Select at least one astronaut');
      if (!body.template_id) throw fieldError('template_id', 'Field required');
      if (!body.scheduled_at) throw fieldError('scheduled_at', 'Field required');
      const template = (await table('assessment_schedule_templates')).find(
        (t) => t.template_id === body.template_id,
      );
      if (!template) throw notFound('Assessment programme');
      const rows: AssessmentAssignmentsRow[] = [];
      for (const astronautId of body.astronaut_ids) {
        for (const protocolId of template.protocol_ids.split('|')) {
          rows.push({
            assignment_id: nextId('ASG'),
            astronaut_id: astronautId,
            protocol_id: protocolId,
            assigned_by_user_id: ctx.user?.user_id ?? null,
            scheduled_at: body.scheduled_at,
            assessment_condition: template.assessment_condition,
            access_status: 'scheduled',
            // Same 60-minute window the CSV assignments use; extended by a grant.
            access_expires_at: new Date(Date.parse(body.scheduled_at) + 3_600_000)
              .toISOString()
              .replace('.000Z', 'Z'),
            assignment_source: 'medical_officer',
            schedule_template_id: template.template_id,
            simulation_run_id: mockState.selectedRunId,
          });
        }
      }
      (await table('assessment_assignments')).push(...rows);
      await audit(
        ctx,
        'assign_assessments',
        'assessment_schedule_templates',
        template.template_id,
        `${rows.length} assignments`,
      );
      return rows;
    },
  },
  'assessments.grantAccess': {
    roles: MEDICAL,
    resolve: async (ctx) => {
      const assignment = await findAssignment(ctx.params.assignmentId!);
      const body = await ctx.body<Partial<GrantAccessRequest>>();
      if (!body.access_expires_at) throw fieldError('access_expires_at', 'Field required');
      assignment.access_status = 'authorized';
      assignment.access_expires_at = body.access_expires_at;
      await audit(
        ctx,
        'grant_access',
        'assessment_assignments',
        assignment.assignment_id,
        `until ${body.access_expires_at}`,
      );
      return assignment;
    },
  },
  'assessments.revokeAccess': {
    roles: MEDICAL,
    resolve: async (ctx) => {
      const assignment = await findAssignment(ctx.params.assignmentId!);
      assignment.access_status = 'revoked';
      await audit(
        ctx,
        'revoke_access',
        'assessment_assignments',
        assignment.assignment_id,
        'revoked',
      );
      return assignment;
    },
  },
  'assessments.oversight': {
    roles: MEDICAL,
    resolve: async (): Promise<AssessmentOversightRow[]> => {
      const now = await missionNow();
      const [astronauts, allSessions, allComparisons] = await Promise.all([
        table('astronauts'),
        table('assessment_sessions'),
        table('cognitive_comparisons'),
      ]);
      // Only what has happened by the mission clock.
      const sessions = allSessions.filter((s) => s.started_at <= now);
      const comparisons = allComparisons.filter((c) => c.calculated_at <= now);
      return astronauts.map((a) => {
        const mine = sessions.filter((s) => s.astronaut_id === a.astronaut_id);
        return {
          astronaut_id: a.astronaut_id,
          sessions_total: mine.length,
          sessions_completed: mine.filter((s) => s.session_status === 'completed').length,
          sessions_valid: mine.filter((s) => s.quality_status === 'valid').length,
          flagged_for_review: comparisons.filter(
            (c) =>
              c.astronaut_id === a.astronaut_id && c.reference_range_status === 'outside_reference',
          ).length,
        };
      });
    },
  },
  'assessments.missionMindSummary': {
    roles: ASSESSMENT_RUNNERS,
    subject: queryAstronaut,
    resolve: (ctx) => missionMindSummary(required(ctx, 'astronaut_id')),
  },
  'assessments.flagged': {
    roles: ['medical_officer', 'medical_researcher'],
    resolve: async (ctx) => {
      const astronautId = ctx.query('astronaut_id');
      const now = await missionNow();
      return (await table('cognitive_comparisons')).filter(
        (c) =>
          c.reference_range_status === 'outside_reference' &&
          c.calculated_at <= now &&
          (!astronautId || c.astronaut_id === astronautId),
      );
    },
  },

  // ---------------- cognition ----------------
  'cognition.dailyResults': {
    roles: CREW_DATA,
    subject: queryAstronaut,
    resolve: async (ctx) => {
      const astronautId = required(ctx, 'astronaut_id');
      const domain = ctx.query('cognitive_domain');
      return (await table('daily_cognitive_results')).filter(
        (r) =>
          r.astronaut_id === astronautId &&
          (!domain || r.cognitive_domain === domain) &&
          inRange(r.assessment_date, ctx.query('from'), ctx.query('to')),
      );
    },
  },
  'cognition.comparisons': {
    roles: CREW_DATA,
    subject: queryAstronaut,
    resolve: async (ctx): Promise<CognitiveComparisonView[]> => {
      const astronautId = required(ctx, 'astronaut_id');
      const domain = ctx.query('cognitive_domain');
      const from = ctx.query('from');
      const to = ctx.query('to');
      const [comparisons, daily, baselines] = await Promise.all([
        table('cognitive_comparisons'),
        table('daily_cognitive_results'),
        table('cognitive_baselines'),
      ]);
      const dailyById = new Map(daily.map((d) => [d.daily_result_id, d]));
      const baselineById = new Map(baselines.map((b) => [b.baseline_id, b]));
      return comparisons.flatMap((comparison) => {
        if (comparison.astronaut_id !== astronautId) return [];
        const result = dailyById.get(comparison.daily_result_id);
        if (!result) return [];
        if (domain && result.cognitive_domain !== domain) return [];
        if (!inRange(result.assessment_date, from, to)) return [];
        return [
          {
            comparison,
            daily_result: result,
            baseline: baselineById.get(comparison.baseline_id) ?? null,
          },
        ];
      });
    },
  },

  'cognition.summary': {
    roles: CREW_DATA,
    subject: queryAstronaut,
    resolve: (ctx) =>
      cognitionSummary(required(ctx, 'astronaut_id'), ctx.query('from'), ctx.query('to')),
  },

  // ---------------- planning ----------------
  'planning.listTaskSets': {
    roles: PLANNERS,
    resolve: async (ctx) => {
      const day = ctx.query('mission_day');
      return (await table('daily_task_sets')).filter((s) => !day || s.mission_day === Number(day));
    },
  },
  'planning.overview': {
    roles: PLANNERS,
    resolve: (ctx) => plannerOverview(ctx.query('date')),
  },
  'planning.getTaskSet': {
    roles: PLANNERS,
    resolve: async (ctx) => {
      const taskSet = (await table('daily_task_sets')).find(
        (s) => s.task_set_id === ctx.params.taskSetId,
      );
      if (!taskSet) throw notFound('Task set');
      const tasks = (await table('mission_tasks')).filter(
        (t) => t.task_set_id === taskSet.task_set_id,
      );
      return { task_set: taskSet, tasks: await Promise.all(tasks.map(planningTask)) };
    },
  },
  'planning.createTask': {
    roles: ['mission_leader'],
    status: 201,
    resolve: async (ctx) =>
      upsertTask(await ctx.body<Partial<PlanningTaskInput>>(), ctx.user!.user_id),
  },
  'planning.updateTask': {
    roles: ['mission_leader'],
    resolve: async (ctx) =>
      upsertTask(
        await ctx.body<Partial<PlanningTaskInput>>(),
        ctx.user!.user_id,
        ctx.params.taskId,
      ),
  },
  'planning.updateRequirements': {
    roles: ['mission_leader'],
    resolve: async (ctx) => {
      const taskId = ctx.params.taskId!;
      const body = await ctx.body<TaskRequirementsInput>();
      for (const key of [
        'cognitive_demand_score',
        'physical_demand_score',
        'attention_demand_score',
        'time_pressure_score',
      ] as const) {
        const v = body[key];
        if (v !== undefined && (v < 0 || v > 5)) throw fieldError(key, 'Must be between 0 and 5');
      }
      const requirements = await table('task_requirements');
      let row = requirements.find((r) => r.task_id === taskId);
      if (!row) {
        if (!(await table('mission_tasks')).some((t) => t.task_id === taskId))
          throw notFound('Task');
        row = {
          requirement_id: nextId('REQ'),
          task_id: taskId,
          required_specialization: '',
          required_certification: '',
          cognitive_demand_score: 0,
          physical_demand_score: 0,
          attention_demand_score: 0,
          time_pressure_score: 0,
          safety_classification: 'standard_demo',
          review_status: 'proposed',
          reviewed_by_user_id: '',
        };
        requirements.push(row);
      }
      Object.assign(row, body, { reviewed_by_user_id: ctx.user?.user_id ?? '' });
      return row;
    },
  },
  'planning.crewOverview': {
    roles: [...PLANNERS, 'medical_officer'],
    resolve: () => crewOverview(),
  },
  'planning.optimize': {
    roles: ['mission_leader'],
    status: 202,
    resolve: async (ctx) => {
      const body = await ctx.body<Partial<OptimizeRequest>>();
      if (!body.task_set_id) throw fieldError('task_set_id', 'Field required');
      return startOptimisation(body.task_set_id, ctx.user?.user_id ?? null);
    },
  },
  'planning.optimizeStatus': {
    roles: PLANNERS,
    resolve: (ctx) => optimisationStatus(ctx.params.runId!),
  },
  'planning.listSchedules': {
    roles: PLANNERS,
    resolve: async (ctx) => {
      const taskSetId = ctx.query('task_set_id');
      if (taskSetId) await ensureDayVersion(taskSetId);
      return (await table('schedule_versions')).filter(
        (v) => !taskSetId || v.task_set_id === taskSetId,
      );
    },
  },
  'planning.getSchedule': {
    roles: PLANNERS,
    resolve: (ctx) => scheduleDetail(ctx.params.scheduleVersionId!),
  },
  'planning.overrideSchedule': {
    roles: ['mission_leader'],
    resolve: async (ctx) => {
      const versionId = ctx.params.scheduleVersionId!;
      const version = (await table('schedule_versions')).find(
        (v) => v.schedule_version_id === versionId,
      );
      if (!version) throw notFound('Schedule version');
      if (version.status === 'approved') {
        throw new HttpError(409, 'An approved schedule cannot be changed. Create a new version.');
      }
      const body = await ctx.body<Partial<ScheduleOverrideRequest>>();
      if (!body.reason?.trim())
        throw fieldError('reason', 'A reason is required for every override');
      if (!body.task_assignment_id) throw fieldError('task_assignment_id', 'Field required');
      const assignment = (await table('task_assignments')).find(
        (a) =>
          a.task_assignment_id === body.task_assignment_id && a.schedule_version_id === versionId,
      );
      if (!assignment) throw notFound('Task assignment');
      if (body.astronaut_id) assignment.astronaut_id = body.astronaut_id;
      if (body.planned_start) assignment.planned_start = body.planned_start;
      if (body.planned_end) assignment.planned_end = body.planned_end;
      assignment.assigned_by_user_id = ctx.user?.user_id ?? assignment.assigned_by_user_id;
      assignment.assignment_status = 'manual_override';
      await audit(
        ctx,
        'schedule_override',
        'task_assignments',
        assignment.task_assignment_id,
        body.reason,
      );
      return assignment;
    },
  },
  'planning.approveSchedule': {
    roles: ['mission_leader'],
    resolve: async (ctx) => {
      const versionId = ctx.params.scheduleVersionId!;
      const body = await ctx
        .body<Partial<ApproveScheduleRequest>>()
        .catch(() => ({}) as Partial<ApproveScheduleRequest>);
      const version = await approveSchedule(
        versionId,
        body.confirmed_safety_critical ?? [],
        ctx.user?.user_id ?? null,
      );
      await audit(
        ctx,
        'approve_schedule',
        'schedule_versions',
        versionId,
        'approved and published',
      );
      return version;
    },
  },
  'planning.recoveryCatalogue': {
    roles: [...PLANNERS, 'medical_officer', 'astronaut'],
    resolve: () => table('recovery_activities'),
  },

  // ---------------- recovery ----------------
  'recovery.recommend': {
    roles: ['mission_leader', 'medical_officer'],
    resolve: async (ctx) => {
      const body = await ctx.body<Partial<RecoveryRecommendRequest>>();
      if (!body.astronaut_id) throw fieldError('astronaut_id', 'Field required');
      if (body.mission_day === undefined) throw fieldError('mission_day', 'Field required');
      // Stub: return the precomputed recommendations for that astronaut-day, best first.
      return (await table('recovery_recommendations'))
        .filter((r) => r.astronaut_id === body.astronaut_id && r.mission_day === body.mission_day)
        .sort((a, b) => b.recommendation_score - a.recommendation_score);
    },
  },
  'recovery.recommendations': {
    subject: queryAstronaut,
    resolve: async (ctx) => {
      const astronautId = required(ctx, 'astronaut_id');
      const day = ctx.query('mission_day');
      return (await table('recovery_recommendations')).filter(
        (r) => r.astronaut_id === astronautId && (!day || r.mission_day === Number(day)),
      );
    },
  },
  'recovery.publish': {
    roles: ['mission_leader'],
    resolve: async (ctx) => {
      const body = await ctx.body<Partial<PublishRoutineRequest>>();
      return publishRoutine(ctx.params.recommendationId!, body, ctx.user!);
    },
  },
  'recovery.published': {
    roles: ['astronaut', 'mission_leader', 'medical_officer'],
    subject: queryAstronaut,
    resolve: (ctx) => publishedRoutines(required(ctx, 'astronaut_id'), required(ctx, 'date')),
  },
  'recovery.scheduled': {
    subject: queryAstronaut,
    resolve: async (ctx) => {
      const astronautId = required(ctx, 'astronaut_id');
      return (await table('scheduled_recovery')).filter(
        (r) =>
          r.astronaut_id === astronautId &&
          inRange(r.scheduled_start, ctx.query('from'), ctx.query('to')),
      );
    },
  },

  // ---------------- research ----------------
  'research.overview': {
    roles: RESEARCH,
    resolve: async (): Promise<ResearchOverview> => {
      const [sessions, daily] = await Promise.all([
        table('assessment_sessions'),
        table('daily_cognitive_results'),
      ]);
      const { toPid } = await pseudonyms();
      const byQuality: Record<string, number> = {};
      for (const s of sessions)
        byQuality[s.quality_status] = (byQuality[s.quality_status] ?? 0) + 1;
      return {
        participants: toPid.size,
        participant_ids: [...toPid.values()],
        assessment_sessions: sessions.length,
        mission_days: new Set(daily.map((d) => d.mission_day)).size,
        sessions_by_quality: byQuality,
      };
    },
  },
  'research.variables': { roles: RESEARCH, resolve: () => RESEARCH_VARIABLES },
  'research.listAnalyses': { roles: RESEARCH, resolve: () => table('research_analyses') },
  'research.createAnalysis': {
    roles: RESEARCH,
    status: 202,
    resolve: async (ctx) => {
      const body = await ctx.body<Partial<CreateAnalysisRequest>>();
      for (const field of [
        'analysis_type',
        'independent_variable',
        'dependent_variable',
        'date_range_start',
        'date_range_end',
      ] as const) {
        if (!body[field]) throw fieldError(field, 'Field required');
      }
      const types = [
        'longitudinal',
        'scatter',
        'lagged_comparison',
        'domain_heatmap',
        'paired_preflight_inflight',
        'individual_trajectories',
      ];
      if (!types.includes(body.analysis_type!))
        throw fieldError('analysis_type', 'Unknown question type');
      const known = new Set(RESEARCH_VARIABLES.map((v) => v.variable));
      if (!known.has(body.independent_variable!))
        throw fieldError('independent_variable', 'Unknown variable');
      if (!known.has(body.dependent_variable!))
        throw fieldError('dependent_variable', 'Unknown variable');
      if (body.date_range_end! < body.date_range_start!)
        throw fieldError('date_range_end', 'End is before start');
      const now = await missionNow();
      const missions = await table('missions');
      const analysis = {
        analysis_id: nextId('ANL'),
        researcher_user_id: ctx.user?.user_id ?? '',
        mission_id: missions[0]?.mission_id ?? '',
        analysis_type: body.analysis_type!,
        research_question: body.research_question?.trim() || 'Exploratory simulated data analysis',
        independent_variable: body.independent_variable!,
        dependent_variable: body.dependent_variable!,
        analysis_method: body.analysis_method ?? 'descriptive',
        date_range_start: body.date_range_start!,
        date_range_end: body.date_range_end!,
        created_at: now,
      };
      (await table('research_analyses')).push(analysis);
      analysisFilters().set(analysis.analysis_id, {
        astronaut_id: body.astronaut_id,
        cognitive_domain: body.cognitive_domain,
        mission_phase: body.mission_phase,
        quality_status: body.quality_status,
      });
      const job = {
        job_id: nextId('JOB'),
        analysis_id: analysis.analysis_id,
        simulation_run_id: mockState.selectedRunId,
        requested_by_user_id: ctx.user?.user_id ?? null,
        method: analysis.analysis_method,
        status: 'queued',
        submitted_at: now,
        started_at: null,
        completed_at: null,
        error_message: null,
      };
      (await table('analysis_jobs')).push(job);
      return job;
    },
  },
  'research.getAnalysis': {
    roles: RESEARCH,
    resolve: async (ctx): Promise<AnalysisStatus> => {
      const analysis = await analysisOrThrow(ctx.params.analysisId!);
      const job =
        (await table('analysis_jobs')).find((j) => j.analysis_id === analysis.analysis_id) ?? null;
      if (job && job.status === 'queued') {
        job.status = 'running';
      } else if (job && job.status === 'running') {
        // Stub worker: completes on the second poll and writes results and a draft report.
        const [chart] = await analysisCharts(analysis, 'within_person');
        const now = await missionNow();
        if (chart) {
          (await table('analysis_results')).push({
            analysis_result_id: nextId('RSL'),
            analysis_id: analysis.analysis_id,
            metric_name:
              chart.effect_estimate !== null ? 'pearson_r_within_person' : 'descriptive_summary',
            metric_value: chart.effect_estimate,
            metric_unit: null,
            sample_size: chart.sample_size,
            effect_estimate: chart.effect_estimate,
            confidence_interval_lower: chart.confidence_interval_lower,
            confidence_interval_upper: chart.confidence_interval_upper,
            p_value: null,
            interpretation: 'Exploratory association in synthetic data; not evidence of cause.',
            calculated_at: now,
          });
          await draftReport(analysis, chart, now);
        }
        job.status = 'completed';
        job.started_at = job.started_at ?? now;
        job.completed_at = now;
      }
      return { analysis, job };
    },
  },
  'research.analysisResults': {
    roles: RESEARCH,
    resolve: async (ctx) => {
      await analysisOrThrow(ctx.params.analysisId!);
      return (await table('analysis_results')).filter(
        (r) => r.analysis_id === ctx.params.analysisId,
      );
    },
  },
  'research.analysisCharts': {
    roles: RESEARCH,
    resolve: async (ctx) => {
      const analysis = await analysisOrThrow(ctx.params.analysisId!);
      const job = (await table('analysis_jobs')).find(
        (j) => j.analysis_id === analysis.analysis_id,
      );
      if (!job || job.status !== 'completed') return [];
      return analysisCharts(analysis, ctx.query('view') === 'pooled' ? 'pooled' : 'within_person');
    },
  },
  'research.analysisReport': {
    roles: RESEARCH,
    resolve: async (ctx) => {
      await analysisOrThrow(ctx.params.analysisId!);
      const report = (await table('research_reports')).find(
        (r) => r.analysis_id === ctx.params.analysisId,
      );
      if (!report) throw new HttpError(404, 'No report has been drafted for this analysis yet.');
      return report;
    },
  },
  'research.planningComparison': {
    roles: [...RESEARCH, 'mission_leader'],
    resolve: (ctx) => planningComparison(ctx.user?.role !== 'mission_leader'),
  },

  // ---------------- simulation ----------------
  'simulation.listRuns': { roles: ADMIN_AND_LEAD, resolve: () => table('simulation_runs') },
  'simulation.createRun': {
    roles: ADMIN,
    status: 201,
    resolve: async (ctx) => {
      const body = await ctx.body<Partial<CreateSimulationRunRequest>>();
      if (!body.run_name?.trim()) throw fieldError('run_name', 'Field required');
      const mission = (await table('missions'))[0];
      if (!mission) throw notFound('Mission');
      const run = {
        simulation_run_id: nextId('RUN'),
        mission_id: mission.mission_id,
        run_name: body.run_name,
        start_mission_time: mission.launch_date,
        current_mission_time: mission.launch_date,
        speed_multiplier: body.speed_multiplier ?? 60,
        status: 'paused',
        created_at: await missionNow(),
        data_mode: 'synthetic_demo',
      };
      (await table('simulation_runs')).push(run);
      return run;
    },
  },
  'simulation.updateRun': {
    roles: ADMIN,
    resolve: async (ctx) => {
      const run = await runOrThrow(ctx.params.runId!);
      const body = await ctx.body<Partial<UpdateSimulationRunRequest>>();
      if (!body.speed_multiplier || body.speed_multiplier <= 0) {
        throw fieldError('speed_multiplier', 'Must be greater than zero');
      }
      await commitMissionClock();
      run.speed_multiplier = body.speed_multiplier;
      await audit(
        ctx,
        'set_speed',
        'simulation_runs',
        run.simulation_run_id,
        `speed x${body.speed_multiplier}`,
      );
      broadcast({ type: 'mission_state', payload: await currentMissionState() });
      return run;
    },
  },
  'simulation.startRun': {
    roles: ADMIN,
    resolve: async (ctx) => {
      const run = await runOrThrow(ctx.params.runId!);
      await commitMissionClock();
      run.status = 'running';
      mockState.runningSince = mockState.clockNow();
      await audit(ctx, 'start_run', 'simulation_runs', run.simulation_run_id, 'started');
      broadcast({ type: 'mission_state', payload: await currentMissionState() });
      return run;
    },
  },
  'simulation.pauseRun': {
    roles: ADMIN,
    resolve: async (ctx) => {
      const run = await runOrThrow(ctx.params.runId!);
      await commitMissionClock();
      run.status = 'paused';
      mockState.runningSince = null;
      await audit(
        ctx,
        'pause_run',
        'simulation_runs',
        run.simulation_run_id,
        `paused at ${run.current_mission_time}`,
      );
      broadcast({ type: 'mission_state', payload: await currentMissionState() });
      return run;
    },
  },
  'simulation.selectRun': {
    roles: ADMIN,
    resolve: async (ctx) => {
      const run = await runOrThrow(ctx.params.runId!);
      await commitMissionClock();
      mockState.selectedRunId = run.simulation_run_id;
      mockState.runningSince = run.status === 'running' ? mockState.clockNow() : null;
      const state = await currentMissionState();
      broadcast({ type: 'mission_state', payload: state });
      return state;
    },
  },
  'simulation.listEvents': {
    roles: ADMIN_AND_LEAD,
    resolve: async (ctx) => {
      const runId = ctx.query('simulation_run_id');
      const day = ctx.query('mission_day');
      return (await table('simulation_events')).filter(
        (e) => (!runId || e.simulation_run_id === runId) && (!day || e.mission_day === Number(day)),
      );
    },
  },
  'simulation.triggerEvent': {
    roles: ADMIN,
    resolve: async (ctx) => {
      const event = (await table('simulation_events')).find(
        (e) => e.event_id === ctx.params.eventId,
      );
      if (!event) throw notFound('Simulation event');
      const state = await currentMissionState();
      const triggered = {
        ...event,
        event_id: nextId('EVT'),
        simulation_run_id: state.simulation_run?.simulation_run_id ?? event.simulation_run_id,
        mission_day: state.mission_day,
        event_timestamp: state.mission_time,
        source_type: 'manual_trigger',
      };
      (await table('simulation_events')).push(triggered);
      await audit(
        ctx,
        'trigger_event',
        'simulation_events',
        triggered.event_id,
        `from ${event.event_id}`,
      );
      broadcast({ type: 'event_triggered', payload: triggered });
      return triggered;
    },
  },
  'simulation.demoStory': {
    roles: ADMIN,
    resolve: async (ctx) => {
      // Known presentation state: all mock writes discarded, clock at day 25 12:00, paused.
      clearDurableRows();
      resetMockDb();
      mockState.missionDayOverride = DEMO_STORY_DAY;
      await audit(
        ctx,
        'demo_story',
        'simulation_runs',
        'RUN-DEMO-001',
        `reset to mission day ${DEMO_STORY_DAY}`,
      );
      const state = await currentMissionState();
      broadcast({ type: 'mission_state', payload: state });
      return state;
    },
  },
};

export const handledEndpoints = Object.keys(routes) as MockedEndpoint[];

export const handlers = [
  ...handledEndpoints.map((key): HttpHandler => buildHandler(key, routes[key])),
  ...realtimeHandlers,
];
