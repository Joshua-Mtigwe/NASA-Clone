# AEGIS Backend — Phases 1–6

Python + SQLite + FastAPI backend for the AEGIS crew health-aware mission planning prototype,
following the Revised Backend Engineering Plan:
* **Phase 1 (Foundation):** the 49-file importer, database schema, login and roles, and isolated simulation runs.
* **Phase 2 (Health):** vitals, radiation, sleep, activity, cabin environment, and the admin crew health-changes view.
* **Phase 3 (Cognition):** taking the cognitive tests, scoring, preflight baselines, and in-flight comparisons.
* **Phase 4 (Planning):** eligibility, the daily task scheduler, and versioned schedule approval.
* **Phase 5 (Research):** saved analyses, analysis jobs, statistics, chart data, reviewed reports, and planning effectiveness.
* **Phase 6 (AI):** a Gemma model running on this machine explains task assignments and recovery suggestions and drafts research reports.

All crew data is synthetic demo data. The seed also contains clearly labelled NASA *reference*
records (Curiosity RAD readings and DONKI 2024 space-weather events) that belong to no astronaut.

## Setup in VS Code (Windows)

Open the `aegis_backend` folder in VS Code, then in its terminal (PowerShell):

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

(macOS/Linux: `source .venv/bin/activate`.) In VS Code pick the `.venv` interpreter
(Ctrl+Shift+P → *Python: Select Interpreter*).

## Run

```powershell
python scripts/validate_seed_data.py      # optional: check the 49 CSVs, writes nothing
python scripts/import_csvs.py --reset     # build aegis.db from data/seed
python scripts/set_demo_passwords.py      # give the 8 demo users passwords
uvicorn app.main:app --reload             # start the API
pytest                                    # run the tests
```

* API docs: http://127.0.0.1:8000/docs. Click **Authorize** after logging in, or call
  `POST /api/v1/auth/login` and send `Authorization: Bearer <access_token>`.
* `set_demo_passwords.py` writes the generated passwords to `demo_credentials.local.txt`
  (git-ignored). Use `--user crew1` to choose one yourself.
* The seed users have the placeholder `DEMO_ACCOUNT_NO_PASSWORD`, which can never log in.

## What Phase 1 delivers

| Plan item | Where | Acceptance check (plan §8) |
|---|---|---|
| 49-file importer | `app/services/data_import_service.py` | Import twice → no duplicates ✔ |
| DB schema | `app/database/schema.sql` | Valid foreign keys ✔ (`PRAGMA foreign_key_check` = 0) |
| Auth | `app/services/auth_service.py` | Roles enforced on every route ✔ |
| Simulation run | `app/services/mission_simulator.py` | Independent run state ✔ |

### Importer
Before writing anything it checks:
* all 49 files are present (extra files such as `missions_1.csv` are ignored with a warning),
* each header matches its table,
* primary keys are present and unique, and numbers parse,
* every foreign key resolves,
* units match the sensor catalogue and `metric_definitions`, Gy is never attached to an astronaut, and crew dose is in Sv,
* timestamps parse and no end comes before its start,
* each file's row count and SHA-256 match `data_lineage.csv`, and every cited source exists in `data_sources.csv`.

If any check fails, nothing is written and the import is recorded as `refused`. Rows whose primary
key already exists are skipped, never overwritten, so re-importing keeps runtime changes such as
password hashes. Every attempt is stored in `import_runs` with its full report.

### Auth
* PBKDF2-SHA256 password hashes.
* Random bearer tokens; only their SHA-256 is stored, so logout revokes a token at once.
* Every login attempt, successful or not, is written to `audit_logs`.
* Who can do what is set in `app/core/permissions.py`:
  * an astronaut sees only their own data,
  * the mission leader, researcher and medical officer see the whole crew,
  * only the mission leader controls simulations.

### Simulation runs
* Each run has its own clock, speed, status and copy of the 78 scenario events.
* Starting, pausing, changing speed or jumping one run never touches another.
* Every control action is written to `audit_logs`.
* The live clock is available over WebSocket at `/api/v1/ws/simulation/{run_id}?token=...`.

## Endpoints (prefix `/api/v1`)

| Method | Path | Who |
|---|---|---|
| POST | `/auth/login`, `/auth/logout`, `/auth/change-password` · GET `/auth/me` | anyone / signed in |
| GET | `/missions`, `/missions/{id}` | signed in |
| GET | `/astronauts`, `/astronauts/{id}` | filtered to permitted astronauts |
| GET | `/simulation/runs`, `/simulation/runs/{id}`, `/simulation/events` | signed in |
| POST | `/simulation/runs`, `/runs/{id}/start`, `/runs/{id}/pause`, `/runs/{id}/jump` · PUT `/runs/{id}/speed` | mission leader |
| GET | `/admin/import-status`, `/admin/import-runs/latest`, `/admin/data-sources`, `/admin/data-lineage`, `/admin/audit-logs` | mission leader, medical officer |
| POST | `/admin/import` | mission leader |
| WS | `/ws/simulation/{run_id}?token=` | signed in |

## Project layout

```
app/
  core/        config, security (hashing, tokens), permissions, errors
  database/    schema.sql (49 seed tables + 9 runtime tables), session.py
  services/    data_import_service, auth_service, mission_simulator, audit_service,
               health_context, physiology_service, radiation_service, environment_service,
               sleep_activity_service, health_changes_service,
               assessment_service, cognitive_scoring, baseline_service, cognitive_comparison_service,
               task_service, crew_readiness_service, scheduling_optimizer, schedule_service,
               research_service, research_report_service, planning_effectiveness_service,
               recovery_service, task_execution_service, account_service,
               gemma_client, ai_service
  api/         auth, missions, simulation, health, environment, assessments, planning, recovery, research, ai, admin, websocket routes
  schemas/     Pydantic request/response models
  utils/       timestamps, units, statistics
scripts/       import_csvs, validate_seed_data, set_demo_passwords
data/seed/     the 49 CSVs (keep unchanged; checksums are verified)
tests/         unit, integration, api
```

Services never import FastAPI. Scripts, tests and later phases (OR-Tools jobs, Gemma services)
can call them directly.

## Choices that differ from the plan, and why

* **schema.sql instead of Alembic for now.** One readable file creates every table and is safe to re-run. Add Alembic when the schema starts changing on deployed databases.
* **The importer uses `csv` + `sqlite3` rather than `pandas.to_sql`.** It needs per-row validation, exact types and skip-if-exists behaviour. pandas is still in `requirements.txt` for the statistics phases.
* **Three runtime tables are added: `import_runs`, `auth_sessions` and `simulation_run_clock`.** They hold state the CSVs have no column for, so the 49 seed tables stay identical to the source files.
* **Opaque tokens rather than JWT.** They can be revoked instantly and need no extra library.

## Data notes the importer reports (warnings, not errors)

1. **76 radiation readings are in µGy/h.** These are NASA Mars-rover reference data with no astronaut, so keep them out of crew dose totals.
2. **Fatigue direction.** The seed now marks MET-003 `fatigue_score` as `lower_is_better`, so this warning no longer fires on the shipped data. The importer still warns if any fatigue metric is marked `higher_is_better`.

## Phase 2 (Health)

The Astronaut Health dashboard, cabin environment, and an admin view of how each astronaut's
health has changed.

### What "now" means
Health views use **mission time**. By default "now" is the current time of the `RUN-DEMO-001`
simulation, so jumping that run to day 46 moves every dashboard to 15 April 2027. You can override it:
* `?simulation_run_id=RUN-…` follows a different run;
* `?at=2027-04-15T09:30:00Z` uses a fixed time.

Windows default to the days just before "now"; set `start` and `end` to choose your own.

### Services
| Module | What it does |
|---|---|
| `physiology_service` | Current vitals, history (hourly or daily), stats, rolling average, trend, body map, and a sensor data-quality check |
| `radiation_service` | Crew dose (µSv/h, mSv), cumulative exposure, illustrative organ doses, and a research series. NASA Gy data stays in a separate block, and mixing units raises an error. |
| `environment_service` | Cabin CO₂, temperature, humidity and pressure: current, history, averages, and scenario-day comparisons |
| `sleep_activity_service` | Sleep history and consistency, activity and workload, the day's schedule, and the sleep before an assessment |
| `health_changes_service` | Each astronaut's recent days compared with their own first mission week |

### How the health-changes view works
For each of 16 metrics:
* **Vitals:** heart rate, HRV, SpO₂, temperature, breathing rate.
* **Sleep:** duration, efficiency, quality, awakenings.
* **Activity:** exercise heart rate, workload, exertion.
* **Radiation:** dose rate.
* **Self-report:** fatigue, sleepiness, workload.

It compares the average of the last 7 days with the astronaut's average over the first 7 mission days, and reports:
* the change and percent change;
* **z**: the change measured in that person's own first-week standard deviations;
* a label: `notable` (|z| ≥ 2), `mild` (|z| ≥ 1) or `within_usual_variation`.

During the first week the status is `reference_period`. Both window lengths are adjustable
(`reference_days`, `recent_days`).

This is a statistical comparison of each person with themselves, not a clinical threshold or diagnosis.
The API returns this disclaimer with every result.

Example from the seed data: on 15 April, AST-002 has 9 notable changes (higher heart rate, lower HRV,
worse sleep quality, more fatigue), while the other four astronauts show only mild changes.

### Phase 2 endpoints (prefix `/api/v1`)
| Method | Path | Who |
|---|---|---|
| GET | `/astronauts/{id}/health/summary` (vitals, radiation, last sleep, workload, changes) | that astronaut, or staff |
| GET | `/astronauts/{id}/vitals/current`, `/vitals/history`, `/vitals/stats`, `/vitals/rolling`, `/vitals/trend` | that astronaut, or staff |
| GET | `/astronauts/{id}/body-map`, `/radiation`, `/radiation/organ-doses` | that astronaut, or staff |
| GET | `/astronauts/{id}/sleep`, `/sleep/pre-assessment`, `/activity`, `/schedule`, `/health/changes` | that astronaut, or staff |
| GET | `/environment/current`, `/environment/history`, `/environment/averages`, `/environment/events` | signed in |
| GET | `/research/radiation-series` | mission leader, researcher, medical officer |
| GET | **`/admin/crew-health/changes`**: every astronaut's changes, most changed first, filterable by `category` and `only_changes`. Each view is audited. | mission leader, medical officer |
| GET | `/admin/sensor-quality`: missing hours, invalid, duplicate or impossible readings | mission leader, medical officer |

"Staff" means the mission leader, researcher and medical officer, as set in `app/core/permissions.py`
(`CREW_WIDE_ROLES`, `HEALTH_ADMIN_ROLES`).

### Phase 2 acceptance (plan §8: "stable historical data and consistent units")
* **Stable history:** the same request returns the same result, with 24 hourly readings for every day.
* **Consistent units:** every reading's unit matches its sensor. Crew radiation is always Sv. NASA µGy/h data is only returned in its own `nasa_reference` block, and any mix raises an error.
* **Tests:** 45 new tests in `tests/integration/test_health.py` and `tests/api/test_health_api.py`.

## Phase 3 (Cognition)

The Preflight Assessment and Mission Mind dashboards: astronauts take short cognitive tests,
the backend scores them, and each in-flight day is compared with that person's own preflight normal.

### The tests
| Test | Measures | Score | Better |
|---|---|---|---|
| PVT (Signal Response) | Alertness | Median reaction time (ms), false starts < 100 ms excluded | Lower |
| NBACK (Working Memory) | Working memory | % correct | Higher |
| STROOP (System Scanner) | Attention | % correct | Higher |
| SURVEY (Fatigue & Workload) | How tired you feel | Fatigue 1–9 (no trials) | Lower |

SWITCH is in the catalogue but has no metric definition or scorer yet, so starting one is refused.

### Taking a test
1. **Generate:** the mission leader or medical officer generates assignments for a simulation run with
   `POST /assessments/assignments/generate`. They come from `TPL-FLIGHT`, with source `system_template`
   and no human assigner; the person who triggered it is in the audit log. Running it again skips existing slots.
2. **Move the clock:** each test is open for 1 hour from 08:00 mission time. Jump the run there with
   `POST /simulation/runs/{id}/jump {"mission_day": 5, "hour": 8}`.
3. **Take it:** the astronaut calls:
   * `GET /assessments/due` to see what's open;
   * `POST /assessments/sessions` to start one;
   * `POST /assessments/sessions/{id}/trials` to submit trials;
   * `POST /assessments/sessions/{id}/complete` to finish. SURVEY sends its answers here.
4. **On completion** the backend:
   * scores the session (fewer than 10 usable trials marks it `invalid`, with no score);
   * saves the result;
   * updates that day's result for the run;
   * compares it with the matching baseline (same astronaut, test and time of day).

The server always decides whether an answer was correct; a client's `is_correct` is ignored. Only the
assigned astronaut can take their test. Staff can see what's due but cannot take tests for someone.

### Baselines
* **How they're built:** from the preflight results for each astronaut, test and time of day, as
  median, mean, sample SD and a range of mean ± 2 SD. At least 20 sessions are needed; the seed has 28.
* **Versions:** `POST /baselines/freeze` (medical officer only) saves a new version (v2, v3, …). Old
  versions are kept, and comparisons use the newest one and record which one they used.
* **Capping:** new versions cap the range to the scale (accuracy ≤ 100 %, fatigue 1–9). v1 has accuracy
  limits above 100 %. Capping never changes which scores are inside or outside the range.

### Reading results
Every comparison shows:
* `z_score`;
* `performance_z`: signed so **positive always means better** than the person's normal, whatever the metric;
* `interpretation`: `within_usual_range`, `outside_range_better` or `outside_range_worse`.

This is a comparison with the astronaut's own preflight data, **not medical clearance**, and the API says so.

### Simulation runs stay separate
Tests taken in a new run create that run's own daily results, linked in the `daily_result_runs`
runtime table. They never change the demo run's seeded results.

### Phase 3 endpoints (prefix `/api/v1`)
| Method | Path | Who |
|---|---|---|
| GET | `/assessments/due`, `/assessments/sessions/{id}`, `/astronauts/{id}/assessments` | that astronaut, or staff |
| POST | `/assessments/sessions`, `/sessions/{id}/trials`, `/sessions/{id}/complete` | the assigned astronaut only |
| POST | `/assessments/assignments/generate` | mission leader, medical officer |
| GET | `/astronauts/{id}/baselines` | that astronaut, or staff |
| POST | `/baselines/freeze` | medical officer |
| GET | `/astronauts/{id}/cognition/daily`, `/cognition/comparisons`, `/cognition/trend` | that astronaut, or staff |
| GET | `/metrics/definitions` | signed in |

The simulation jump now also takes an optional `hour`.

### Phase 3 acceptance (plan §8: "reproducible scoring; context-matched baseline")
* **Reproducible scoring:** re-scoring all 2,920 stored sessions from their trials reproduces every stored
  result. NBACK, STROOP and SURVEY match exactly. PVT matches within 0.05 ms, because the seed rounded
  trial times to 0.1 ms after computing the median.
* **Context-matched baselines:** rebuilding gives exactly the seeded v1 values for every test and time of
  day, and each comparison uses the baseline for the same test and time of day.
* **Tests:** 39 new tests in `tests/integration/test_cognition.py` and `tests/api/test_assessments_api.py`.

## Phase 4 (Planning)

Plans one mission day's tasks: who does each one and when.

* **Eligibility** (`crew_readiness_service`), which fails closed:
  * The astronaut must hold the required certification on that date. A `demo_assumed_not_verified`
    qualification counts for standard tasks (and is flagged), but **never for safety-critical ones**.
    Any unknown safety class counts as safety-critical.
  * A valid readiness record with an eligible status is required.
  * Unknown restriction codes block the assignment.
* **Scheduler** (`scheduling_optimizer`): the hard rules are qualified crew only, crew count, no
  overlaps with other tasks or commitments (08:00 tests, exercise, recovery, protected sleep), nothing
  before `workday_start_hour`, dependencies, deadlines and workload limits. Tasks that don't fit are
  left out with plain-English reasons; nothing is relaxed. The objective, in order of importance:
  task coverage, then not giving demanding tasks to astronauts with a worse-than-usual cognitive
  result that day (a preference, not a gate), then workload balance, then earlier starts.
  It uses OR-Tools CP-SAT if installed (uncomment it in `requirements.txt`), otherwise a built-in
  exact solver, which is optimal for the seed's chained daily tasks.
* **Versions** (`schedule_service`): optimising creates a **draft**. The mission leader approves it,
  which **re-checks every rule** first, then publishes it to `daily_schedules`. Approving a newer
  version supersedes the old one. Seed `demo_unapproved` schedules can't be approved.

With a 09:00 start, no seed day fits all 7 chained tasks before sleep at 16:00. The scheduler
says which tasks don't fit and why. An earlier `workday_start_hour` fits more.

### Phase 4 endpoints (prefix `/api/v1/planning`)
| Method | Path | Who |
|---|---|---|
| GET | `/task-sets`, `/task-sets/{id}` | signed in |
| GET | `/task-sets/{id}/eligibility`, `/crew-readiness`, `/qualifications`, `/optimization-runs/{id}`, `/jobs/{id}`, `/schedule-versions`, `/schedule-versions/{id}`, `/schedule-versions/{id}/check` | staff |
| POST | `/optimize`, `/schedule-versions/{id}/approve`, `/reject`, `/publish` | mission leader |

### Phase 4 acceptance (plan §8)
* **Unverified safety-critical certification is blocked:** tested.
* **No overlaps:** every plan is independently checked against all hard rules, on days 1, 17, 45, 62 and 90.
* **Tests:** 36 new tests in `tests/integration/test_planning.py` and `tests/api/test_planning_api.py`.
  The CP-SAT comparison test runs once OR-Tools is installed.

## Phase 5 (Research)

The Medical Research dashboard: ask whether one daily measure goes with another, run it, chart it,
write it up, and have it reviewed.

### Analyses and jobs
* An **analysis** is a saved question: an independent variable, a dependent variable, a method and a
  date range. The three seeded analyses (`ANL-001` to `ANL-003`) work as they are.
* A **job** runs an analysis against one simulation run and stores its numbers in `analysis_results`.
  Jobs run at once, so a job is finished when the request returns.
* **Variables** (`GET /research/variables`): the 16 health measures from Phase 2, accumulated radiation
  dose, and the three cognitive test scores. Each is one value per astronaut per mission day, and days
  are paired by date. Sleep is paired with the day *after* the night, so it lines up with the next
  morning's tests.
* **No peeking ahead:** a job only uses data from before the run's mission time (or the `as_of` you
  pass). The demo run starts on day 1, so jump it forward first or the job is stored as `failed`
  with a message saying so. Cognitive scores come only from the chosen run, as in Phase 3.

### Methods
| Method | What it reports |
|---|---|
| `descriptive` | Mean, spread and range of each variable. No association. |
| `pearson` | Straight-line correlation across all astronaut-days pooled, with slope. |
| `spearman` | Rank correlation across all astronaut-days pooled. |
| `within_person` (default for new analyses) | Correlation after centring each astronaut on their own average, so differences between people cannot create the result. |

Each association comes with a 95% confidence interval, a p-value, the sample size and a plain-English
sentence. Fewer than 10 paired days gives no association. The statistics are written in
`app/utils/statistics.py` with no extra library.

Why `within_person` is the default: in the seed data, pooled sleep and reaction time correlate at
**+0.38** (more sleep, slower), yet within every single astronaut the correlation is negative
(**-0.39** overall). The pooled figure only reflects that the astronauts who sleep longer happen to be
the slower ones.

Every result carries the same caveat: synthetic data, association is not cause, days from one
astronaut are not independent so p-values are optimistic, and nothing here is a clinical finding.

### Charts
`GET /research/jobs/{id}/chart` returns the scatter points (per astronaut per day), a fitted line
(one pooled line for `pearson`; one line per astronaut with a shared slope for `within_person`) and
axis labels and units.

### Reports and review
* The researcher drafts a report from a completed job. A fixed template writes it from the stored
  results. No AI model is involved yet (Phase 6), so `model_id` is empty.
* The draft stores a SHA-256 **evidence hash** of the question, the job's settings and its results.
* The medical officer approves or rejects it. Approval re-computes the hash first and refuses if the
  results changed since the draft. Nobody can review a report on a job they ran or drafted.
* Every job, draft and review (including refused ones) is written to `audit_logs`.

### Planning effectiveness
`POST /research/planning-effectiveness/evaluate` summarises a run's plans over a period and stores one
row per planning method (`preloaded_demo`, `optimizer`, `manual`):
* task coverage, and workload balance (the daily gap in planned minutes between the busiest and least
  busy astronaut);
* the crew's average reaction time on the planned days;
* task completion, on-time starts (within 15 minutes) and recovery completion. These stay **empty,
  not zero**, until something is recorded as started or completed. Nothing in the backend records
  The seed plan is fictional and can never be recorded, so its rates stay empty. Real plans fill them
  in through the task and recovery tracking routes below.

Only approved, published or demo plans count unless `include_drafts` is set. The result is
descriptive and says so: with one crew it cannot show that one planning method works better.

### Three more runtime tables
`analysis_job_details` (a job's settings and summary), `analysis_result_jobs` (which job produced each
result) and `research_report_details` (a report's job, author and review comment). The seed tables
have no columns for these. They are created automatically the next time the API starts.

### Phase 5 endpoints (prefix `/api/v1/research`)
| Method | Path | Who |
|---|---|---|
| GET | `/variables`, `/analyses`, `/analyses/{id}`, `/analyses/{id}/results`, `/analyses/{id}/chart` | staff |
| GET | `/jobs`, `/jobs/{id}`, `/jobs/{id}/chart`, `/reports`, `/reports/{id}`, `/planning-effectiveness` | staff |
| POST | `/analyses`, `/analyses/{id}/run`, `/reports`, `/planning-effectiveness/evaluate` | researcher |
| POST | `/reports/{id}/review` | medical officer |

Astronauts have no access to research routes. Roles are set in `app/core/permissions.py`
(`RESEARCH_READ_ROLES`, `RESEARCH_RUN_ROLES`, `REPORT_REVIEW_ROLES`).

### Phase 5 tests
31 new tests in `tests/integration/test_research.py` and `tests/api/test_research_api.py`: p-values and
correlations against reference values, no data after `as_of`, repeatable jobs, the report hash
re-check, and every role rule.

## Recovery Planner and task tracking

These close two gaps before the AI phase: recovery suggestions had no routes, and nothing recorded
whether a task or a recovery was actually done.

### Recovery Planner (`recovery_service`)

```
generate -> pending_review --approve--> approved --schedule--> booked (planned)
booked: planned --complete--> completed      planned --skip--> skipped
```

* **Signals.** For one astronaut at one mission time, four things are compared with that astronaut's
  **own earlier days**: last night's sleep length, this morning's fatigue, this morning's perceived
  workload, and any test result below their preflight baseline range. A value counts once it is 1 SD
  from their own average (5 earlier values needed). Only data from before that mission time is used.
  `GET /recovery/signals` shows exactly what the rules see.
* **Suggestions.** Fixed rules (`rules_v1`, no AI model) score each **approved** catalogue activity
  against the active signals and keep the top two. Short sleep points to sleep preparation, fatigue to
  a quiet break, workload to paced breathing, a test dip to a mindfulness or quiet break. Extra
  exercise is never suggested. No unusual signal means no suggestion, and the reply says so.
  Each suggestion stores the evidence it was based on.
* **Review and booking.** The medical officer approves or rejects, then books an approved suggestion
  at a time. Booking is refused if it overlaps a task, sleep, exercise or another recovery, and lists
  what it clashes with. A booked recovery also blocks the task scheduler.
* **Outcome.** The astronaut it is booked for (or the medical officer) marks it completed or skipped,
  with optional feedback.
* Generating again for the same day replaces suggestions nobody reviewed and keeps reviewed ones.
  Suggestions belong to the simulation run they were made in.

Example from the seed, day 10 at 10:00: AST-004 slept less than usual and reports more fatigue, so
gets *Sleep preparation* and *Quiet break*. AST-003 has a test below baseline and gets *Mindfulness
break*. The other three get nothing.

A suggestion says an astronaut's morning looks unusual for them and names a matching approved
activity. It does not claim the activity will improve a score. Whether it does is a question the
completion records now make it possible to study in Phase 5.

### Task tracking (`task_execution_service`)

```
scheduled --start--> in_progress --complete--> completed       scheduled / in_progress --skip--> skipped
```

* Only tasks from a **published** schedule can be recorded. The assigned astronaut records their own
  work; the mission leader can record for anyone.
* A task cannot start until the tasks it depends on are completed. Skipping needs a reason.
* Times are mission time (the run's clock, or an earlier `at`), and only on the task's planned day.
* Once any task in a day's plan has started, that plan can no longer be replaced by a newer version.

### The seed plan stays fictional
Seeded recommendations, recovery bookings and task assignments cannot be approved, completed or
started, the same rule Phase 4 applies to seed schedules. To record real work: optimise, approve and
publish a day, or generate, approve and book a recovery.

### Endpoints (prefix `/api/v1`)
| Method | Path | Who |
|---|---|---|
| GET | `/recovery/activities` | signed in |
| GET | `/recovery/signals`, `/recovery/recommendations`, `/recovery/recommendations/{id}`, `/recovery/scheduled` | that astronaut, or staff |
| POST | `/recovery/recommendations/generate`, `/recommendations/{id}/approve`, `/reject`, `/schedule` | medical officer |
| POST | `/recovery/scheduled/{id}/complete`, `/skip` | that astronaut, or medical officer |
| GET | `/planning/assignments` | that astronaut, or staff |
| POST | `/planning/assignments/{id}/start`, `/complete`, `/skip` | the assigned astronaut, or mission leader |

One more runtime table, `recovery_recommendation_details`, holds each suggestion's simulation run,
evidence and review. It is created automatically the next time the API starts.

**Tests:** 19 new tests in `tests/integration/test_recovery_and_execution.py` and
`tests/api/test_recovery_api.py`.

## Accounts and new missions

Login was there from Phase 1. This adds a way to register people and missions (`account_service`).

* **No open sign-up.** A role decides who can read the crew's medical data, so the **mission leader**
  creates each account and chooses its role. Anyone could otherwise register as a medical officer.
* **Registering a user** (`POST /admin/users`): username, role and optional email. Leave the password
  out and a temporary one is returned **once**; it is never stored in readable form.
* **Registering an astronaut:** the same call with role `astronaut` plus a `mission_id` (and optional
  `specialization` and `crew_role`). It creates the login and the astronaut profile together.
* **New mission** (`POST /missions`): name, launch date and planned end date. It starts empty with
  status `planned`.
* **Passwords:** a user changes their own with `POST /auth/change-password` (current password needed).
  The mission leader can reset anyone's and gets a new temporary password back once.
* **Deactivating** an account blocks sign-in and keeps its records. Deactivating, resetting or changing
  a password signs that account out everywhere. Nobody can deactivate themselves.
* Every one of these actions is written to `audit_logs`.

What a new astronaut does **not** get automatically: a medical clearance (they start as
`pending_review`), a readiness record, qualifications, baselines or any health data. Until those
exist the task scheduler will not assign them anything, which is the safe default. A new mission
likewise has no task sets or sensor data until some are added.

| Method | Path | Who |
|---|---|---|
| POST | `/missions` | mission leader |
| GET | `/admin/users`, `/admin/users/{id}` | mission leader, medical officer |
| POST | `/admin/users`, `/admin/users/{id}/deactivate`, `/reactivate`, `/reset-password` | mission leader |
| POST | `/auth/change-password` | signed in (own password) |

**Tests:** 4 new tests in `tests/api/test_accounts_api.py`.

## Phase 6 (AI: Gemma, offline)

**The rules decide. Gemma explains.** The scheduler and the recovery rules already choose who does a
task and which activity is suggested. Gemma only turns those decisions into a few readable
sentences, and drafts research reports. It never picks an astronaut, never changes a
recommendation and never approves anything.

### Setting up the model (once)
Gemma runs on your own machine through [Ollama](https://ollama.com), so after the first download it
needs no internet.

1. Install Ollama.
2. While online, download the model once: `ollama pull gemma3:4b`
3. Ollama then serves it at `http://127.0.0.1:11434`. Start the backend as usual.
4. Check it: `GET /api/v1/admin/model-status` should say `"ready": true`.

To use a different Gemma size, set `AEGIS_GEMMA_MODEL` in `.env` (for example `gemma3:1b` on a small
laptop) and pull that one instead. Settings are listed in `.env.example`.

**Without the model, nothing breaks.** Every AI route still answers, with the rule-based text, and
`model-status` says what to do.

### What happens on each request (`ai_service`)
1. **Build a small packet of finished facts.** Never raw tables: the backend has already done the
   maths (today's value, the astronaut's own usual, the difference).
2. **Ask the local model** to write a few sentences from that packet only.
3. **Check the answer.** It is thrown away if it contains a number that is not in the packet, names
   an astronaut or activity that is not in the packet, is too long, or uses medical or promising
   wording ("diagnosis", "unfit", "will improve" and similar).
4. **Log the call** in `ai_inference_logs`: purpose, model, prompt version, timing, outcome and
   SHA-256 hashes of the prompt and the answer (not the text itself).
5. **Keep the text only if it passed.** Otherwise the rule-based text is returned. The rule-based
   reason on the original row is never overwritten.

### The three jobs
| Job | Who asks | What Gemma is given | Where the text goes |
|---|---|---|---|
| Explain a recovery suggestion | medical officer | The activity, and what is unusual for that astronaut today against their own usual | `ai_explanations` |
| Explain a task assignment | mission leader | The task's demands, who the rules allow, who they exclude and why, and each allowed astronaut's sleep, fatigue, workload and tests today | `ai_explanations` |
| Draft a research report | researcher | The question, method, results and per-astronaut figures of a completed job | `research_reports` (`model_id` set, status `draft`) |

* A report written by Gemma gets the limitations paragraph added by code, not by the model, and
  still needs the medical officer's review like any other report. If Gemma is unavailable or its
  text fails the checks, the fixed template writes the report.
* The fictional seed rows cannot be explained: seeded recovery suggestions have no evidence behind
  them, and the seed plan assigned tasks by rotation rather than crew state.
* The task packet uses crew state as known by the time the task starts, never later.

### Crew data stays on this machine
The model client refuses any address that is not this computer (`127.0.0.1` or `localhost`).
`AEGIS_GEMMA_ALLOW_REMOTE=true` lifts that, for a model on another trusted host.

### Phase 6 endpoints (prefix `/api/v1`)
| Method | Path | Who |
|---|---|---|
| POST | `/ai/recovery-recommendations/{id}/explain` | medical officer |
| POST | `/ai/task-assignments/{id}/explain` | mission leader |
| GET | `/ai/explanations/{entity_type}/{entity_id}` (no model call) | the astronaut concerned, or staff |
| POST | `/ai/reports` | researcher |
| GET | `/admin/ai-inferences`, `/admin/model-status` | mission leader, medical officer |

Every answer carries `source`: `gemma` when a checked AI text is shown, `rules` (or `template` for
reports) when the rule-based text is shown instead, plus `rule_based_text` so a screen can show both.

### Tested, and not tested
* 21 new tests in `tests/integration/test_ai.py` and `tests/api/test_ai_api.py` use a stand-in
  model, so they run with no model installed. They cover the answer checks, logging, fallback when
  the model is off or wrong, every role rule, and that an explanation never changes a decision.
* **Not yet run against a real Gemma model.** The request format follows Ollama's published API,
  but how often real answers pass the checks, and how good they read, has to be tried on a machine
  with the model installed. If too many good answers are rejected, the prompts in `ai_service.py`
  (`SYSTEM_PROMPT`, `_TASKS`) are the place to adjust.

## Next: Phase 7 (Offline sync)
Sync status and sync conflicts (`/admin/sync-status`, `/admin/sync-conflicts`).
