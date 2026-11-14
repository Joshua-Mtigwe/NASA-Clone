/**
 * Request and response types for /api/v1. Table-shaped data reuses the row types
 * generated from the CSV headers (src/types/tables.ts). Composite responses only
 * combine those rows; they never introduce new measurement columns.
 * See docs/FRONTEND_CONTRACT.md for the endpoint list.
 */
import type {
  AiInferenceLogsRow,
  AnalysisJobsRow,
  AssessmentAssignmentsRow,
  AssessmentContextRow,
  AssessmentProtocolsRow,
  AssessmentResultsRow,
  AssessmentScheduleTemplatesRow,
  AssessmentSessionsRow,
  AssessmentTrialsRow,
  AstronautQualificationsRow,
  AstronautsRow,
  AiTaskRecommendationsRow,
  CognitiveBaselinesRow,
  CognitiveComparisonsRow,
  CrewReadinessRow,
  DailyCognitiveResultsRow,
  DailyTaskSetsRow,
  DataLineageRow,
  DataSourcesRow,
  MissionTasksRow,
  MissionsRow,
  OptimizationRunsRow,
  PlanningEffectivenessRow,
  RecoveryActivitiesRow,
  RecoveryRecommendationsRow,
  ResearchAnalysesRow,
  ScheduleVersionsRow,
  SimulationEventsRow,
  SimulationRunsRow,
  SyncConflictsRow,
  SyncEventsRow,
  TaskAssignmentsRow,
  TaskDependenciesRow,
  TaskRequirementsRow,
} from '@/types/tables';

// ---------- common ----------

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PageQuery {
  limit?: number;
  offset?: number;
}

export interface TimeRangeQuery {
  /** ISO 8601, inclusive */
  from?: string;
  /** ISO 8601, inclusive */
  to?: string;
}

/** FastAPI error body. `detail` is a string or a list of validation errors. */
export interface ApiErrorBody {
  detail?: string | Array<{ loc?: Array<string | number>; msg?: string; type?: string }>;
}

// ---------- auth ----------

/**
 * role_name values from roles.csv, plus mission_control_admin. The administrator is
 * a backend-only role: it keeps its API permissions but has no dashboard (see
 * DashboardRole in src/app/roles.ts).
 */
export type Role =
  | 'astronaut'
  | 'mission_leader'
  | 'medical_researcher'
  | 'medical_officer'
  | 'mission_control_admin';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface SessionUser {
  user_id: string;
  username: string;
  role_id: string;
  role: Role;
  /** Set only for the astronaut role (astronauts.user_id -> astronaut_id). */
  astronaut_id: string | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'bearer';
  user: SessionUser;
}

export interface DemoAccount {
  username: string;
  role: Role;
  role_description: string;
  /** Set for astronaut accounts, so the role selector can ask which astronaut. */
  astronaut_id: string | null;
  astronaut_code: string | null;
  crew_role: string | null;
  specialization: string | null;
}

/**
 * Demonstration mode only: open a session for one seeded demo account without a
 * password. The backend must refuse this outside a demonstration deployment.
 */
export interface DemoSessionRequest {
  username: string;
}

// ---------- missions ----------

export interface MissionState {
  mission: MissionsRow;
  simulation_run: SimulationRunsRow | null;
  /** ISO timestamp of the current mission clock (simulation_runs.current_mission_time). */
  mission_time: string;
  mission_day: number;
  mission_length_days: number;
  /** simulation_runs.data_mode, for example "synthetic_demo". */
  data_mode: string;
  is_synthetic: boolean;
}

export interface DataIntegritySummary {
  lineage: DataLineageRow[];
  sources: DataSourcesRow[];
  sync_events: SyncEventsRow[];
  sync_conflicts: SyncConflictsRow[];
}

export interface AiStatus {
  /** null = the backend has not reported this yet. */
  model_loaded: boolean | null;
  last_response_ms: number | null;
  fallback_active: boolean | null;
  recent_inferences: AiInferenceLogsRow[];
}

// ---------- astronauts / health ----------

export interface AstronautProfile {
  astronaut: AstronautsRow;
  qualifications: AstronautQualificationsRow[];
}

export type HealthMeasure =
  | 'heart_rate'
  | 'hrv_rmssd'
  | 'spo2'
  | 'blood_pressure'
  | 'respiratory_rate'
  | 'body_temperature'
  | 'sleep_duration'
  | 'radiation_dose_rate'
  | 'physical_activity';

export type Provenance = 'measured' | 'estimated';

export interface HealthMeasurement {
  measure: HealthMeasure;
  /** null when no reading exists: the UI shows "No data". */
  value: number | null;
  unit: string | null;
  measured_at: string | null;
  /** sensor_id / source table row id */
  source_id: string | null;
  source_type: string | null;
  quality_status: string | null;
  provenance: Provenance | null;
  /** Source table the value came from, for example "sensor_readings". */
  source_table: string | null;
}

export interface HealthSummary {
  astronaut_id: string;
  as_of: string;
  measurements: HealthMeasurement[];
}

export type ScheduleItemKind = 'task' | 'recovery' | 'assessment' | 'exercise' | 'sleep';

export interface ScheduleItem {
  kind: ScheduleItemKind;
  /** Row id in the source table (task_assignment_id, schedule_id, assignment_id, ...). */
  ref_id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  priority: string | null;
  workload_category: string | null;
  completion_status: string | null;
  approval_status: string | null;
}

export interface AstronautSchedule {
  astronaut_id: string;
  date: string;
  items: ScheduleItem[];
}

export type AlertSeverity = 'review' | 'action';
export type AlertSyncState = 'stored_locally' | 'pending' | 'synced';

/** Rule-generated alert. Rules run in the backend (mock: src/mocks/compute). */
export interface Alert {
  alert_id: string;
  astronaut_id: string;
  rule_id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  source_table: string;
  source_id: string;
  triggered_at: string;
  sync_state: AlertSyncState;
}

/** reference_range_status values from cognitive_comparisons.csv, plus no_data. */
export type ReferenceRangeStatus = 'within_reference' | 'outside_reference' | 'no_data';

export interface ReadinessFactor {
  /** Measure key (heart_rate, sleep_duration, ...) or cognitive_domain. */
  factor: string;
  kind: 'physiological' | 'sleep' | 'cognitive';
  value: number | null;
  unit: string | null;
  measured_at: string | null;
  reference_lower: number | null;
  reference_upper: number | null;
  reference_range_status: ReferenceRangeStatus;
  source_table: string | null;
}

/** Daily readiness: which factors are within the personal reference. Never a percentage. */
export interface ReadinessSummary {
  astronaut_id: string;
  as_of: string;
  operational: CrewReadinessRow | null;
  factors: ReadinessFactor[];
}

/**
 * Personal physiological reference for one measure. Field names follow
 * cognitive_baselines.csv; reference_method follows metric_definitions.csv.
 */
export interface PhysiologicalReference {
  astronaut_id: string;
  measurement_type: string;
  metric_unit: string;
  median_value: number;
  mean_value: number;
  standard_deviation: number;
  reference_lower: number;
  reference_upper: number;
  sample_size: number;
  reference_method: string;
  baseline_version: string;
  calculated_at: string;
}

// ---------- vitals / radiation / sleep ----------

export interface VitalsHistoryQuery extends TimeRangeQuery, PageQuery {
  astronaut_id: string;
  measurement_type?: string;
}

export interface EnvironmentQuery extends TimeRangeQuery, PageQuery {
  measurement_type?: string;
}

export interface AstronautRangeQuery extends TimeRangeQuery {
  astronaut_id: string;
}

// ---------- assessments ----------

export interface DueAssessment {
  assignment: AssessmentAssignmentsRow;
  protocol: AssessmentProtocolsRow;
  /** Backend decision: the session may be started now. */
  authorized: boolean;
  /** Backend decision: assessment conditions (time window, preceding activity) are met. */
  conditions_met: boolean;
  blocking_reason: string | null;
  /** assessment_schedule_templates.mission_phase of the assignment's template. */
  mission_phase: string;
}

export interface StartSessionRequest {
  assignment_id: string;
  /** Defaults to the mission clock on the server. */
  started_at?: string;
}

export type TrialInput = Omit<AssessmentTrialsRow, 'trial_id' | 'session_id'>;

export type TrialPhase = 'practice' | 'test';
export type InputDevice = 'keyboard' | 'mouse' | 'touch' | 'pen';

/**
 * Trials are CSV-shaped. phase, input_device and test_version are request metadata
 * (proposed; no CSV column holds them). Practice trials are stored apart and never scored.
 */
export interface SubmitTrialsRequest {
  trials: TrialInput[];
  phase: TrialPhase;
  input_device: InputDevice | 'mixed' | null;
  test_version: string;
}

export interface SubmitTrialsResponse {
  accepted: number;
}

export interface CompleteSessionRequest {
  completed_at: string;
  /** Times the test was paused because the tab was hidden or focus was lost (proposed). */
  interruption_count?: number;
}

export interface SessionCompletion {
  session: AssessmentSessionsRow;
  /** Scores computed by the backend, one per metric. The UI never computes these. */
  results: AssessmentResultsRow[];
}

export interface SessionsQuery extends PageQuery {
  astronaut_id?: string;
  protocol_id?: string;
  mission_phase?: string;
}

/**
 * Subjective state check-in. sleep_quality_score is named after sleep_records.csv;
 * assessment_context.csv has no sleep-quality column (proposed addition).
 */
export type ContextInput = Omit<AssessmentContextRow, 'context_id'> & {
  sleep_quality_score?: number;
};

export interface MissionMindGameStatus {
  protocol_id: string;
  protocol_name: string;
  cognitive_domain: string;
  scheduled_today: boolean;
  completed_today: boolean;
  assignment_id: string | null;
  sessions_completed_total: number;
}

/** Daily Mission Mind hub. The backend computes the streak and the estimate. */
export interface MissionMindSummary {
  astronaut_id: string;
  date: string;
  estimate_seconds: number;
  sessions_scheduled_today: number;
  sessions_completed_today: number;
  streak_days: number;
  games: MissionMindGameStatus[];
  results_today: AssessmentResultsRow[];
}

/** collection_start / collection_end are proposed fields (no CSV column). */
export type ScheduleTemplateInput = Omit<AssessmentScheduleTemplatesRow, 'template_id'> & {
  collection_start?: string;
  collection_end?: string;
};

export interface AssignmentsQuery extends PageQuery {
  astronaut_id?: string;
  access_status?: string;
}

export interface CreateAssignmentsRequest {
  astronaut_ids: string[];
  template_id: string;
  scheduled_at: string;
}

export interface GrantAccessRequest {
  access_expires_at: string;
}

export interface AssessmentOversightRow {
  astronaut_id: string;
  sessions_total: number;
  sessions_completed: number;
  sessions_valid: number;
  flagged_for_review: number;
}

// ---------- cognition ----------

export interface CognitionQuery extends TimeRangeQuery {
  astronaut_id: string;
  cognitive_domain?: string;
}

export interface CognitiveComparisonView {
  comparison: CognitiveComparisonsRow;
  daily_result: DailyCognitiveResultsRow;
  baseline: CognitiveBaselinesRow | null;
}

/** Backend summary for the Cognitive Trends page. Every number here is computed server-side. */
export interface CognitionDomainSummary {
  cognitive_domain: string;
  metric_name: string;
  metric_unit: string;
  /** Median of the personal preflight baselines (all conditions). */
  preflight_reference_median: number | null;
  /** Median of inflight daily medians in the requested range. */
  inflight_median: number | null;
  preflight_sd: number | null;
  inflight_sd: number | null;
  n_preflight: number;
  n_inflight: number;
  within_reference: number;
  outside_reference: number;
  /** Raw values for the distribution plot. */
  preflight_values: number[];
  inflight_values: number[];
}

export interface CompletionDay {
  date: string;
  sessions_completed: number;
  sessions_expected: number;
}

export interface CognitionSummary {
  astronaut_id: string;
  from: string | null;
  to: string | null;
  domains: CognitionDomainSummary[];
  completion_by_day: CompletionDay[];
}

// ---------- planning ----------

/**
 * Task-form fields from the plan with no column in mission_tasks / task_requirements.
 * Proposed request fields; the backend decides how to store them.
 */
export interface ProposedTaskFields {
  working_memory_demand_score: number | null;
  procedural_complexity_score: number | null;
  equipment_and_location: string;
  scheduling_constraints: string;
  schedule_flexibility: 'fixed' | 'flexible';
}

export interface PlanningTask {
  task: MissionTasksRow;
  requirements: TaskRequirementsRow[];
  dependencies: TaskDependenciesRow[];
  proposed: ProposedTaskFields | null;
}

export interface PlanningTaskInput {
  task: MissionTaskInput;
  requirements: TaskRequirementsInput;
  depends_on_task_ids: string[];
  proposed: ProposedTaskFields;
}

/** Planner Overview totals, computed by the backend for one day. */
export interface PlannerOverview {
  date: string;
  mission_day: number;
  task_set_id: string | null;
  crew_members: number;
  tasks_submitted: number;
  pending_review: number;
  scheduled_minutes: number;
  schedule_version_id: string | null;
}

export interface TaskSetDetail {
  task_set: DailyTaskSetsRow;
  tasks: PlanningTask[];
}

export type MissionTaskInput = Omit<
  MissionTasksRow,
  'task_id' | 'created_by_user_id' | 'created_at'
>;

export type TaskRequirementsInput = Partial<
  Pick<
    TaskRequirementsRow,
    | 'required_specialization'
    | 'required_certification'
    | 'cognitive_demand_score'
    | 'physical_demand_score'
    | 'attention_demand_score'
    | 'time_pressure_score'
    | 'safety_classification'
    | 'review_status'
  >
>;

export type AssessmentCurrency = 'assessment_current' | 'review_pending' | 'no_current_assessment';

/** Operational view only. Contains no cognitive scores (mission leaders see this). */
export interface CrewOverviewRow {
  astronaut: AstronautsRow;
  readiness: CrewReadinessRow | null;
  qualifications: AstronautQualificationsRow[];
  assessment_status: AssessmentCurrency;
}

export interface OptimizeRequest {
  task_set_id: string;
}

export type PipelineStage =
  'task_interpretation' | 'constraint_checks' | 'optimisation' | 'explanation';

export interface OptimizationRunDetail {
  run: OptimizationRunsRow;
  stages: Array<{ stage: PipelineStage; status: 'pending' | 'running' | 'completed' | 'failed' }>;
  schedule_version_id: string | null;
}

export type ScheduleIssueKind = 'conflict' | 'missing_qualification' | 'unassigned';

export interface ScheduleIssue {
  kind: ScheduleIssueKind;
  task_id: string;
  astronaut_id: string | null;
  reason: string;
}

export interface DutyRow {
  astronaut_id: string;
  scheduled_minutes: number;
  workload_limit_minutes: number | null;
  over_limit: boolean;
}

export interface ScheduleDetail {
  version: ScheduleVersionsRow;
  assignments: TaskAssignmentsRow[];
  recommendations: AiTaskRecommendationsRow[];
  issues: ScheduleIssue[];
  /** Scheduled task minutes against crew_readiness.workload_limit_minutes. */
  duty: DutyRow[];
  /** Tasks whose safety_classification is not standard: never auto-applied. */
  safety_critical_task_ids: string[];
}

export interface ApproveScheduleRequest {
  /** Every safety-critical task id must be confirmed explicitly. */
  confirmed_safety_critical: string[];
}

export interface ScheduleOverrideRequest {
  task_assignment_id: string;
  astronaut_id?: string;
  planned_start?: string;
  planned_end?: string;
  /** Required. */
  reason: string;
}

// ---------- recovery ----------

export interface RecoveryRecommendRequest {
  astronaut_id: string;
  mission_day: number;
}

/**
 * Publication state of a supportive-routine recommendation (no medical-review step):
 * recommended -> ready_to_publish (checks pass for the proposed time) -> published,
 * or unable_to_schedule (a check failed; see `reasons` and `conflicts`).
 */
export type RoutinePublicationState =
  'recommended' | 'ready_to_publish' | 'published' | 'unable_to_schedule';

export interface PublishRoutineRequest {
  /**
   * ISO start time; the end follows from the routine's recommended duration. Omit to
   * use the slot the backend proposed with the recommendation.
   */
  scheduled_start?: string;
  /** true = run every check and report, but write nothing. */
  dry_run?: boolean;
}

export interface RoutineConflict {
  kind: ScheduleItemKind;
  title: string;
  start_time: string;
  end_time: string | null;
}

export interface RoutinePublication {
  recommendation: RecoveryRecommendationsRow;
  activity: RecoveryActivitiesRow;
  state: RoutinePublicationState;
  scheduled_start: string;
  scheduled_end: string;
  duration_minutes: number;
  conflicts: RoutineConflict[];
  /** Why the routine cannot be scheduled. Empty when it can. */
  reasons: string[];
  /** daily_schedules / scheduled_recovery rows, once published. */
  schedule_id: string | null;
  scheduled_recovery_id: string | null;
  /** True when this call found it already published and changed nothing. */
  already_published: boolean;
}

/** A routine the Mission Planning Leader has published to an astronaut's schedule. */
export interface PublishedRoutine {
  schedule_id: string;
  scheduled_recovery_id: string | null;
  recommendation_id: string;
  astronaut_id: string;
  scheduled_start: string;
  scheduled_end: string;
  completion_status: string;
  activity: RecoveryActivitiesRow | null;
  published_by_user_id: string | null;
}

// ---------- research ----------

export interface ResearchOverview {
  participants: number;
  /** Pseudonymised participant ids (P01...). Research views never show astronaut ids. */
  participant_ids: string[];
  assessment_sessions: number;
  mission_days: number;
  sessions_by_quality: Record<string, number>;
}

export interface ResearchVariable {
  /** CSV column name, for example "total_sleep_minutes". */
  variable: string;
  source_table: string;
  unit: string | null;
  provenance: Provenance;
  cognitive_domain: string | null;
}

export type CreateAnalysisRequest = Pick<
  ResearchAnalysesRow,
  | 'analysis_type'
  | 'research_question'
  | 'independent_variable'
  | 'dependent_variable'
  | 'analysis_method'
  | 'date_range_start'
  | 'date_range_end'
> & {
  // Filters use CSV column names.
  astronaut_id?: string[];
  mission_phase?: string;
  cognitive_domain?: string;
  quality_status?: string;
};

export interface AnalysisStatus {
  analysis: ResearchAnalysesRow;
  job: AnalysisJobsRow | null;
}

export interface AnalysisChartPoint {
  x: number | string;
  y: number;
  /** Pseudonymised participant id (P01...), or null for crew-level points. */
  astronaut_id: string | null;
  /** Series within a chart, e.g. preflight / inflight for paired bars. */
  group?: string;
}

export type AnalysisQuestionType =
  | 'longitudinal'
  | 'scatter'
  | 'lagged_comparison'
  | 'domain_heatmap'
  | 'paired_preflight_inflight'
  | 'individual_trajectories';

export type AnalysisView = 'within_person' | 'pooled';

export interface AnalysisChart {
  chart_id: string;
  chart_type: 'scatter' | 'line' | 'bar' | 'heatmap';
  title: string;
  x: { variable: string; unit: string | null };
  y: { variable: string; unit: string | null };
  points: AnalysisChartPoint[];
  sample_size: number;
  effect_estimate: number | null;
  confidence_interval_lower: number | null;
  confidence_interval_upper: number | null;
  missing: { n_missing: number; n_total: number };
  view: 'within_person' | 'pooled';
}

export interface PlanningComparison {
  from: string;
  to: string;
  operational: {
    workload_heatmap: Array<{ astronaut_id: string; date: string; scheduled_minutes: number }>;
    workload_by_category: Array<{
      astronaut_id: string;
      task_category: string;
      scheduled_minutes: number;
    }>;
    schedule_adherence: Array<{ date: string; scheduled_tasks: number; completed_tasks: number }>;
    comparisons: PlanningEffectivenessRow[];
  };
  /** null for mission leaders: they receive the operational section only. */
  health_hypotheses: {
    domain_trends: Array<{
      cognitive_domain: string;
      metric_unit: string;
      points: Array<{
        date: string;
        crew_inflight_median: number;
        preflight_reference_median: number | null;
      }>;
    }>;
    comparisons: PlanningEffectivenessRow[];
  } | null;
}

// ---------- realtime ----------

/** Messages on WS /api/v1/ws. */
export type RealtimeMessage =
  | { type: 'mission_state'; payload: MissionState }
  | { type: 'simulation_tick'; payload: MissionState }
  | { type: 'alert'; payload: { astronaut_id: string } }
  | { type: 'event_triggered'; payload: SimulationEventsRow };

// ---------- simulation ----------

export interface CreateSimulationRunRequest {
  run_name: string;
  speed_multiplier: number;
}

export interface UpdateSimulationRunRequest {
  speed_multiplier: number;
}
