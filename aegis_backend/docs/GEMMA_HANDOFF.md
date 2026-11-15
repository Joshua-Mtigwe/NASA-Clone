# Handoff for the Gemma (AI) part

> **Update: Phase 6 is now built.** See "Phase 6 (AI: Gemma, offline)" in `README.md` for how it
> works and how to install the model. The code is in `app/services/gemma_client.py`,
> `app/services/ai_service.py` and `app/api/ai.py`. Two things differ from the plan below:
> the AI text is stored in a separate table (`ai_explanations`) so the rule-based reason is never
> overwritten, and the backend builds the task packet itself, so no extra endpoint is needed.
> The rest of this page remains a good description of the design. What is left to do is trying it
> with a real model and tuning the prompts.

This is for whoever builds Phase 6. It says what the backend already works out, what Gemma should
be given, where Gemma's answers go, and the rules Gemma must not break.

## The one idea to keep in mind

**The backend decides. Gemma explains.**

The backend already works out who is allowed to do a task, who is the best fit today, and which
recovery activity matches an astronaut's morning. It does this with fixed rules and numbers.
Gemma's job is to turn those numbers into a short, clear sentence a person can read, and to write
summaries. Gemma never picks an astronaut or an activity on its own.

Why: a small model can write a wrong sentence. If the rules have already made the decision, a
wrong sentence cannot put an uncertified person on a safety-critical task.

## Do not feed Gemma raw tables

The raw data is far too big (54,000 sensor readings, 43,800 test trials) and small models are bad
at arithmetic. The backend has already done the maths. Give Gemma a small packet of finished
facts, about 20 to 40 lines of JSON per request.

## The three jobs for Gemma

| # | Job | Reader | Gemma writes |
|---|---|---|---|
| 1 | Explain a task assignment | Mission leader | "Why this astronaut got this task today" |
| 2 | Explain a recovery suggestion | Medical officer, astronaut | "Why this activity is suggested" |
| 3 | Write up a research result | Researcher, medical officer | A plain-English report of an analysis |

---

## Job 1: explain a task assignment

**What to fetch** (all under `/api/v1`, mission leader or staff login):

| Fact | Endpoint | Table behind it |
|---|---|---|
| The day's tasks and what each demands | `GET /planning/task-sets/{task_set_id}` | `mission_tasks`, `task_requirements`, `task_dependencies` |
| Who is allowed to do each task, and why not | `GET /planning/task-sets/{task_set_id}/eligibility` | `astronaut_qualifications`, `crew_readiness` |
| The plan the optimiser made, and reasons for anything left out | `GET /planning/schedule-versions/{id}`, `GET /planning/optimization-runs/{id}` | `schedule_versions`, `task_assignments`, `optimization_runs` |
| Each astronaut's test results today against their own baseline | `GET /astronauts/{id}/cognition/comparisons?start_date=…&end_date=…` | `cognitive_comparisons`, `cognitive_baselines` |
| Last night's sleep | `GET /astronauts/{id}/sleep` | `sleep_records` |
| Recent health changes | `GET /astronauts/{id}/health/changes` | computed from `sensor_readings`, `sleep_records`, `activity_records`, `assessment_context` |

**Packet to give Gemma** (build this in code from the calls above):

```json
{
  "task": {"title": "Plant growth experiment", "cognitive_demand": 3, "attention_demand": 3,
           "time_pressure": 4, "safety_class": "standard_demo"},
  "assigned_to": "AST-002",
  "planned": "10:00-11:30",
  "allowed_astronauts": ["AST-002", "AST-004"],
  "today": {
    "AST-002": {"reaction_time_ms": 268, "baseline_ms": 271, "status": "within_reference",
                "attention_accuracy": 100, "sleep_minutes": 432, "fatigue_1_to_9": 2.4},
    "AST-004": {"reaction_time_ms": 305, "baseline_ms": 272, "status": "outside_range_worse",
                "attention_accuracy": 85, "sleep_minutes": 318, "fatigue_1_to_9": 4.9}
  }
}
```

**What Gemma returns:** two or three sentences, using only numbers that are in the packet.

**Where it goes:** `ai_task_recommendations.recommendation_reason`. The optimiser already creates
one row per assignment when it makes a draft; Gemma fills in the reason. Do not change
`astronaut_id`, `constraint_check_status` or `recommendation_status`. Those belong to the rules and
to the mission leader.

---

## Job 2: explain a recovery suggestion

This is the easiest one to start with, because the packet already exists.

**What to fetch** (medical officer login):

| Fact | Endpoint |
|---|---|
| Today's suggestions with their evidence | `GET /recovery/recommendations?mission_day=…` |
| The same evidence for one astronaut, without creating anything | `GET /recovery/signals?astronaut_id=…` |
| The approved activity list | `GET /recovery/activities` |

Each recommendation already carries an `evidence` block. That block is the packet:

```json
{
  "astronaut_id": "AST-004",
  "activity_name": "Sleep preparation",
  "recommended_duration_minutes": 20,
  "evidence": {
    "active": ["high_fatigue", "short_sleep"],
    "signals": {
      "short_sleep": {"value": 318.0, "own_average": 421.5, "z": -2.6, "unit": "minutes"},
      "high_fatigue": {"value": 4.9, "own_average": 3.1, "z": 1.5, "unit": "1-9"}
    }
  }
}
```

**What Gemma returns:** a short, friendly explanation for the astronaut, for example: "You slept
about 100 minutes less than your usual last night and rated your fatigue higher than normal. A
20-minute sleep preparation routine is suggested before your next rest period."

**Where it goes:** `recovery_recommendations.reason`.

**Tables behind it:** `recovery_activities`, `recovery_recommendations`, `scheduled_recovery`,
`recovery_recommendation_details` (evidence).

---

## Job 3: write up a research result

**What to fetch** (researcher login):

| Fact | Endpoint |
|---|---|
| A finished analysis with its numbers | `GET /research/jobs/{job_id}` |
| The current template-written report, as a model to follow | `GET /research/reports/{report_id}` |

The job's `results` and `summary` are the packet. Each result row already has the correlation,
confidence interval, p-value, sample size and a plain sentence.

**Where it goes:** `research_reports.report_text`, with `model_id` set to the Gemma model name.
Keep `status = 'draft'`. The medical officer still has to approve it.

**Tables behind it:** `research_analyses`, `analysis_jobs`, `analysis_results`, `research_reports`.

---

## Log every call

Every time Gemma is called, write one row to `ai_inference_logs`:

| Column | What to put |
|---|---|
| `inference_id` | A new unique id |
| `simulation_run_id` | The run the request was for |
| `purpose` | `task_explanation`, `recovery_explanation` or `research_report` |
| `model_id`, `model_version` | Which Gemma model |
| `prompt_template_version` | A version label for your prompt, e.g. `task_v2` (bump it whenever the prompt changes) |
| `input_hash` | SHA-256 of the packet you sent |
| `output_hash` | SHA-256 of what came back |
| `status` | `succeeded`, `failed` or `rejected_by_check` |
| `latency_ms`, `created_at`, `error_code` | Timing and any error |

Store hashes, not the full text, in this table. The plan also lists two admin routes to build on
top of it: `/admin/ai-inferences` and `/admin/model-status`.

## Rules Gemma must not break

1. **Only choose from what it was given.** Astronauts must come from `allowed_astronauts`.
   Activities must come from the approved list. Check this in code after Gemma answers, and throw
   the answer away if it names anything else.
2. **Only use numbers from the packet.** If the answer contains a number that is not in the
   packet, reject it.
3. **Everything is a proposal.** The mission leader approves task plans. The medical officer
   approves recovery suggestions and reports. Gemma never sets a status to approved.
4. **No medical claims.** Say "below your usual" or "a quiet break is suggested". Never "you are
   unfit", "this will fix" or anything that sounds like a diagnosis.
5. **Fall back to the rule-based text.** Every recommendation already has a reason written by the
   rules. If Gemma is slow, offline or rejected, show that text instead.
6. **All data is synthetic.** Reports and explanations should not be presented as real findings.

## What "now" means

The system runs on mission time, not real time. The demo run `RUN-DEMO-001` starts on day 1, when
there is almost no data. Jump it forward first:

```
POST /api/v1/simulation/runs/RUN-DEMO-001/jump   {"mission_day": 46, "hour": 10}
```

Good days to test with: day 10 (AST-004 short sleep, AST-003 test dip) and day 46 (AST-003 and
AST-005 have several signals at once).

## Getting the backend running

See `README.md`. In short, from the `aegis_backend` folder:

```
pip install -r requirements.txt
python scripts/import_csvs.py --reset
python scripts/set_demo_passwords.py
uvicorn app.main:app --reload
```

Interactive docs for every endpoint: http://127.0.0.1:8000/docs

Logins are `mission_leader`, `researcher`, `medical_officer` and `crew1` to `crew5`. Passwords are
written to `demo_credentials.local.txt` by the password script.

## Where to put the code

Follow the existing layout: one new service file (for example `app/services/gemma_service.py`)
that builds packets, calls the model, checks the answer and logs it, plus a small route file in
`app/api/`. Services in this project never import FastAPI, so they can be tested directly.

## Not built yet (ask the backend owner)

* A single "evidence packet" endpoint for Job 1. Today you combine the calls in the Job 1 table
  yourself. Job 2 and Job 3 already come as one packet.
* The two admin routes for AI logs.
