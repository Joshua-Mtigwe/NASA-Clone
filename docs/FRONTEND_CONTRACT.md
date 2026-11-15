# AEGIS frontend contract

> Live integration is implemented. See [the integrated contract](integration/CONTRACT.md) and [compatibility matrix](integration/API_MATRIX.md) for the current API adapters, passwordless four-role UI, and tested backend behavior. The Phase 9 proposal below is retained as historical frontend design context; removed administrator/login interfaces are not restored.

Status: **Phase 9** (all phases built; verified against the mock only, see "Live mode"). Derived from `docs/BUILD_PLAN.md` and the headers of the 49 CSVs in `data/csv/`. No blueprint documents were present in `docs/blueprints/` and there is no `docs/openapi.json`, so this is the frontend's proposal for the backend contract. It will be reconciled against the real FastAPI service in Phase 9.

Sources of truth in code:

| What | File |
|---|---|
| Endpoint list (method + path) | `src/api/endpoints.ts` (`ENDPOINTS`) |
| Request/response types | `src/api/types.ts` |
| Row types (one per CSV, generated) | `src/types/tables.ts` |
| Mock implementation | `src/mocks/handlers.ts`, calculations stubbed in `src/mocks/compute/` |

A test (`src/mocks/handlers.test.ts`) fails if any endpoint in `ENDPOINTS` has no mock handler.

## Conventions

- Prefix: every path below is under `/api/v1`.
- Auth: `Authorization: Bearer <access_token>` from `POST /auth/login`. Every endpoint needs a token unless it is marked **public**.
- Errors use the FastAPI shape `{"detail": "message"}` or `{"detail": [{"loc": [...], "msg": "...", "type": "..."}]}`. The client turns every error into an `ApiError` with a `kind`: `network` (status 0), `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409), `validation` (400/422), `server` (5xx).
- 401 signs the user out. 403 shows an "Access restricted" state and never offers a retry.
- Timestamps are ISO 8601 UTC strings. `from` and `to` query parameters are inclusive.
- `Page<T>` = `{ items: T[], total, limit, offset }`. It takes `limit` and `offset` query parameters (default 500, maximum 5000, unless stated otherwise).
- Row names and fields are exactly the CSV headers (for example `SensorReadingsRow` is `sensor_readings.csv`). Composite responses only nest those rows. The few derived DTOs (marked *derived*) are built only from CSV columns.
- Astronaut scoping: when the caller is an astronaut, any `astronautId` path parameter or `astronaut_id` query must be their own. Otherwise the response is 403.
- Mock mode: the demo password for every seeded account is `demo`.
- Mock mode: `VITE_MOCK_MISSION_DAY` (set to 25 in `.env.development`) places the mock mission clock at 12:00 UTC on that day. Without it the clock is the one in simulation_runs.csv (day 1, paused). The UI bounds every time-series query with `to = mission_time`.

### Roles

Roles are the `role_name` values from `roles.csv`, plus one the plan requires that the CSVs do not contain:

| Role | roles.csv | Demo user (users.csv) |
|---|---|---|
| `astronaut` | ROLE-1 | crew1 to crew5 (AST-001 to AST-005) |
| `mission_leader` | ROLE-2 | mission_leader (USR-006) |
| `medical_researcher` | ROLE-3 | researcher (USR-007) |
| `medical_officer` | ROLE-4 | medical_officer (USR-008) |
| `mission_control_admin` | **missing**; mock-only seed `ROLE-MOCK-5` | **missing**; mock-only seed `mission_control` (USR-MOCK-ADMIN), see Open questions |

Role groups used below:

- **CREW_DATA** = astronaut (self only), medical_officer, medical_researcher
- **PLANNERS** = mission_leader, mission_control_admin
- **ADMIN** = mission_control_admin

Mission leaders are never served detailed cognitive scores or medical records. They get `planning/crew-overview`, which carries operational readiness status only.

---

## Routes

Page routes for the React app. Every page uses `DataState` for loading, empty, error and no-data states.

| Route | Page | Roles | Phase | Endpoints |
|---|---|---|---|---|
| `/login` | Login + demo account cards (mock) | public | 1 | `auth.login`, `auth.demoAccounts` |
| `/403` | Access restricted | any | 1 | none |
| `/` | Redirect to the role's home | any | 1 | `auth.me` |
| **Astronaut** | | | | |
| `/astronaut` | Overview (measurement cards, readiness summary, cognitive snapshot) | astronaut | 2 | `astronauts.healthSummary`, `astronauts.readinessSummary`, `cognition.comparisons` |
| `/astronaut/health` | Health Monitoring | astronaut | 2 | `vitals.history`, `vitals.reference`, `radiation.readings`, `sleep.records`, `vitals.activity` |
| `/astronaut/body-map` | Interactive body map (3D lazy, 2D fallback) | astronaut | 3 | `astronauts.healthSummary`, `radiation.organDose`, `radiation.readings`, `vitals.activity`, `vitals.sensors`, `cognition.comparisons` |
| `/astronaut/mission-mind` | Mission Mind daily hub (status, estimate, per-game progress, domain summary, streak) | astronaut | 4B | `assessments.missionMindSummary`, `assessments.due` |
| `/astronaut/preflight` | Preflight sessions with access gating and condition tags (linked from Mission Mind, not in the menu) | astronaut | 4A | `assessments.due` |
| `/astronaut/preflight/:assignmentId` | Assessment session (standard theme) | astronaut | 4A | `assessments.startSession`, `assessments.submitTrials`, `assessments.completeSession`, `assessments.submitContext` |
| `/astronaut/mission-mind/:assignmentId` | Assessment session (Mission Mind theme, PixiJS) | astronaut | 4B | same as above |
| `/astronaut/baseline` | Baseline profile: reference by domain and condition, n, SD, version | astronaut | 4B | `astronauts.baselines` |
| `/astronaut/cognitive-trends` | Cognitive Trends | astronaut | 5 | `cognition.comparisons`, `cognition.dailyResults`, `assessments.listSessions` |
| `/astronaut/schedule` | My Schedule | astronaut | 2, 6 | `astronauts.schedule` |
| `/astronaut/recovery` | Recovery and Sleep | astronaut | 2 | `recovery.scheduled`, `planning.recoveryCatalogue`, `sleep.records` |
| `/astronaut/alerts` | Alerts | astronaut | 2 | `astronauts.alerts` |
| **Mission Planning Leader** | | | | |
| `/planner` | Planner Overview | mission_leader | 6 | `planning.crewOverview`, `planning.listTaskSets` |
| `/planner/tasks` | Task Pool | mission_leader | 6 | `planning.listTaskSets`, `planning.getTaskSet`, `planning.createTask`, `planning.updateTask`, `planning.updateRequirements` |
| `/planner/schedule` | Crew Schedule | mission_leader | 6 | `planning.optimize`, `planning.optimizeStatus`, `planning.listSchedules`, `planning.getSchedule`, `planning.overrideSchedule`, `planning.approveSchedule` |
| `/planner/recovery` | Recovery Planning | mission_leader | 6 | `planning.recoveryCatalogue`, `recovery.recommend` |
| `/planner/effectiveness` | Planning Effectiveness (operational section only) | mission_leader | 7 | `research.planningComparison` |
| **Medical Researcher** | | | | |
| `/research` | Research Overview | medical_researcher | 7 | `research.overview` |
| `/research/analyses` | Analyses list + builder | medical_researcher | 7 | `research.variables`, `research.listAnalyses`, `research.createAnalysis` |
| `/research/analyses/:analysisId` | Analysis result + report | medical_researcher | 7 | `research.getAnalysis`, `research.analysisCharts`, `research.analysisResults`, `research.analysisReport` |
| `/research/cognition` | Cognition Comparison | medical_researcher | 5, 7 | `cognition.comparisons`, `cognition.dailyResults` |
| `/research/effectiveness` | Planning Effectiveness | medical_researcher | 7 | `research.planningComparison` |
| `/research/reports` | Reports | medical_researcher | 7 | `research.listAnalyses`, `research.analysisReport` |
| **Medical Officer** | | | | |
| `/medical` | Oversight | medical_officer | 8 | `assessments.oversight`, `assessments.flagged` |
| `/medical/programmes` | Assessment Programmes (protocol builder) | medical_officer | 8 | `assessments.listTemplates`, `assessments.createTemplate`, `assessments.protocols`, `assessments.createAssignments` |
| `/medical/access` | Access Grants | medical_officer | 8 | `assessments.listAssignments`, `assessments.grantAccess`, `assessments.revokeAccess` |
| `/medical/assessments` | Crew Assessments | medical_officer | 8 | `assessments.listSessions`, `assessments.sessionResults`, `assessments.flagged` |
| **Mission Control Administrator** | | | | |
| `/control` | Mission State | mission_control_admin | 8 | `missions.currentState` |
| `/control/simulation` | Simulation | mission_control_admin | 8 | `simulation.*` runs endpoints |
| `/control/events` | Events | mission_control_admin | 8 | `simulation.listEvents`, `simulation.triggerEvent` |
| `/control/integrity` | Data Integrity | mission_control_admin | 8 | `missions.dataIntegrity` |
| `/control/ai` | AI Status | mission_control_admin | 8 | `missions.aiStatus` |
| `/control/audit` | Audit | mission_control_admin | 8 | `missions.auditLog` |

---

## Endpoints

Columns: **Key** (in `ENDPOINTS`), method and path, allowed roles, request (query or body), response, and the CSV tables that feed it.

### auth

| Key | Method & path | Roles | Request | Response | CSV tables |
|---|---|---|---|---|---|
| `auth.login` | `POST /auth/login` | public | body `LoginRequest {username, password}` | `LoginResponse {access_token, token_type, user: SessionUser}` | users, roles, astronauts |
| `auth.logout` | `POST /auth/logout` | any | none | 204 | none |
| `auth.me` | `GET /auth/me` | any | none | `SessionUser {user_id, username, role_id, role, astronaut_id}` | users, roles, astronauts |
| `auth.demoAccounts` | `GET /auth/demo-accounts` | public (mock only) | none | `DemoAccount[] {username, role, role_description}` | users, roles |

### missions

| Key | Method & path | Roles | Request | Response | CSV tables |
|---|---|---|---|---|---|
| `missions.currentState` | `GET /missions/current/state` | public | none | `MissionState {mission, simulation_run, mission_time, mission_day, mission_length_days, data_mode, is_synthetic}` | missions, simulation_runs |
| `missions.dataIntegrity` | `GET /missions/current/data-integrity` | ADMIN | none | `DataIntegritySummary {lineage, sources, sync_events, sync_conflicts}` | data_lineage, data_sources, sync_events, sync_conflicts |
| `missions.auditLog` | `GET /missions/current/audit-log` | ADMIN | `limit, offset` (default 100) | `Page<AuditLogsRow>` | audit_logs |
| `missions.aiStatus` | `GET /missions/current/ai-status` | ADMIN | none | `AiStatus {model_loaded, last_response_ms, fallback_active, recent_inferences}`, all `null` until something is logged | ai_inference_logs |

### astronauts

| Key | Method & path | Roles | Request | Response | CSV tables |
|---|---|---|---|---|---|
| `astronauts.list` | `GET /astronauts` | any | none | `AstronautsRow[]` | astronauts |
| `astronauts.get` | `GET /astronauts/{astronautId}` | any (astronaut: self) | none | `AstronautProfile {astronaut, qualifications}` | astronauts, astronaut_qualifications |
| `astronauts.healthSummary` | `GET /astronauts/{astronautId}/health/summary` | CREW_DATA | none | `HealthSummary {astronaut_id, as_of, measurements: HealthMeasurement[]}` *derived*: latest value per measure at the mission clock, with unit, time, source, quality and `provenance` (`measured`/`estimated`); `value: null` = No data | sensor_readings, sleep_records, radiation_readings, activity_records |
| `astronauts.schedule` | `GET /astronauts/{astronautId}/schedule` | any (astronaut: self) | `date` (YYYY-MM-DD, default mission day) | `AstronautSchedule {astronaut_id, date, items: ScheduleItem[]}` *derived*: kind, ref_id, title, start/end, duration, priority, workload_category, completion_status, approval_status | daily_schedules, scheduled_recovery, recovery_activities, task_assignments, mission_tasks, task_requirements, activity_records, assessment_assignments, assessment_protocols, sleep_records |
| `astronauts.baselines` | `GET /astronauts/{astronautId}/baselines` | CREW_DATA | none | `CognitiveBaselinesRow[]` | cognitive_baselines |
| `astronauts.readiness` | `GET /astronauts/{astronautId}/readiness` | any (astronaut: self) | none | `CrewReadinessRow[]`, newest first | crew_readiness |
| `astronauts.alerts` | `GET /astronauts/{astronautId}/alerts` | CREW_DATA | none | `Alert[]` *derived*: rule-generated, `severity` review/action, `sync_state` | cognitive_comparisons, daily_cognitive_results |
| `astronauts.readinessSummary` | `GET /astronauts/{astronautId}/readiness/summary` | CREW_DATA | none | `ReadinessSummary {astronaut_id, as_of, operational: CrewReadinessRow, factors: ReadinessFactor[]}` *derived*: each factor carries value, unit, reference_lower/upper and `reference_range_status` (within_reference / outside_reference / no_data). No percentage or combined score. | sensor_readings, sleep_records, cognitive_comparisons, cognitive_baselines, daily_cognitive_results, crew_readiness |

### vitals

| Key | Method & path | Roles | Request | Response | CSV tables |
|---|---|---|---|---|---|
| `vitals.history` | `GET /vitals/history` | CREW_DATA | `astronaut_id` (required), `measurement_type`, `from`, `to`, `limit`, `offset` | `Page<SensorReadingsRow>` | sensor_readings |
| `vitals.reference` | `GET /vitals/reference` | CREW_DATA | `astronaut_id`, `measurement_type` (sensor type or `sleep_duration`), both required | `PhysiologicalReference` (fields named as in cognitive_baselines: median_value, mean_value, standard_deviation, reference_lower, reference_upper, sample_size, baseline_version, calculated_at; plus reference_method); 404 when none yet. Mock stub: mean ± 2 SD of the first 7 mission days observed so far | sensor_readings, sleep_records |
| `vitals.environment` | `GET /vitals/environment` | any | `measurement_type`, `from`, `to`, `limit`, `offset` | `Page<EnvironmentReadingsRow>` | environment_readings |
| `vitals.activity` | `GET /vitals/activity` | CREW_DATA | `astronaut_id` (required), `from`, `to` | `ActivityRecordsRow[]` | activity_records |
| `vitals.sensors` | `GET /vitals/sensors` | any | none | `SensorsRow[]` | sensors |

### radiation

Dose rate, accumulated dose and modelled organ dose are separate variables and are never combined.

| Key | Method & path | Roles | Request | Response | CSV tables |
|---|---|---|---|---|---|
| `radiation.readings` | `GET /radiation` | CREW_DATA | `astronaut_id` (required), `from`, `to` | `RadiationReadingsRow[]` (personal dosimetry: `dose_rate`, `accumulated_dose`) | radiation_readings |
| `radiation.organDose` | `GET /radiation/organ-dose` | CREW_DATA | `astronaut_id` (required), `from`, `to` | `OrganDoseEstimatesRow[]` (a **modelled estimate**) | organ_dose_estimates |
| `radiation.reference` | `GET /radiation/reference` | any | `from`, `to` | `RadiationReadingsRow[]` where `astronaut_id` is null (NASA MSL RAD reference detector) | radiation_readings, sensors |

### sleep

| Key | Method & path | Roles | Request | Response | CSV tables |
|---|---|---|---|---|---|
| `sleep.records` | `GET /sleep` | CREW_DATA | `astronaut_id` (required), `from`, `to` | `SleepRecordsRow[]` | sleep_records |

### assessments

The UI displays the scores the backend returns. It never computes them.

| Key | Method & path | Roles | Request | Response | CSV tables |
|---|---|---|---|---|---|
| `assessments.protocols` | `GET /assessments/protocols` | any | none | `AssessmentProtocolsRow[]` | assessment_protocols |
| `assessments.metricDefinitions` | `GET /assessments/metric-definitions` | any | none | `MetricDefinitionsRow[]` | metric_definitions |
| `assessments.due` | `GET /assessments/due` | astronaut (self), medical_officer | `astronaut_id` | `DueAssessment[] {assignment, protocol, authorized, conditions_met, blocking_reason, mission_phase}`: Start is enabled only when `authorized && conditions_met`; `mission_phase` comes from the assignment's template. Mock: also creates today's demo assignments (see Open question 12) | assessment_assignments, assessment_protocols, assessment_schedule_templates, activity_records, task_assignments |
| `assessments.listSessions` | `GET /assessments/sessions` | CREW_DATA | `astronaut_id`, `protocol_id`, `mission_phase`, `limit`, `offset` (default 200) | `Page<AssessmentSessionsRow>` | assessment_sessions |
| `assessments.startSession` | `POST /assessments/sessions` | astronaut (own assignment), medical_officer | body `StartSessionRequest {assignment_id, started_at}` | 201 `AssessmentSessionsRow` (`session_status: in_progress`); 403 if not authorised | assessment_assignments, assessment_sessions |
| `assessments.submitTrials` | `POST /assessments/sessions/{sessionId}/trials` | astronaut, medical_officer | body `{trials: TrialInput[], phase, input_device, test_version}` where phase is `practice` or `test`. TrialInput = `AssessmentTrialsRow` minus ids. `phase`, `input_device`, `test_version` are **proposed request metadata** (no CSV column). Practice trials are stored apart and never scored | 201 `{accepted}`; 409 if complete | assessment_trials |
| `assessments.listTrials` | `GET /assessments/sessions/{sessionId}/trials` | CREW_DATA | `limit`, `offset` | `Page<AssessmentTrialsRow>` | assessment_trials |
| `assessments.completeSession` | `POST /assessments/sessions/{sessionId}/complete` | astronaut, medical_officer | body `{completed_at, interruption_count?}` (`interruption_count` proposed) | `SessionCompletion {session, results: AssessmentResultsRow[]}`: one score per metric, never an overall grade. Mock quality_status: valid / valid_with_interruptions / insufficient_data | assessment_sessions, assessment_trials, assessment_results, assessment_context |
| `assessments.sessionResults` | `GET /assessments/sessions/{sessionId}/results` | CREW_DATA | none | `AssessmentResultsRow[]` | assessment_results |
| `assessments.submitContext` | `POST /assessments/context` | astronaut (self), medical_officer | body `ContextInput` (= `AssessmentContextRow` minus `context_id`, plus proposed `sleep_quality_score` named after sleep_records) | 201 `AssessmentContextRow` | assessment_context |
| `assessments.listTemplates` | `GET /assessments/schedule-templates` | medical_officer, medical_researcher, astronaut | none | `AssessmentScheduleTemplatesRow[]` (assessment programmes) | assessment_schedule_templates |
| `assessments.createTemplate` | `POST /assessments/schedule-templates` | medical_officer | body `ScheduleTemplateInput` (`protocol_ids` pipe-separated) | 201 `AssessmentScheduleTemplatesRow` | assessment_schedule_templates |
| `assessments.listAssignments` | `GET /assessments/assignments` | astronaut (self), medical_officer | `astronaut_id`, `access_status`, `limit`, `offset` | `Page<AssessmentAssignmentsRow>` | assessment_assignments |
| `assessments.createAssignments` | `POST /assessments/assignments` | medical_officer | body `{astronaut_ids, template_id, scheduled_at}` | 201 `AssessmentAssignmentsRow[]` (`access_status: scheduled`) | assessment_assignments, assessment_schedule_templates, audit_logs |
| `assessments.grantAccess` | `POST /assessments/assignments/{assignmentId}/grant` | medical_officer | body `{access_expires_at}` | `AssessmentAssignmentsRow` (`access_status: authorized`) | assessment_assignments, audit_logs |
| `assessments.revokeAccess` | `POST /assessments/assignments/{assignmentId}/revoke` | medical_officer | none | `AssessmentAssignmentsRow` (`access_status: revoked`) | assessment_assignments, audit_logs |
| `assessments.oversight` | `GET /assessments/oversight` | medical_officer | none | `AssessmentOversightRow[]` *derived*: completion, quality and flagged counts per astronaut | astronauts, assessment_sessions, cognitive_comparisons |
| `assessments.flagged` | `GET /assessments/flagged` | medical_officer, medical_researcher | `astronaut_id` | `CognitiveComparisonsRow[]` with `reference_range_status = outside_reference` ("flagged for contextual review") | cognitive_comparisons |
| `assessments.missionMindSummary` | `GET /assessments/mission-mind/summary` | astronaut (self), medical_officer | `astronaut_id` (required) | `MissionMindSummary {date, estimate_seconds, sessions_scheduled_today, sessions_completed_today, streak_days, games: MissionMindGameStatus[], results_today: AssessmentResultsRow[]}`. The backend computes the streak and the estimate | assessment_assignments, assessment_sessions, assessment_results, assessment_protocols |

### cognition

| Key | Method & path | Roles | Request | Response | CSV tables |
|---|---|---|---|---|---|
| `cognition.dailyResults` | `GET /cognition/daily-results` | CREW_DATA | `astronaut_id` (required), `cognitive_domain`, `from`, `to` (assessment_date) | `DailyCognitiveResultsRow[]` | daily_cognitive_results |
| `cognition.comparisons` | `GET /cognition/comparisons` | CREW_DATA | `astronaut_id` (required), `cognitive_domain`, `from`, `to` | `CognitiveComparisonView[] {comparison, daily_result, baseline}` (baseline supplies `reference_lower`/`reference_upper`, matched by `assessment_condition`) | cognitive_comparisons, daily_cognitive_results, cognitive_baselines |
| `cognition.summary` | `GET /cognition/summary` | CREW_DATA | `astronaut_id` (required), `from`, `to` | `CognitionSummary {domains: CognitionDomainSummary[] (preflight_reference_median, inflight_median, preflight_sd, inflight_sd, n_preflight, n_inflight, within/outside counts, raw preflight_values and inflight_values), completion_by_day: {date, sessions_completed, sessions_expected}[]}`, capped at the mission clock | daily_cognitive_results, cognitive_baselines, cognitive_comparisons, assessment_sessions, assessment_results |

### planning

| Key | Method & path | Roles | Request | Response | CSV tables |
|---|---|---|---|---|---|
| `planning.listTaskSets` | `GET /planning/task-sets` | PLANNERS | `mission_day` | `DailyTaskSetsRow[]` | daily_task_sets |
| `planning.overview` | `GET /planning/overview` | PLANNERS | `date` | `PlannerOverview {date, mission_day, task_set_id, crew_members, tasks_submitted, pending_review, scheduled_minutes, schedule_version_id}` | daily_task_sets, mission_tasks, task_requirements, task_assignments, astronauts |
| `planning.getTaskSet` | `GET /planning/task-sets/{taskSetId}` | PLANNERS | none | `TaskSetDetail {task_set, tasks: PlanningTask[] {task, requirements, dependencies}}` | daily_task_sets, mission_tasks, task_requirements, task_dependencies |
| `planning.createTask` | `POST /planning/tasks` | mission_leader | body `MissionTaskInput` (= `MissionTasksRow` minus `task_id`, `created_by_user_id`, `created_at`) | 201 `PlanningTask` | mission_tasks |
| `planning.updateTask` | `PATCH /planning/tasks/{taskId}` | mission_leader | body `Partial<MissionTaskInput>` | `PlanningTask` | mission_tasks |
| `planning.updateRequirements` | `PUT /planning/tasks/{taskId}/requirements` | mission_leader | body `TaskRequirementsInput` (demand scores 0 to 5, certification, safety_classification, review_status) | `TaskRequirementsRow` | task_requirements |
| `planning.crewOverview` | `GET /planning/crew-overview` | PLANNERS, medical_officer | none | `CrewOverviewRow[] {astronaut, readiness, qualifications, assessment_status}`: `assessment_current` / `review_pending` / `no_current_assessment`. **No cognitive scores.** | astronauts, crew_readiness, astronaut_qualifications, cognitive_comparisons |
| `planning.optimize` | `POST /planning/optimize` | mission_leader | body `{task_set_id}` | 202 `OptimizationRunsRow` | optimization_runs, schedule_versions, task_assignments, mission_tasks |
| `planning.optimizeStatus` | `GET /planning/optimize/{runId}` | PLANNERS | none | `OptimizationRunDetail {run, stages[task_interpretation, constraint_checks, optimisation, explanation], schedule_version_id}` | optimization_runs, schedule_versions |
| `planning.listSchedules` | `GET /planning/schedules` | PLANNERS | `task_set_id` | `ScheduleVersionsRow[]` | schedule_versions |
| `planning.getSchedule` | `GET /planning/schedules/{scheduleVersionId}` | PLANNERS | none | `ScheduleDetail {version, assignments, recommendations, issues: ScheduleIssue[] (conflict / missing_qualification / unassigned, with reason)}` | schedule_versions, task_assignments, ai_task_recommendations, task_requirements, astronaut_qualifications, mission_tasks |
| `planning.overrideSchedule` | `POST /planning/schedules/{scheduleVersionId}/overrides` | mission_leader | body `{task_assignment_id, astronaut_id?, planned_start?, planned_end?, reason}` (`reason` required, 422 if missing) | `TaskAssignmentsRow`; 409 if approved | task_assignments, audit_logs |
| `planning.approveSchedule` | `POST /planning/schedules/{scheduleVersionId}/approve` | mission_leader | none | `ScheduleVersionsRow` (`status: approved`). Until this call the UI labels everything "Draft, not approved" | schedule_versions, task_assignments, audit_logs |
| `planning.recoveryCatalogue` | `GET /planning/recovery/catalogue` | PLANNERS, medical_officer, astronaut | none | `RecoveryActivitiesRow[]` (supportive routines) | recovery_activities |

### recovery

| Key | Method & path | Roles | Request | Response | CSV tables |
|---|---|---|---|---|---|
| `recovery.recommend` | `POST /recovery/recommend` | mission_leader, medical_officer | body `{astronaut_id, mission_day}` | `RecoveryRecommendationsRow[]`, ranked | recovery_recommendations |
| `recovery.recommendations` | `GET /recovery/recommendations` | any (astronaut: self) | `astronaut_id` (required), `mission_day` | `RecoveryRecommendationsRow[]` | recovery_recommendations |
| `recovery.scheduled` | `GET /recovery/scheduled` | any (astronaut: self) | `astronaut_id` (required), `from`, `to` | `ScheduledRecoveryRow[]` | scheduled_recovery |

### research

Every statistic carries a sample size and uncertainty. Associations are exploratory, never causal.

| Key | Method & path | Roles | Request | Response | CSV tables |
|---|---|---|---|---|---|
| `research.overview` | `GET /research/overview` | medical_researcher | none | `ResearchOverview {participants, assessment_sessions, mission_days, sessions_by_quality}` | astronauts, assessment_sessions, daily_cognitive_results |
| `research.variables` | `GET /research/variables` | medical_researcher | none | `ResearchVariable[] {variable (CSV column), source_table, unit, provenance, cognitive_domain}` | metric_definitions and the source tables |
| `research.listAnalyses` | `GET /research/analyses` | medical_researcher | none | `ResearchAnalysesRow[]` | research_analyses |
| `research.createAnalysis` | `POST /research/analyses` | medical_researcher | body `CreateAnalysisRequest`: research_analyses fields + filters `astronaut_id[]`, `mission_phase`, `cognitive_domain`, `quality_status` | 202 `AnalysisJobsRow` (`status: queued`) | research_analyses, analysis_jobs |
| `research.getAnalysis` | `GET /research/analyses/{analysisId}` | medical_researcher | none | `AnalysisStatus {analysis, job}`; poll until `job.status = completed` | research_analyses, analysis_jobs |
| `research.analysisResults` | `GET /research/analyses/{analysisId}/results` | medical_researcher | none | `AnalysisResultsRow[]` (sample_size, effect_estimate, CI, p_value) | analysis_results |
| `research.analysisCharts` | `GET /research/analyses/{analysisId}/charts` | medical_researcher | none | `AnalysisChart[]` *derived*: points, sample_size, effect estimate, CI, missing-data summary, `view` (within_person default / pooled); `[]` until the job completes | analysis_results + the variables' source tables |
| `research.analysisReport` | `GET /research/analyses/{analysisId}/report` | medical_researcher | none | `ResearchReportsRow`; 404 until drafted. UI label: "AI-drafted from computed results" | research_reports |
| `research.planningComparison` | `GET /research/planning-comparison` | medical_researcher, mission_leader | none | `PlanningComparison {operational, health_hypotheses}`; mission leaders get `health_hypotheses: []` | planning_effectiveness |

### simulation

| Key | Method & path | Roles | Request | Response | CSV tables |
|---|---|---|---|---|---|
| `simulation.listRuns` | `GET /simulation/runs` | ADMIN, mission_leader | none | `SimulationRunsRow[]` | simulation_runs |
| `simulation.createRun` | `POST /simulation/runs` | ADMIN | body `{run_name, speed_multiplier}` | 201 `SimulationRunsRow` | simulation_runs |
| `simulation.updateRun` | `PATCH /simulation/runs/{runId}` | ADMIN | body `{speed_multiplier}` (playback speed) | `SimulationRunsRow` | simulation_runs |
| `simulation.startRun` | `POST /simulation/runs/{runId}/start` | ADMIN | none | `SimulationRunsRow` | simulation_runs |
| `simulation.pauseRun` | `POST /simulation/runs/{runId}/pause` | ADMIN | none | `SimulationRunsRow` | simulation_runs |
| `simulation.selectRun` | `POST /simulation/runs/{runId}/select` | ADMIN | none | `MissionState` | simulation_runs, missions |
| `simulation.listEvents` | `GET /simulation/events` | ADMIN, mission_leader | `simulation_run_id`, `mission_day` | `SimulationEventsRow[]` | simulation_events |
| `simulation.triggerEvent` | `POST /simulation/events/{eventId}/trigger` | ADMIN | none | `SimulationEventsRow` (copy at the current mission time) | simulation_events, audit_logs |
| `simulation.demoStory` | `POST /simulation/demo-story` | ADMIN | none | `MissionState`. Resets to the presentation state (day 25 12:00 UTC, paused, all session writes discarded) | all |

### Realtime

`WS /api/v1/ws` (live: `?token=<access_token>`). Messages are JSON `RealtimeMessage`: `{type: "mission_state" | "simulation_tick", payload: MissionState}`, `{type: "alert", payload: {astronaut_id}}`, `{type: "event_triggered", payload: SimulationEventsRow}`. The mock sends `mission_state` on connect, a `simulation_tick` every 2 s while a run is running, and broadcasts after run control and event triggers. The client reconnects with exponential backoff (1 s doubling to 15 s). After 4 failures it polls `missions.currentState` every 5 s, and stops polling once a socket opens again.

---

## CSV table coverage

All 49 tables, with the endpoints that read them. Tables with 0 rows are runtime tables: their headers are present and the backend fills them.

| Table | Rows | Endpoints |
|---|---|---|
| activity_records | 450 | vitals.activity, astronauts.healthSummary, astronauts.schedule |
| ai_inference_logs | 0 | missions.aiStatus |
| ai_task_recommendations | 630 | planning.getSchedule |
| analysis_jobs | 0 | research.createAnalysis, research.getAnalysis |
| analysis_results | 0 | research.analysisResults |
| assessment_assignments | 2920 | assessments.due, listAssignments, createAssignments, grantAccess, revokeAccess, astronauts.schedule |
| assessment_context | 730 | assessments.submitContext, completeSession |
| assessment_protocols | 5 | assessments.protocols, due |
| assessment_results | 2920 | assessments.sessionResults, completeSession |
| assessment_schedule_templates | 3 | assessments.listTemplates, createTemplate, createAssignments |
| assessment_sessions | 2920 | assessments.listSessions, startSession, completeSession, oversight, research.overview |
| assessment_trials | 43800 | assessments.submitTrials, listTrials |
| astronaut_qualifications | 5 | astronauts.get, planning.crewOverview, planning.getSchedule |
| astronauts | 5 | astronauts.list, astronauts.get, auth.* |
| audit_logs | 0 | missions.auditLog (written by overrides, approvals, grants, triggers) |
| cognitive_baselines | 40 | astronauts.baselines, cognition.comparisons |
| cognitive_comparisons | 1800 | cognition.comparisons, assessments.flagged, oversight, astronauts.alerts |
| crew_readiness | 450 | astronauts.readiness, planning.crewOverview |
| daily_cognitive_results | 1800 | cognition.dailyResults, cognition.comparisons |
| daily_schedules | 450 | astronauts.schedule |
| daily_task_sets | 90 | planning.listTaskSets, getTaskSet |
| data_lineage | 49 | missions.dataIntegrity |
| data_sources | 17 | missions.dataIntegrity |
| environment_readings | 8640 | vitals.environment |
| metric_definitions | 4 | assessments.metricDefinitions, research.variables |
| mission_tasks | 630 | planning.getTaskSet, createTask, updateTask, astronauts.schedule |
| missions | 1 | missions.currentState |
| optimization_runs | 0 | planning.optimize, optimizeStatus |
| organ_dose_estimates | 450 | radiation.organDose |
| planning_effectiveness | 0 | research.planningComparison |
| radiation_readings | 526 | radiation.readings, radiation.reference, astronauts.healthSummary |
| recovery_activities | 6 | planning.recoveryCatalogue, astronauts.schedule |
| recovery_recommendations | 450 | recovery.recommend, recovery.recommendations |
| research_analyses | 3 | research.listAnalyses, createAnalysis, getAnalysis |
| research_reports | 0 | research.analysisReport |
| roles | 4 | auth.* |
| schedule_versions | 1 | planning.listSchedules, getSchedule, approveSchedule |
| scheduled_recovery | 450 | recovery.scheduled, astronauts.schedule |
| sensor_readings | 54000 | vitals.history, astronauts.healthSummary |
| sensors | 12 | vitals.sensors |
| simulation_events | 97 | simulation.listEvents, triggerEvent |
| simulation_runs | 1 | missions.currentState, simulation.* |
| sleep_records | 450 | sleep.records, astronauts.healthSummary, astronauts.schedule |
| sync_conflicts | 0 | missions.dataIntegrity |
| sync_events | 0 | missions.dataIntegrity |
| task_assignments | 630 | planning.getSchedule, overrideSchedule, approveSchedule, astronauts.schedule |
| task_dependencies | 540 | planning.getTaskSet |
| task_requirements | 630 | planning.getTaskSet, updateRequirements |
| users | 8 | auth.* |

---

## Open questions and data gaps

These are things the plan asks for that the CSV headers cannot supply. Per Global rule 3 the frontend does not invent columns for them; the UI will show "No data" or omit the field until the backend adds them.

1. **Mission Control Administrator** has no row in `roles.csv` and no user in `users.csv`. Since Phase 1, mock mode appends a clearly labelled seed (`src/mocks/seeds.ts`: role `ROLE-MOCK-5`, user `mission_control`) so the fifth demo account works. The CSVs are unchanged. The backend must provide this role; remove the seed once the CSVs include it.
2. **Blood pressure:** `sensors.csv` has no blood pressure sensor, so `health.summary` always returns `blood_pressure` with `value: null` (No data).
3. **Meals and breaks** in My Schedule have no source table; only tasks, recovery, exercise, assessments and sleep are scheduled.
4. **Trial input device, test version and practice flag** have no column in `assessment_trials.csv`. Since Phase 4 they travel as request metadata on `submitTrials` (`phase`, `input_device`, `test_version`) and `interruption_count` on `completeSession`. The backend must decide where to store them.
5. **Missing tests:** Symbol-Digit Matching, Mental Rotation and Logical Reasoning had no `assessment_protocols` rows. Mock mode adds labelled seeds (SYMBOL, ROTATION, REASONING in `src/mocks/seeds.ts`). Their domains (processing_speed, spatial_reasoning, reasoning) and SWITCH's (cognitive_flexibility) are assumptions, since no results exist for them.
6. **Task form fields** in Phase 6 with no column in `mission_tasks`/`task_requirements`: physical workload (`physical_demand_score` is the closest), equipment, location, scheduling constraints and fixed/flexible. Demand profile items "working memory" and "procedural complexity" have no columns; the CSV has `cognitive_demand_score`, `physical_demand_score`, `attention_demand_score` and `time_pressure_score`.
7. **Duty limits:** only `crew_readiness.workload_limit_minutes` exists.
8. **AI explanation text (Gemma):** the closest column is `ai_task_recommendations.recommendation_reason`.
9. **Pseudonymisation** for researchers: `astronaut_code` currently equals `astronaut_id`, so there is nothing separate to show.
10. **Physiological reference:** no table holds preflight vitals or a vitals baseline. `vitals.reference` is the proposed backend endpoint; the mock stub uses the first 7 mission days. The backend must define the real method.
11. **Sleep protection windows:** no table provides them. Recovery and Sleep shows an empty state.
12. **Demo assignments:** every assignment in `assessment_assignments.csv` is already completed. The mock scheduler (`src/mocks/compute/scheduler.ts`) creates, for the current mission day, a preflight battery (all 8 protocols, varied condition tags, REASONING awaiting access) and the daily Mission Mind set (2 rotating games plus the check-in) from two mock-only templates. Condition rules (time windows; after work = an activity or task ended today; weekly extended = every 7th day) are mock stand-ins for the backend.
13. **Condition vocabulary:** the CSV uses `morning` and `evening`. The plan adds afternoon, night, before/after physical work, before/after mental work and weekly extended; the frontend uses snake_case values for them (e.g. `after_physical_work`).
14. **Sleep quality** in the check-in has no `assessment_context` column (see submitContext).

## Changes in Phases 5 to 9 (request and response shapes)

- `planning.createTask` / `planning.updateTask` body is now `PlanningTaskInput {task, requirements, depends_on_task_ids, proposed}`. `proposed` (`ProposedTaskFields`: working_memory_demand_score, procedural_complexity_score, equipment_and_location, scheduling_constraints, schedule_flexibility) holds plan fields with no CSV column. `PlanningTask` responses include `proposed`.
- `planning.getSchedule` response adds `duty: DutyRow[]` (scheduled minutes against `crew_readiness.workload_limit_minutes`) and `safety_critical_task_ids`.
- `planning.approveSchedule` body `{confirmed_safety_critical: string[]}`: 409 unless every safety-critical task is confirmed. Safety-critical assignments are never auto-applied.
- `planning.optimize` runs asynchronously: `optimizeStatus` advances through the four pipeline stages. Each completed run creates a new alternative version. Mock: one stage per poll, and the alternative rotates crew assignments.
- Schedule versions are per day: the first `listSchedules?task_set_id=` creates "Version 1 (preloaded draft)" from `SV-DEMO-001`. `astronauts.schedule` shows the latest approved version for the day, else the preloaded draft.
- `research.overview` adds `participant_ids` (pseudonyms P01 to P05). Research charts use pseudonyms only, and `createAnalysis` accepts them in `astronaut_id`.
- `research.createAnalysis` `analysis_type` is one of longitudinal, scatter, lagged_comparison, domain_heatmap, paired_preflight_inflight, individual_trajectories. `analysisCharts` takes `view=within_person` (default; values centred on each participant) or `pooled`. A draft report (`research_reports`) is created when the job completes; the mock uses a template, not a model.
- `research.planningComparison` now returns `{from, to, operational: {workload_heatmap, workload_by_category, schedule_adherence, comparisons}, health_hypotheses: {domain_trends, comparisons} | null}`; `health_hypotheses` is null for mission leaders.
- `assessments.createTemplate` accepts proposed `collection_start` / `collection_end` (no column; the mock records them in `description`). `assessments.oversight` and `assessments.flagged` are capped at the mission clock.
- Offline queue kinds: trials, complete, context (check-in), override. All are sent in order; a network error keeps items queued, and any other error marks the item failed and holds back its group.
- Mock mode: the simulation clock advances while a run is running (real elapsed time x speed_multiplier). Start, pause, speed change and run selection commit the clock.

## Live mode

No FastAPI backend was available during the build, so the Phase 9 live contract pass has **not** been performed. Live mode is wired (`npm run dev:live`, `.env.live`), live builds drop all mock code, and the service worker registers only in live builds. Every endpoint above has been exercised only against the MSW mock. Expect to reconcile names and shapes here when the backend is connected.
