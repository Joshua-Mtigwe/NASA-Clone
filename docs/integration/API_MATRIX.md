# API compatibility matrix

Frontend request and response definitions: `src/api/types.ts` and `src/api/*.ts`. Original backend schemas: `backend-openapi.json`. Live adapters use `/api/v1/console`; legacy APIs retain their contracts.

| Feature key | Method | Frontend path | Legacy path match | Required adaptation |
|---|---|---|---|---|
| auth.login | POST | `/auth/login` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| auth.logout | POST | `/auth/logout` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| auth.me | GET | `/auth/me` | `/api/v1/auth/me` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| auth.demoAccounts | GET | `/auth/demo-accounts` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| auth.demoSession | POST | `/auth/demo-session` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| missions.currentState | GET | `/missions/current/state` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| missions.dataIntegrity | GET | `/missions/current/data-integrity` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| missions.auditLog | GET | `/missions/current/audit-log` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| missions.aiStatus | GET | `/missions/current/ai-status` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| astronauts.list | GET | `/astronauts` | `/api/v1/astronauts` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| astronauts.get | GET | `/astronauts/:astronautId` | `/api/v1/astronauts/{astronaut_id}` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| astronauts.healthSummary | GET | `/astronauts/:astronautId/health/summary` | `/api/v1/astronauts/{astronaut_id}/health/summary` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| astronauts.schedule | GET | `/astronauts/:astronautId/schedule` | `/api/v1/astronauts/{astronaut_id}/schedule` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| astronauts.baselines | GET | `/astronauts/:astronautId/baselines` | `/api/v1/astronauts/{astronaut_id}/baselines` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| astronauts.readiness | GET | `/astronauts/:astronautId/readiness` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| astronauts.readinessSummary | GET | `/astronauts/:astronautId/readiness/summary` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| astronauts.alerts | GET | `/astronauts/:astronautId/alerts` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| vitals.history | GET | `/vitals/history` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| vitals.reference | GET | `/vitals/reference` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| vitals.environment | GET | `/vitals/environment` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| vitals.activity | GET | `/vitals/activity` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| vitals.sensors | GET | `/vitals/sensors` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| radiation.readings | GET | `/radiation` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| radiation.organDose | GET | `/radiation/organ-dose` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| radiation.reference | GET | `/radiation/reference` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| sleep.records | GET | `/sleep` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.protocols | GET | `/assessments/protocols` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.metricDefinitions | GET | `/assessments/metric-definitions` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.due | GET | `/assessments/due` | `/api/v1/assessments/due` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.listSessions | GET | `/assessments/sessions` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.startSession | POST | `/assessments/sessions` | `/api/v1/assessments/sessions` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.submitTrials | POST | `/assessments/sessions/:sessionId/trials` | `/api/v1/assessments/sessions/{session_id}/trials` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.listTrials | GET | `/assessments/sessions/:sessionId/trials` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.completeSession | POST | `/assessments/sessions/:sessionId/complete` | `/api/v1/assessments/sessions/{session_id}/complete` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.sessionResults | GET | `/assessments/sessions/:sessionId/results` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.submitContext | POST | `/assessments/context` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.listTemplates | GET | `/assessments/schedule-templates` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.createTemplate | POST | `/assessments/schedule-templates` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.listAssignments | GET | `/assessments/assignments` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.createAssignments | POST | `/assessments/assignments` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.grantAccess | POST | `/assessments/assignments/:assignmentId/grant` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.revokeAccess | POST | `/assessments/assignments/:assignmentId/revoke` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.oversight | GET | `/assessments/oversight` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.flagged | GET | `/assessments/flagged` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| assessments.missionMindSummary | GET | `/assessments/mission-mind/summary` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| cognition.dailyResults | GET | `/cognition/daily-results` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| cognition.comparisons | GET | `/cognition/comparisons` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| cognition.summary | GET | `/cognition/summary` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.overview | GET | `/planning/overview` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.listTaskSets | GET | `/planning/task-sets` | `/api/v1/planning/task-sets` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.getTaskSet | GET | `/planning/task-sets/:taskSetId` | `/api/v1/planning/task-sets/{task_set_id}` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.createTask | POST | `/planning/tasks` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.updateTask | PATCH | `/planning/tasks/:taskId` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.updateRequirements | PUT | `/planning/tasks/:taskId/requirements` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.crewOverview | GET | `/planning/crew-overview` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.optimize | POST | `/planning/optimize` | `/api/v1/planning/optimize` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.optimizeStatus | GET | `/planning/optimize/:runId` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.listSchedules | GET | `/planning/schedules` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.getSchedule | GET | `/planning/schedules/:scheduleVersionId` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.overrideSchedule | POST | `/planning/schedules/:scheduleVersionId/overrides` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.approveSchedule | POST | `/planning/schedules/:scheduleVersionId/approve` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| planning.recoveryCatalogue | GET | `/planning/recovery/catalogue` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| recovery.recommend | POST | `/recovery/recommend` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| recovery.recommendations | GET | `/recovery/recommendations` | `/api/v1/recovery/recommendations` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| recovery.scheduled | GET | `/recovery/scheduled` | `/api/v1/recovery/scheduled` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| recovery.publish | POST | `/recovery/recommendations/:recommendationId/publish` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| recovery.published | GET | `/recovery/published` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| research.overview | GET | `/research/overview` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| research.variables | GET | `/research/variables` | `/api/v1/research/variables` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| research.listAnalyses | GET | `/research/analyses` | `/api/v1/research/analyses` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| research.createAnalysis | POST | `/research/analyses` | `/api/v1/research/analyses` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| research.getAnalysis | GET | `/research/analyses/:analysisId` | `/api/v1/research/analyses/{analysis_id}` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| research.analysisResults | GET | `/research/analyses/:analysisId/results` | `/api/v1/research/analyses/{analysis_id}/results` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| research.analysisCharts | GET | `/research/analyses/:analysisId/charts` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| research.analysisReport | GET | `/research/analyses/:analysisId/report` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| research.planningComparison | GET | `/research/planning-comparison` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| simulation.listRuns | GET | `/simulation/runs` | `/api/v1/simulation/runs` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| simulation.createRun | POST | `/simulation/runs` | `/api/v1/simulation/runs` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| simulation.updateRun | PATCH | `/simulation/runs/:runId` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| simulation.startRun | POST | `/simulation/runs/:runId/start` | `/api/v1/simulation/runs/{run_id}/start` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| simulation.pauseRun | POST | `/simulation/runs/:runId/pause` | `/api/v1/simulation/runs/{run_id}/pause` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| simulation.selectRun | POST | `/simulation/runs/:runId/select` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| simulation.listEvents | GET | `/simulation/events` | `/api/v1/simulation/events` | Console adapter; persona header; request/response types in `src/api/types.ts` |
| simulation.triggerEvent | POST | `/simulation/events/:eventId/trigger` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| simulation.demoStory | POST | `/simulation/demo-story` | No direct match | Console adapter; persona header; request/response types in `src/api/types.ts` |
| mindChat.status | GET | `/mind-chat/status` | No direct match | Separate genuine inference service |
| mindChat.listConversations | GET | `/mind-chat/conversations` | No direct match | Separate genuine inference service |
| mindChat.createConversation | POST | `/mind-chat/conversations` | No direct match | Separate genuine inference service |
| mindChat.getConversation | GET | `/mind-chat/conversations/:conversationId` | No direct match | Separate genuine inference service |
| mindChat.deleteConversation | DELETE | `/mind-chat/conversations/:conversationId` | No direct match | Separate genuine inference service |
| mindChat.sendMessage | POST | `/mind-chat/conversations/:conversationId/messages` | No direct match | Separate genuine inference service |

## Resolved shape differences

| Family | Request / response fields | Existing service mapping and integration change |
|---|---|---|
| Demo identity | `{username}` → `{access_token, token_type, user:{user_id,username,role_id,role,astronaut_id}}` | `auth_service.get_persona`; demo handle is `mock-token.USER_ID`; client also sends `X-AEGIS-User`. No password form. Token mode refuses demo session endpoints. |
| Mission | `GET` → `{mission,simulation_run,mission_time,mission_day,mission_length_days,data_mode,is_synthetic}` | `mission_simulator.get_simulation_state` originally returns a flat run. Console supplies the mission envelope; matching WebSocket sends `{type,payload}`. |
| Health | selected astronaut → `{astronaut_id,as_of,measurements:[{measure,value,unit,measured_at,source_id,source_type,quality_status,provenance,source_table}]}` | Legacy health summary has separate `vitals/radiation/last_sleep/recent_workload`. Console serializes stored rows, preserving missing values, source units, timestamps and astronaut access. |
| Histories / body map | `astronaut_id,from,to,measurement_type,limit,offset` → row arrays or `{items,total,limit,offset}` | Legacy endpoints are astronaut-scoped and use `start/end`. Console supplies the raw row contracts used by the existing charts/body-map region associations. Measurement end is capped to mission time. |
| Readiness | selected astronaut → `{operational,factors:[{factor,kind,value,unit,measured_at,reference_lower,reference_upper,reference_range_status,source_table}]}` | Current sleep/vitals/cognitive comparisons and personal baseline bounds; expired operational records excluded. Existing frontend deterministic scoring formula is unchanged. |
| Due assessments | `astronaut_id` → `[{assignment,protocol,authorized,conditions_met,blocking_reason,mission_phase}]` | Legacy service returns `{due:[assignments]}`. Console expands catalogue metadata, evaluates windows, and refuses unsupported protocols. |
| Assessment writes | start `{assignment_id}`; trials `{trials,phase,input_device,test_version}`; complete `{completed_at,interruption_count}` → session, `{accepted}`, `{session,results}` | Existing ownership/window/trial validation and score calculation retained. Practice is stored separately. Trial retry compares recorded payloads; completion is idempotent. Survey context is validated and bound to the active astronaut's session. Metadata is persisted separately. |
| Medical programmes | template fields + collection window; assignment `{astronaut_ids,template_id,scheduled_at}`; grant `{access_expires_at}` | Added validated programme/assignment persistence, collection-window validation, and Medical Officer-only grants/revocations/oversight. Future access windows remain future windows. |
| Cognition | `astronaut_id,from,to,cognitive_domain` → daily rows, joined `{comparison,daily_result,baseline}` views, domain summary/completion statistics | Legacy daily/comparison endpoints return different envelopes. Console joins by IDs, filters to cutoff/run, and calculates statistics server-side. Missing extended-test baselines remain missing. |
| Planning tasks | `{task,requirements,depends_on_task_ids,proposed}` → `{task,requirements,dependencies,proposed}` | Existing task tables and dependency-cycle validator; proposed form fields have a dedicated runtime table. Task edits cannot change an approved plan. |
| Optimisation | `{task_set_id}` → optimisation row; status `{run,stages,schedule_version_id}` | Existing constraint solver is authoritative. Legacy `complete/partial` solver outcomes map to a completed UI pipeline with preserved `solver_status`. Infeasible runs are failed, not fabricated schedules. |
| Schedule approval | `{confirmed_safety_critical}` → version | Requires explicit safety-critical confirmation, revalidates through `schedule_service`, approves then publishes persisted records. Astronaut timetable reads those same assignments. Repeating approval does not republish. |
| Override | `{task_assignment_id,astronaut_id?,planned_start?,planned_end?,reason}` | Draft-only; backend validates ownership of assignment, date/duration, conflicts, dependencies, qualifications and duty limits, and audits reason. Failed validation rolls back. |
| Supportive routines | publish `{scheduled_start?,dry_run?}` → `{recommendation,activity,state,scheduled_start,scheduled_end,duration_minutes,conflicts,reasons,schedule_id,scheduled_recovery_id,already_published}` | New leader publication workflow for approved non-clinical catalogue activities. Promotes existing draft rows atomically, checks protected sleep/activities/assessments/tasks, and uses recommendation identity for duplicate prevention. Original medically reviewed recovery APIs remain intact. |
| Research | analysis request → completed/failed persisted job; `{analysis,job}`; numerical chart array and report row | Existing numerical services calculate results. Six chart formats preserve the job cutoff and participant filters. Participant IDs are pseudonyms in charts/reports. Unsupported phase/quality filters fail explicitly. Template reports identify their source. |
| Checked AI | `POST /api/v1/ai/task-assignments/:id/explain` and `POST /api/v1/ai/reports` | Direct original backend services, bypass console namespace. Genuine checked model text reports source `gemma`; unavailable/rejected generations report explicit `rules/template` source. |
| Mind Companion | separate `/api/v1/mind-chat/*`, bearer demo handle | Existing Node service persists astronaut-separated conversations and talks to configured Ollama/OpenAI-compatible inference. No mock handler or generated-answer fallback. |

## Errors and retained infrastructure

The client normalizes FastAPI `detail` validation responses and the original backend's `{error,message,details}` errors. Network and model failures remain visible. There is no live-to-mock fallback.

The removed administrator dashboard's simulation/admin/audit/sync endpoint keys remain in the frontend registry for compatibility, but are not used by the four dashboards. Native backend routes remain authoritative. The console uses the default mission run; the old `simulation.selectRun` UI contract has no live console equivalent. Legacy `auth.login` is not offered through the demo adapter. Astronaut Alerts is intentionally absent from the UI and has no console implementation.

The compatibility router is intentionally excluded from generated OpenAPI's catch-all declaration to avoid pretending its dispatch path has one homogeneous schema. This matrix, `CONTRACT.md`, the TypeScript types, and integration tests specify its concrete contracts. `backend-openapi.json` captures the original backend schema inspected before adapters were added.
