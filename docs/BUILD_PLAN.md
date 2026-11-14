# AEGIS frontend build plan for Claude Code

One repo, one app, ten phases. Each phase ends with a gate: `npm run check` must pass and the test count must match before the next phase starts.

## Before Phase 0 (you, 5 minutes)

1. Create an empty repo folder `aegis-frontend` and open Claude Code in it.
2. Put this file at `docs/BUILD_PLAN.md`.
3. Put every blueprint you have into `docs/blueprints/` (the dashboard and architecture blueprint, the frontend engineering blueprint with the 49-table appendix, the Mission Mind document, the baseline programme, the preflight profiling and task assignment document).
4. Put the 49 CSV files into `data/csv/`.
5. If the backend developer has an OpenAPI file, put it at `docs/openapi.json`.

## How to run each phase

Paste this into Claude Code, changing only the number:

```
Read docs/BUILD_PLAN.md. Execute Phase N exactly as written, following the Global rules.
Do not start any later phase. When finished, run `npm run check`, then print the Build report
in the format the plan specifies.
```

Paste the build report back to Claude (chat) for review before starting the next phase.

---

## Global rules (apply to every phase)

1. **React displays and collects. The backend calculates.** No scoring, baseline, statistics, eligibility or scheduling logic in components or hooks. In mock mode, that logic lives only in the mock server layer (`src/mocks/`), never in UI code.
2. **Stack, fixed:** React 18 + TypeScript (strict) + Vite, Tailwind CSS, shadcn/ui, React Router, TanStack Query, Zustand (UI state only), Recharts, D3 (heatmaps and distributions only), Three.js + React Three Fiber + drei (body map), PixiJS (game rendering), Dexie (IndexedDB), vite-plugin-pwa, MSW (mock API), Vitest + Testing Library, Playwright (Phase 9 only).
3. **API:** every call goes through `src/api/` typed clients with the `/api/v1` prefix. `VITE_API_MODE=mock|live` switches between MSW handlers and the real FastAPI at `VITE_API_BASE_URL`. If `docs/openapi.json` exists, generate types from it; otherwise derive types from `docs/blueprints/` and the CSV column headers in `data/csv/`. Never invent a column that is not in the CSV headers.
4. **Mock data comes from the real CSVs.** A build script converts `data/csv/*.csv` to JSON fixtures in `src/mocks/fixtures/`. Do not hand-write fictional values where a CSV exists.
5. **Honest states everywhere.** Every data view has loading, empty, error and `No data` states. Missing sensor values show `No data`. Empty research tables show "No analysis has been run yet". Unapproved schedules are labelled "Draft, not approved". Certifications are labelled "Unverified demonstration data". A persistent "Synthetic demonstration data" badge appears in the header whenever the data source is synthetic.
6. **Science rules in the UI copy.** Never show one combined cognitive score or a "% healthy" number. Each cognitive domain keeps its own unit and chart. Never use causal wording for correlations; show sample size and uncertainty next to every statistic. Recovery activities are "supportive routines", never treatments. Measured and estimated values are always labelled as such.
7. **Design:** dark navy spacecraft console, restrained cyan accent, large measurement cards, readable charts. Status is always colour plus text plus icon. WCAG AA contrast. Keyboard reachable. Respect `prefers-reduced-motion`. Layout: permanent sidebar at 1024px and above, compact menu below; no horizontal scroll at 375px.
8. **Permissions:** route guards and menu items come from the role in the session. The UI must also handle a 403 from the backend gracefully. Mission leaders never see detailed cognitive scores or medical records, only operational readiness status.
9. **Tests:** Vitest + Testing Library, colocated as `*.test.ts(x)`. Each phase states the minimum number of new tests. Tests must assert behaviour, not snapshots.
10. **`npm run check`** = `tsc --noEmit` + `eslint .` + `vitest run` + `vite build`. All four must pass with zero errors and zero warnings promoted to errors.
11. **Scope discipline:** build only what the phase lists. Note anything you had to assume under "Deviations" in the build report. Do not refactor earlier phases unless a test fails.
12. **Build report format** (print at the end of every phase):

```
PHASE N BUILD REPORT
Files created/changed: <list>
New tests this phase: <number>  | Total tests: <number>  | Passing: <number>
npm run check: <PASS/FAIL + last 15 lines of output>
Routes added: <list>
API endpoints used (mock handlers added): <list>
Deviations and assumptions: <list or "none">
Known gaps: <list or "none">
How to see it: <route + demo account>
```

---

## Phase 0: Foundation, contracts and mock API

1. Scaffold Vite + React + TypeScript (strict). Add Tailwind, shadcn/ui (button, card, dialog, tabs, select, input, table, badge, tooltip, sheet, toast), ESLint, Prettier, Vitest, Testing Library, MSW.
2. Add the `check` script as defined in Global rule 10.
3. Create design tokens (navy surfaces, cyan accent, status colours for nominal, review and action, typography scale) as Tailwind theme extensions.
4. Read everything in `docs/blueprints/`. Write `docs/FRONTEND_CONTRACT.md`: every route, every API endpoint with method, request and response type, and which CSV tables feed it.
5. Write `scripts/csv-to-fixtures.ts` that converts all files in `data/csv/` to typed JSON fixtures. Generate `src/types/tables.ts` from the actual CSV headers.
6. Build `src/api/client.ts` (fetch wrapper, auth header, error normalisation, 401 and 403 handling) and one typed module per backend area: auth, astronauts, vitals, radiation, sleep, assessments, cognition, planning, recovery, research, simulation, missions.
7. Build MSW handlers for every endpoint in the contract, backed by the fixtures. All calculation that the real backend would do (scoring, baselines, schedule optimisation, statistics) is stubbed here and only here.
8. Add `VITE_API_MODE` switching and a visible "Mock API" badge in mock mode.
9. Shared primitives: `StatusBadge`, `MeasurementCard`, `DataState` (loading, empty, error, no-data), `SyntheticBadge`, `ChartFrame` (title, unit, source, sample size footer).

**Minimum new tests: 14** (API client error handling 3, mode switch 1, fixture loader 2, each shared primitive 2).
**Gate:** `npm run check` passes; `docs/FRONTEND_CONTRACT.md` exists.

## Phase 1: Authentication, roles and application shell

1. Login page using `POST /auth/login`. Five seeded demo accounts shown as quick-select cards in mock mode: Astronaut, Mission Planning Leader, Medical Researcher, Medical Officer, Mission Control Administrator.
2. Session store (token, user, role, astronaut id), persisted; logout.
3. `RequireRole` route guard; a 403 page; redirect to the role's home after login.
4. App shell: sidebar with role-specific menus, header with mission day (for example "Day 25 / 90"), mission clock, connection status (Offline, Syncing, Synced), active simulation run, active astronaut, and the synthetic data badge.
5. Role menus:
   - Astronaut: Overview, Health Monitoring, Body Map, Mission Mind, Cognitive Trends, My Schedule, Recovery and Sleep, Alerts.
   - Mission Planning Leader: Planner Overview, Task Pool, Crew Schedule, Recovery Planning, Planning Effectiveness.
   - Medical Researcher: Research Overview, Analyses, Cognition Comparison, Planning Effectiveness, Reports.
   - Medical Officer: Oversight, Assessment Programmes, Access Grants, Crew Assessments.
   - Mission Control Administrator: Mission State, Simulation, Events, Data Integrity, AI Status, Audit.
6. Placeholder page for every route, using `DataState`.
7. Mission state from `GET /missions/current/state`; the clock and status stay consistent across navigation.

**Minimum new tests: 14** (login success and failure 2, guard per role 5, menu per role 5, header state 2).

## Phase 2: Astronaut Health dashboard

1. Overview page: measurement cards for heart rate, HRV, SpO2, blood pressure, respiratory rate, body temperature, sleep duration, radiation dose rate, physical activity. Each card shows value, unit, measurement time, data source, quality status, and "Measured" or "Estimated".
2. Health Monitoring page: time-series chart per measure with range selector (24 h, 7 d, 30 d, mission); HRV against personal reference; sleep as daily bars plus a sleep timeline; radiation as dose-rate line and cumulative dose chart, kept as separate variables.
3. Daily readiness summary: battery-style visual that lists which factors are within the astronaut's reference range and which need review. No percentage of "health".
4. Cognitive snapshot: today's result per domain against the preflight reference, with a domain switcher (reaction time, attention, working memory, processing speed, reasoning, cognitive flexibility). Links to Cognitive Trends.
5. My Schedule: own tasks, assessments, exercise, breaks, meals and sleep, each with start time, duration, priority, workload category and completion status.
6. Recovery and Sleep: scheduled recovery activities and sleep protection windows, worded as supportive routines.
7. Alerts: rule-generated alerts from the backend, with sync state per item (stored locally, pending, synced).
8. Endpoints: `/astronauts/{id}/health/summary`, `/vitals/history`, `/radiation`, `/sleep`, `/astronauts/{id}/schedule`.

**Minimum new tests: 16.**

## Phase 3: Interactive body map

1. 3D body built procedurally in React Three Fiber from primitives (capsules, spheres), so no external model licence is needed. Selectable regions: head, chest, abdomen, left and right arm, left and right leg, plus a whole-body control. Orbit controls, hover highlight, keyboard selection through a region list.
2. Side panel per region: head (cognitive trends), chest (heart rate, ECG if present, respiratory rate, SpO2), abdomen (modelled organ dose where data exists), arms (wearable measurements), legs (movement and exercise), whole body (personal dosimetry and accumulated exposure).
3. Radiation overlay toggle with an explicit legend and scale, labelled "Modelled estimate" wherever the value is not a direct measurement.
4. SVG 2D fallback with the same regions and panel, used automatically when WebGL is unavailable or reduced motion is requested, and selectable manually.
5. Lazy-load the 3D bundle.

**Minimum new tests: 8** (region selection 2, panel content per region 3, fallback switch 2, legend labelling 1).

## Phase 4: Cognitive assessment engine, preflight tests and Mission Mind

### 4A: Engine and core battery
1. Shared trial engine (`src/features/assessment/engine/`): stimulus scheduling with randomised foreperiods, `performance.now()` timing, input capture (keyboard, pointer, touch), false-start and lapse detection, interruption detection (tab hidden, focus lost), trial records with timestamps, input device and test version.
2. Session flow: instructions, practice trials (recorded separately), test, completion. Sessions start with `POST /assessments/sessions`, trials post to `/assessments/sessions/{id}/trials`, finish with `/complete`. The UI displays the scores the backend returns; it does not compute them.
3. Offline queue: trials and session completions are written to Dexie first and flushed when the API is reachable.
4. Core tests: Psychomotor Vigilance Test, N-Back (2-back), Stroop colour-word.
5. Subjective state questionnaire (fatigue, sleepiness, perceived workload, sleep quality).
6. Preflight area: due sessions from `/assessments/due`, access gating (the start button is enabled only when the backend says the session is authorised and conditions are met), condition tag per session (morning, afternoon, night, before or after physical work, before or after mental work, weekly extended).
7. Completion screen: one score per assessment (for example median reaction time, working-memory accuracy, attention accuracy), never an overall grade.

**Minimum new tests: 20** (engine timing and false starts 6, session flow 4, offline queue 3, each test's trial logic 6, gating 1).

### 4B: Remaining tests and Mission Mind
1. Remaining tests: Symbol-Digit Matching, Mental Rotation, Task Switching, Logical Reasoning quiz.
2. Mission Mind daily game, rendered with PixiJS in a spacecraft-operations style. Five mini-games as themed skins over the same engine and the same scoring contracts as the preflight tests: Signal Response (vigilance), Memory Matrix (working memory, with an N-back mode), System Scanner (selective attention and visual search), Navigation Challenge (spatial reasoning), Command Switch (cognitive flexibility). The theme must not change stimulus timing or difficulty.
3. Daily mission hub: today's session status, 5 to 8 minute estimate, per-game progress, completion summary per domain, streak of completed days.
4. Baseline profile page from `/astronauts/{id}/baselines`: per-domain reference by condition, number of valid observations, variability, baseline version.

**Minimum new tests: 14.**

## Phase 5: Cognitive comparison

1. Cognitive Trends page using `/cognition/comparisons`: domain selector and time-range selector.
2. Line chart of daily inflight values against the matched preflight reference interval (matched by time of day and workload condition).
3. Bar chart comparing domains, each in its own unit and panel.
4. Calendar heatmap of assessment completion (D3).
5. Distribution plot of preflight against inflight variability (D3).
6. Detail table: daily scores, session condition, assessment quality, flagged-for-review marker with the wording "flagged for contextual review".
7. CSV export of the visible table when the role permits.

**Minimum new tests: 10.**

## Phase 6: Mission planning

1. Planner Overview: crew members, tasks submitted, pending review, scheduled hours; crew operational overview with role, availability, qualification status and assessment status ("Assessment current", "Review pending", "No current assessment"). No cognitive scores.
2. Task Pool using `/planning/task-sets`: list, filter, and a create/edit form with every field in the blueprint (title, description, category, priority, duration, physical workload, cognitive workload, required qualifications, crew required, deadline, dependencies, safety classification, equipment and location, scheduling constraints, fixed or flexible).
3. Demand profile per task: 0 to 5 bars for sustained attention, working memory, physical effort, time pressure, procedural complexity, labelled "Proposed by AI, not validated", editable by the leader.
4. Generate plan: `POST /planning/optimize`, with a pipeline progress view (task interpretation, constraint checks, optimisation, explanation).
5. Crew Schedule: timeline for all crew with precise start and end times and variable durations; filter by astronaut; conflicts, missing qualifications and unassigned tasks listed with reasons; Gemma's explanation shown beside each recommendation; alternative schedules selectable.
6. Manual override with a required reason; duty-limit comparison; protected sleep, exercise, meals and medical assessments shown as locked blocks.
7. Approve and publish: `POST /planning/schedules/{id}/approve`. Until approved, everything is labelled "Draft, not approved". Safety-critical assignments are never auto-applied.
8. Recovery Planning: `/planning/recovery/catalogue` and `/recovery/recommend`.
9. After publishing, the astronaut's My Schedule shows the approved plan.

**Minimum new tests: 16.**

## Phase 7: Medical research and planning effectiveness

1. Research Overview: participants, assessment sessions, mission days, data quality.
2. Analysis builder: pick variables from `/research/variables`, pick a question type (longitudinal, scatter, lagged comparison, domain heatmap, paired preflight and inflight, individual trajectories), filter by astronaut (pseudonymised), mission phase, date range, domain, measurement quality and radiation metric. Dose rate, accumulated dose and modelled organ dose stay separate.
3. Run with `POST /research/analyses`; poll or subscribe until complete; render charts from `/research/analyses/{id}/charts`.
4. Every chart shows sample size, uncertainty (confidence interval where provided) and a missing-data summary. Within-person view is the default; pooled view is optional.
5. Report panel: Gemma's plain-language summary from `/research/analyses/{id}/report`, labelled "AI-drafted from computed results", with the standing line that associations are exploratory.
6. Empty state when no analysis has been run.
7. Planning Effectiveness from `/research/planning-comparison`: dual-line cognitive-domain trends, grouped workload bars, workload heatmap by astronaut and day, scheduled against completed timeline, comparison table with effect estimates, uncertainty and sample sizes. Operational results and health hypotheses are in visibly separate sections. Mission leaders get the operational section only.

**Minimum new tests: 14.**

## Phase 8: Medical Officer and Mission Control

1. Medical Officer: create an assessment programme (protocol builder: collection period, conditions, tests per condition, frequency), assign it to astronauts, grant and revoke access, view completion and data quality per astronaut, review flagged results.
2. Mission Control Administrator: mission state, simulation runs (`/simulation/runs`: start, pause, playback speed, select run), predefined mission events (`/simulation/events`: trigger and view), data integrity summary, sync queue and audit log, AI status (model loaded, last response time, fallback state).
3. WebSocket client with reconnect and polling fallback for live mission state, simulation ticks and new alerts; the header and open dashboards update without reload.

**Minimum new tests: 12.**

## Phase 9: Offline, live backend, polish and demo

1. PWA: vite-plugin-pwa with app-shell caching; the app loads with the network off; Dexie queues (assessments, check-ins, overrides) flush on reconnect; sync status is accurate in the header.
2. Live mode pass: run against the real FastAPI with `VITE_API_MODE=live`; fix contract mismatches; update `docs/FRONTEND_CONTRACT.md`.
3. Accessibility pass (keyboard, focus order, labels, contrast) and responsive pass at 375, 768, 1280 and 1920.
4. Performance: route-level code splitting; 3D and PixiJS bundles lazy.
5. Demo mode: a "Demo story" control for the Mission Control Administrator that seeds a known state for the presentation.
6. Playwright end-to-end tests of the demo story: (a) astronaut completes a preflight session and a Mission Mind session and sees the comparison; (b) leader generates, overrides and approves a schedule and the astronaut sees it; (c) researcher runs an analysis and reads the report; (d) offline: complete a game with the network off, reconnect, see it sync.
7. `README.md`: setup, environment variables, demo accounts, how to switch mock and live.

**Minimum new tests: 8 unit + 4 end-to-end.**

---

## Running totals

| Phase | New tests | Running total |
|---|---|---|
| 0 | 14 | 14 |
| 1 | 14 | 28 |
| 2 | 16 | 44 |
| 3 | 8 | 52 |
| 4A | 20 | 72 |
| 4B | 14 | 86 |
| 5 | 10 | 96 |
| 6 | 16 | 112 |
| 7 | 14 | 126 |
| 8 | 12 | 138 |
| 9 | 8 + 4 e2e | 146 + 4 e2e |
