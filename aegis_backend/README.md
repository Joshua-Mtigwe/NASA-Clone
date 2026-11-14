# AEGIS Backend — Phases 1–3

Python + SQLite + FastAPI backend for the AEGIS crew health-aware mission planning prototype,
following the Revised Backend Engineering Plan:
* **Phase 1 (Foundation):** the 49-file importer, database schema, login and roles, and isolated simulation runs.
* **Phase 2 (Health):** vitals, radiation, sleep, activity, cabin environment, and the admin crew health-changes view.
* **Phase 3 (Cognition):** taking the cognitive tests, scoring, preflight baselines, and in-flight comparisons.

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
| POST | `/auth/login`, `/auth/logout` · GET `/auth/me` | anyone / signed in |
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
  database/    schema.sql (49 seed tables + 4 runtime tables), session.py
  services/    data_import_service, auth_service, mission_simulator, audit_service,
               health_context, physiology_service, radiation_service, environment_service,
               sleep_activity_service, health_changes_service,
               assessment_service, cognitive_scoring, baseline_service, cognitive_comparison_service
  api/         auth, missions, simulation, health, environment, assessments, admin, websocket routes
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

## Next: Phase 4 (Planning)
Qualification checks, OR-Tools scheduling and versioned approval: `crew_readiness_service`,
`task_service` and `scheduling_optimizer`. The plan's acceptance check is that unverified safety-critical
certifications are blocked and schedules never overlap.
