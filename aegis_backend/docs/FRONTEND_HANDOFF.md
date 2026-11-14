# Handoff for the frontend

This is for whoever builds the screens. It covers how to talk to the backend, what each dashboard
needs to call, and the things that will trip you up. Example responses are real ones from the seed
data, shortened.

The full, always up-to-date list of endpoints with a "try it" button is at
**http://127.0.0.1:8000/docs** once the backend is running. The machine-readable version is at
`/openapi.json`. If this guide and `/docs` ever disagree, `/docs` is right.

---

## 1. Get the backend running

From the `aegis_backend` folder:

```
python -m venv .venv
.venv\Scripts\Activate.ps1          (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
python scripts/import_csvs.py --reset
python scripts/set_demo_passwords.py
uvicorn app.main:app --reload
```

* The API is at `http://127.0.0.1:8000/api/v1`.
* Logins: `mission_leader`, `researcher`, `medical_officer`, `crew1` to `crew5`.
  Their passwords are in `demo_credentials.local.txt` after the password script runs.
* The backend accepts browser requests from `http://localhost:3000` and `http://localhost:5173`.
  If your dev server uses another address, set `AEGIS_CORS_ORIGINS` in `aegis_backend/.env`
  (comma-separated) and restart.

## 2. The five rules for every request

**1. Base URL from a setting.** For example `VITE_API_URL=http://127.0.0.1:8000/api/v1`. Never
hard-code it in components.

**2. Send the token.** After login, send this header on every request:

```
Authorization: Bearer <access_token>
```

**3. Errors always look the same:**

```json
{"error": "permission_denied", "message": "You may not view this astronaut's data", "details": null}
```

Show `message` to the user. `details` is sometimes a list (for example the things a booking
clashes with); show it as bullet points when present.

| Status | Meaning | What the screen should do |
|---|---|---|
| 401 | Not signed in, or session ended | Clear the token and go to the login page |
| 403 | Signed in but not allowed | Show "You don't have access to this" |
| 404 | No such record | Show "Not found" |
| 409 | The action clashes with the current state | Show `message` and `details` |
| 422 | Bad input | Show `message` next to the form |

One exception: when a request body is missing a required field, FastAPI itself answers 422 with
`{"detail": [...]}` instead of the shape above. Handle both.

**4. Times are UTC text** like `2027-03-10T08:00:00Z`. Dates are `2027-03-10`.

**5. Put all of this in one small API helper** and have every page use it. Do not call `fetch`
directly from components.

```js
const BASE = import.meta.env.VITE_API_URL;

export async function api(path, { method = "GET", body, params } = {}) {
  const url = new URL(BASE + path);
  Object.entries(params ?? {}).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const token = localStorage.getItem("aegis_token");
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) { localStorage.removeItem("aegis_token"); window.location.assign("/login"); }
    const message = data?.message ?? data?.detail?.[0]?.msg ?? "Something went wrong";
    throw Object.assign(new Error(message), { status: res.status, details: data?.details });
  }
  return data;
}
```

## 3. Mission time: read this before building any dashboard

The system runs on **mission time**, not real time. The mission is 90 days, from 1 March 2027.
Every dashboard shows data "as of" the simulation run's clock.

* The demo run is `RUN-DEMO-001`. It **starts on day 1 at 00:00, where almost every dashboard is
  empty.** This is the number one reason a screen looks broken.
* Build a "jump to day" control early. Only the mission leader can use it:

```
POST /simulation/runs/RUN-DEMO-001/jump    {"mission_day": 10, "hour": 8}
```

```json
{"simulation_run_id": "RUN-DEMO-001", "status": "paused", "speed_multiplier": 60,
 "current_mission_time": "2027-03-10T08:00:00Z", "mission_day": 10, "mission_total_days": 90}
```

* Good days to test with: **day 10** and **day 46** (some astronauts have unusual sleep, fatigue or
  test results on those days).
* Most read endpoints accept `?at=2027-04-15T09:30:00Z` to look at a fixed time, and
  `?simulation_run_id=…` to follow a different run. Leave both out to follow the demo run.

### Live clock (WebSocket)

```
ws://127.0.0.1:8000/api/v1/ws/simulation/RUN-DEMO-001?token=<access_token>
```

The token goes in the address because browsers cannot set headers on a WebSocket. Messages:

```json
{"event": "state", "simulation_run_id": "RUN-DEMO-001", "state": { ...same shape as above... }}
```

`event` is `state` on connect, `tick` every 5 seconds while the run is running, and
`started`, `paused`, `speed_changed` or `jumped` right after someone uses a control. When a `jumped`
message arrives, reload the data on the current dashboard.

## 4. Login and who sees what

```
POST /auth/login    {"username": "crew4", "password": "…"}
```

```json
{"access_token": "jYTjYV8O…", "token_type": "bearer", "expires_at": "2026-11-15T06:59:16Z",
 "user": {"user_id": "USR-004", "username": "crew4", "role_name": "astronaut", "account_status": "active"}}
```

```
GET /auth/me
```

```json
{"user": {"user_id": "USR-004", "username": "crew4", "role_name": "astronaut"},
 "permitted_astronaut_ids": ["AST-004"]}
```

* Call `/auth/me` when the app loads. If it returns 401, show the login page.
* `permitted_astronaut_ids` tells you whose data this user can open. An astronaut has exactly one
  (themselves). Staff have all five. Use it to decide whether to show an astronaut picker.
* `POST /auth/logout` ends the session. `POST /auth/change-password` needs
  `{"current_password", "new_password"}` and signs the user out, so send them to login afterwards.
* There is **no public sign-up page.** Accounts are created by the mission leader (section 11).

### Menu by role

The backend refuses anything not allowed (403), but the screen should hide it too.

| Dashboard | astronaut | mission_leader | medical_researcher | medical_officer |
|---|---|---|---|---|
| Astronaut Health | own only | all crew | all crew | all crew |
| Preflight Assessment (take tests) | own tests | view only | view only | view only |
| Mission Mind (cognition) | own only | all crew | all crew | all crew |
| Mission Planning | view tasks, record own | plan, approve, publish | view | view |
| Recovery Planner | own, mark done | view | view | generate, approve, book |
| Medical Research | no | view | run, draft reports | view, review reports |
| Admin (import, audit, users) | no | yes | no | view only |
| Simulation controls | no | yes | no | no |

## 5. Astronaut Health dashboard

All paths start with `/astronauts/{astronaut_id}`.

| Widget | Call |
|---|---|
| Header cards (vitals, radiation, last sleep, workload) | `GET /health/summary` |
| Vital chart | `GET /vitals/history?measurement_type=heart_rate&resolution=daily` |
| Body map | `GET /body-map` |
| Radiation | `GET /radiation`, `GET /radiation/organ-doses` |
| Sleep | `GET /sleep` |
| Activity | `GET /activity` |
| Today's calendar | `GET /schedule` |
| "What has changed" panel | `GET /health/changes` |
| Cabin environment (not per astronaut) | `GET /environment/current`, `/environment/history?measurement_type=cabin_co2` |

`measurement_type` is one of `heart_rate`, `hrv_rmssd`, `spo2`, `body_temperature`,
`respiratory_rate`. `resolution` is `daily` or `hourly` (hourly is limited to 31 days).

`GET /astronauts/AST-004/health/summary`:

```json
{"astronaut_id": "AST-004", "as_of": "2027-03-10T08:00:00Z",
 "vitals": [{"measurement_type": "heart_rate", "label": "Heart rate", "unit": "bpm", "value": 65.87,
             "timestamp_utc": "2027-03-10T08:00:00Z", "status": "current"}],
 "radiation": {"dose_rate": 0.1845, "dose_rate_unit": "uSv/h", "accumulated_dose": 0.0572,
               "accumulated_dose_unit": "mSv"},
 "last_sleep": {"total_sleep_minutes": 446.3, "sleep_efficiency_percent": 86.1, "sleep_quality_score": 5.2},
 "recent_workload": {"days": 7, "activity_minutes": 280, "planned_task_count": 11}}
```

`GET /astronauts/AST-004/body-map` gives regions (heart, lungs and so on), each with metrics that
carry `value`, `personal_range` and `position` (`within_personal_range`, `above…`, `below…`).
Colour the body map from `position`.

`GET /astronauts/AST-004/health/changes` compares the last 7 days with the astronaut's own first
week. Each metric has `change`, `percent_change` and `change_level`: `notable`, `mild`,
`within_usual_variation`, or `reference_period` during the first week. Always show the
`disclaimer` text that comes with it.

**Units come with the data.** Every value has a `unit` field. Display that; do not hard-code units.

## 6. Preflight Assessment (taking the cognitive tests)

Four tests: `PVT` (reaction time), `NBACK` (working memory), `STROOP` (attention), `SURVEY`
(fatigue, sleepiness, workload). Tests open at 08:00 mission time for one hour.

The flow, as the astronaut:

```
GET  /assessments/due                               what is open right now
POST /assessments/sessions   {"assignment_id": "…"} start one
POST /assessments/sessions/{id}/trials              send the answers
POST /assessments/sessions/{id}/complete            finish and get the score
```

Each trial you send:

```json
{"trial_number": 1, "stimulus_type": "target", "stimulus_value": "X",
 "expected_response": "press", "actual_response": "press", "reaction_time_ms": 284.5}
```

For `SURVEY`, skip the trials call and send the answers on complete:

```json
{"survey": {"fatigue_score": 3, "sleepiness_score": 2, "perceived_workload": 4}}
```

Things to know:

* **`/assessments/due` is empty on the demo run.** Its tests were already taken in the seed data.
  To try the test screens: as mission leader create a new run (`POST /simulation/runs`), generate
  tests for it (`POST /assessments/assignments/generate` with `simulation_run_id`, `from_day`,
  `to_day`), jump that run to hour 8 of a day, then sign in as the astronaut and pass
  `?simulation_run_id=` to `/assessments/due`.
* **The server decides whether an answer is right.** Do not compute or send a score.
* **Measure reaction time in the browser** with `performance.now()` from the moment the stimulus is
  drawn to the key press, and send that number.
* Only the assigned astronaut can take their test. Staff get 403.
* A session with fewer than 10 usable trials is marked `invalid` and gets no score.

## 7. Mission Mind (cognition over time)

All paths start with `/astronauts/{astronaut_id}`.

| Widget | Call |
|---|---|
| Daily scores | `GET /cognition/daily` |
| Today against personal baseline | `GET /cognition/comparisons` |
| Trend arrow per test | `GET /cognition/trend?protocol_id=PVT` |
| The baseline itself | `GET /baselines` |
| Which direction is good | `GET /metrics/definitions` (no astronaut prefix) |

```json
{"astronaut_id": "AST-004", "count": 40, "outside_range_worse": 3,
 "comparisons": [{"assessment_date": "2027-03-01", "mission_day": 1, "protocol_id": "NBACK",
                  "baseline_value": 87.5, "inflight_value": 85.0, "percentage_difference": -2.86,
                  "reference_range_status": "within_reference", "interpretation": "within_range"}],
 "note": "Comparison with this astronaut's own preflight baseline. Statistical context only; …"}
```

* Use `interpretation` for colour: `outside_range_worse` is the only one worth highlighting.
* **Lower is better for reaction time and fatigue; higher is better for accuracy.** Take
  `better_direction` from the data (`/metrics/definitions` or the trend response). Do not assume.
* Always show the `note`. These are comparisons with the person's own normal, not medical
  clearance.

## 8. Mission Planning

All paths start with `/planning`.

| Step | Call | Who |
|---|---|---|
| List days | `GET /task-sets?from_day=10&to_day=10` | signed in |
| A day's tasks | `GET /task-sets/{id}` | signed in |
| Who may do what, and why not | `GET /task-sets/{id}/eligibility` | staff |
| Make a plan | `POST /optimize {"task_set_id": "SET-010"}` | mission leader |
| See a plan | `GET /schedule-versions/{id}` | staff |
| Safety check without approving | `GET /schedule-versions/{id}/check` | staff |
| Approve, reject, publish | `POST /schedule-versions/{id}/approve`, `/reject`, `/publish` | mission leader |

A plan moves **draft → approved → published**. Only a published plan is on the crew calendar.

`POST /planning/optimize`:

```json
{"optimization_run_id": "OPT-DE8BEF886AEF", "status": "partial", "schedule_version_id": "SV-57C24DD025D8",
 "scheduled": [{"task_id": "TSK-010-01", "astronaut_ids": ["AST-003"], "start_time": "09:00", "end_time": "10:15"}],
 "unscheduled": [{"task_id": "TSK-010-05", "title": "Lab sample documentation",
                  "reasons": ["AST-002: no free 60-minute slot between 15:35 and 18:00; busy with …"]}],
 "warnings": ["Some assignments rely on demo qualifications that are NOT verified."]}
```

* `status` is `complete`, `partial` or `infeasible`. **`partial` is normal**: with a 09:00 start not
  every task fits. Show the `unscheduled` list with its `reasons`; that is the useful part.
* Show `warnings` prominently.
* Approve can fail with 409 and a list of problems in `details` if something changed since the
  draft was made.

### Recording what happened (astronaut's task list)

| Action | Call |
|---|---|
| My tasks today | `GET /planning/assignments?date=2027-03-10` |
| Start, finish | `POST /planning/assignments/{id}/start`, `/complete` |
| Skip | `POST /planning/assignments/{id}/skip {"reason": "…"}` (reason required) |

* `assignment_status` goes `scheduled → in_progress → completed`, or `skipped`. Show Start only on
  `scheduled`, Complete only on `in_progress`.
* Starting a task before the tasks it depends on are done gives 409 with their names in `details`.
* **Rows with `version_status: "demo_unapproved"` are the fictional seed plan and cannot be
  started.** Grey them out or hide the buttons.

## 9. Recovery Planner

All paths start with `/recovery`.

| Step | Call | Who |
|---|---|---|
| Activity catalogue | `GET /activities` | signed in |
| What looks unusual for one astronaut | `GET /signals?astronaut_id=AST-004` | that astronaut, staff |
| Make today's suggestions | `POST /recommendations/generate` | medical officer |
| List suggestions | `GET /recommendations?mission_day=10` | own, or staff for all |
| Approve or reject | `POST /recommendations/{id}/approve`, `/reject` | medical officer |
| Book a time | `POST /recommendations/{id}/schedule {"scheduled_start": "2027-03-10T14:00:00Z"}` | medical officer |
| Booked recoveries | `GET /scheduled?date=2027-03-10` | own, or staff for all |
| Mark done or skipped | `POST /scheduled/{id}/complete`, `/skip` with optional `{"feedback": "…"}` | that astronaut, medical officer |

A suggestion:

```json
{"recommendation_id": "RCR-3F2A…", "astronaut_id": "AST-004", "activity_name": "Sleep preparation",
 "recommended_duration_minutes": 20, "recommendation_score": 0.885, "approval_status": "pending_review",
 "reason": "Sleep preparation: shorter sleep than usual last night, higher fatigue than usual.",
 "is_demo": false, "scheduled_recovery_id": null,
 "evidence": {"active": ["high_fatigue", "short_sleep"],
              "signals": {"short_sleep": {"value": 318.0, "own_average": 421.5, "z": -2.6, "unit": "minutes"}}}}
```

* **An astronaut with nothing unusual gets no suggestion.** The generate response includes a
  `message` saying so. Show it; an empty list is a normal result, not an error.
* Show `reason` as the explanation. In Phase 6 the AI will write a friendlier version into the
  same field, so the screen will not need to change.
* Booking on top of a task, sleep, exercise or another recovery gives 409 with the clashes in
  `details`.
* `GET /recommendations` hides the fictional seed rows unless you pass `include_demo=true`. Rows
  with `is_demo: true` cannot be approved, and bookings with `is_demo: true` cannot be marked done.
* Test on day 10 at hour 10: AST-004 and AST-003 get suggestions, the other three do not.

## 10. Medical Research

All paths start with `/research`.

| Step | Call | Who |
|---|---|---|
| Variables and methods for the form | `GET /variables` | staff |
| Saved questions | `GET /analyses`, `GET /analyses/{id}` | staff |
| New question | `POST /analyses` | researcher |
| Run it | `POST /analyses/{id}/run` | researcher |
| Latest result and chart | `GET /analyses/{id}/results`, `GET /analyses/{id}/chart` | staff |
| Any job | `GET /jobs/{id}`, `GET /jobs/{id}/chart` | staff |
| Reports | `GET /reports`, `GET /reports/{id}` | staff |
| Draft a report | `POST /reports {"analysis_id": "…"}` | researcher |
| Review it | `POST /reports/{id}/review {"decision": "approve", "comment": "…"}` | medical officer |
| Planning effectiveness | `GET /planning-effectiveness`, `POST /planning-effectiveness/evaluate` | staff / researcher |

* **Running returns at once with a finished job.** No polling needed. Check `status`: `completed`
  has `results`; `failed` has an `error_message` in plain English. A failed job still answers 201.
* **The most common failure is "too little data"** because the demo run is on day 1. Jump the run
  forward, or send `{"as_of": "2027-05-29T23:00:00Z"}` in the run request.
* The chart response is ready to plot: `points` (`{astronaut_id, day, x, y}`), `series` (the same
  points grouped by astronaut), `lines` (each with `from` and `to` coordinates), plus `x_axis` and
  `y_axis` with `label` and `unit`.
* Each result row has an `interpretation` sentence. Show it as is, including the caveat.
* Review answers 409 if the report was already reviewed or its numbers changed since the draft.

## 11. Admin

All paths start with `/admin`. Mission leader and medical officer can read; only the mission
leader can change things.

| Screen | Call |
|---|---|
| Crew health overview | `GET /crew-health/changes?only_changes=true` |
| Sensor data quality | `GET /sensor-quality` |
| Import status | `GET /import-status`, `GET /import-runs/latest` |
| Data sources and lineage | `GET /data-sources`, `GET /data-lineage` |
| Audit log | `GET /audit-logs?entity_type=…&limit=100` |
| Users | `GET /users`, `GET /users/{id}` |
| Register a user | `POST /users` |
| Deactivate, reactivate | `POST /users/{id}/deactivate`, `/reactivate` |
| Reset a password | `POST /users/{id}/reset-password` |
| New mission | `POST /missions` (no `/admin` prefix) |

Registering an astronaut:

```json
{"username": "nova.reyes", "role_name": "astronaut", "email": "nova@example.invalid",
 "mission_id": "MIS-001", "specialization": "Geology", "crew_role": "Mission Specialist"}
```

* `mission_id` is required for the astronaut role and not allowed for the other three roles.
* If you send no `password`, the response contains `temporary_password`. **It is shown once and
  can never be fetched again.** Display it in a dialog with a copy button and a clear warning
  before the user closes it. The same applies to reset-password.
* Do not store the temporary password anywhere in the frontend.

## 12. Things to show honestly

* **Everything is synthetic demo data.** Put a visible "Simulated data" label on the app.
* **Show the notes and disclaimers the API returns** (`note`, `disclaimer`, `caveat`). They are
  short and they stop a comparison being read as a diagnosis.
* **Empty is not zero.** Several fields are `null` when nothing has been recorded (for example
  completion rates). Show "No data yet", not 0%.
* **Demo rows are fictional.** Anything marked `demo_unapproved` or `is_demo` is seed filler. Label
  it and disable its action buttons.

## 13. Suggested build order

1. API helper, login page, `/auth/me`, logout.
2. Role-based menu.
3. Simulation bar: mission day, clock, jump control, WebSocket.
4. Astronaut Health (read-only, good first dashboard).
5. Mission Mind.
6. Mission Planning, then the astronaut's task list with start and complete.
7. Recovery Planner.
8. Medical Research.
9. Admin and user registration.
10. Preflight Assessment test screens (the most interactive part; leave it until the rest works).

Get step 1 working on a real screen before starting any dashboard. Wrong address, CORS and token
problems all show up there.

## 14. When something does not match

Open the browser's Network tab, copy the request (address, body) and the response, and send both
to the backend owner. That turns most mismatches into a one-line fix.

Not built yet: the AI routes (Phase 6) and offline sync (Phase 7). Nothing in this guide depends on
them.
