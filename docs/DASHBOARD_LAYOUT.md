# AEGIS Dashboard Layout Reference

What every role's dashboard shows today: page by page, section by section, the data in each section, where it comes from, and how it is drawn. Use it as the baseline when you propose changes to the data or the visualizations.

Snapshot of branch `frontend` at commit `7df08fa` (Frontend v1.0).

How to read the page entries:

- **Layout** is the grid at desktop width. Every page stacks to a single column on mobile.
- **Data** names the fields shown and the hook or API call that supplies them.
- **Visualization** is the component used to draw it.
- **Edit in** is the file to change.

---

## 1. Shared shell (all roles)

### 1.1 Frame

```
┌───────────────┬──────────────────────────────────────────────────────────────┐
│ AEGIS (brand) │ HEADER: Mission day · Mission clock · Simulation · Connection │
│ ROLE LABEL    │         · Active astronaut · [Synthetic][Mock API] · user ·   │
│               │         Sign out                                             │
│ Sidebar menu  ├──────────────────────────────────────────────────────────────┤
│ (per role)    │ PAGE HEADER: Title · description · page actions (right)       │
│               │ ──────────────────────────────────────────────────────────── │
│               │ Page body (sections stacked, 24 px gap)                       │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

- **Sidebar.** 15 rem wide and sticky. Shown at `lg` width and above. Below that it becomes a slide-in sheet opened from a hamburger button in the header. One list drives both the menu items and the allowed routes: `NAV` in [src/app/navigation.ts](../src/app/navigation.ts).
- **Header.** Sticky. Edit in [src/features/shell/Header.tsx](../src/features/shell/Header.tsx).

| Header item | Data | Source |
|---|---|---|
| Mission day | `Day {mission_day} / {mission_length_days}` | `useMissionState()` |
| Mission clock | `mission_time` (UTC timestamp) | `useMissionState()` |
| Simulation | `run_name · status`, or "No simulation run" | `mission_state.simulation_run` |
| Connection indicator | Realtime and online status | `useConnectionStatus()` |
| Active astronaut | Astronaut: their own ID (fixed). Medical Officer and Medical Researcher: a crew dropdown. Planner and Admin: "All crew" | [ActiveAstronaut.tsx](../src/features/shell/ActiveAstronaut.tsx). Selectable roles are listed in `CAN_SELECT_ASTRONAUT` in [roles.ts](../src/app/roles.ts) |
| Synthetic badge / Mock API badge | `data_mode`, `is_synthetic`, mock-API flag | mission state and env |
| User | `username · role label`, plus a Sign out button | session |

### 1.2 Building blocks used on every page

| Component | What it looks like | Used for |
|---|---|---|
| `PageHeader` | Title, a one-line description, and an actions slot on the right | Every page |
| `DataState` | Wraps each section with one of five states: loading, error (with Retry), empty, no-data, ready | Every data section |
| `MeasurementCard` | Label, Measured/Estimated tag, a large value with its unit, a Time/Source/Quality list, and a status badge | Astronaut Overview |
| `ChartFrame` | Card with a title and "Unit: x". The footer shows `Source`, `n =` and an optional uncertainty line | Every chart |
| `StatusBadge` | Status pill. The vocabulary is `nominal`, `review`, `action`, `no_data` | Everywhere |
| `TimeSeriesChart` | Recharts line chart. Optional shaded reference band. Includes an accessible data table | Health vitals, radiation |
| `DailyBarChart` | Thin daily columns, max 24 px wide | Sleep duration, activity |
| Tables | Bordered, scroll horizontally on small screens, navy header row | Crew, oversight, lineage, audit, etc. |

Chart colours live in [src/components/charts/chartTheme.ts](../src/components/charts/chartTheme.ts): `series`, `seriesAlt`, `grid`, `surface`, and `participantSeries` for categories. The colour ramps are dark-surface sequential ramps: dose (violet), completion and workload (teal).

### 1.3 Rules built into the current design

Each of these rules is enforced in the code. A change that crosses one needs an explicit decision.

1. **No combined score.** Each cognitive domain stays in its own unit. The readiness "battery" has no percentage.
2. **Nothing after the mission clock.** Every query and filter stops at `mission_time`.
3. **Status comes from the backend.** Cards and charts never compute their own reference status.
4. **Measured vs Estimated/Modelled** is labelled on every value that has a provenance.
5. **The Mission Planning Leader never sees cognitive results.** It only sees operational readiness. The health-hypotheses section is hidden for this role.
6. **Out-of-reference results are worded "Flagged for contextual review"**, never as a diagnosis.

---

## 2. Astronaut

Home: `/astronaut`. The pages show the signed-in astronaut's own data. Most of them get it through `useAstronautContext()` in [src/features/health/hooks.ts](../src/features/health/hooks.ts).

Menu: Overview · Health Monitoring · Body Map · Mission Mind · Cognitive Trends · My Schedule · Recovery and Sleep · Alerts. There are also sub-pages: Preflight sessions, Baseline profile, and the assessment session runners.

### 2.1 Overview (`/astronaut`)

Edit in [OverviewPage.tsx](../src/features/health/OverviewPage.tsx).

```
[ Daily readiness summary ─────────────────────────────── full width ]
[ Latest measurements: 9 cards, grid 1 / 2 (sm) / 3 (xl) columns     ]
[ Cognitive snapshot ─────────────────────────────────── full width ]
```

**A. Daily readiness summary.** A card from `useReadinessSummary()`. Edit in [ReadinessSummaryCard.tsx](../src/features/health/ReadinessSummaryCard.tsx).

- "As of" timestamp.
- **Battery bar:** one segment per factor, sorted into groups. Green = within personal reference, amber = needs review, grey = no data. Each segment has an icon and a tooltip.
- **Three columns**, one per group. Each lists its factors as `factor label · value unit · reference lower–upper`.
- **Footer, operational readiness:** assessment completion status · operational eligibility · workload limit (min), plus an "Unverified demonstration data" badge.

**B. Latest measurements.** Nine `MeasurementCard`s from `useHealthSummary()`. Order and labels come from `MEASURES` and `MEASURE_ORDER` in [config.ts](../src/features/health/config.ts):

Heart rate · HRV (RMSSD) · SpO2 · Blood pressure · Respiratory rate · Body temperature · Sleep duration · Radiation dose rate · Physical activity.

Each card shows the value, unit, measured time, `source_type · source_id`, quality, the Measured/Estimated tag, and a status badge. The badge comes from the matching readiness factor: within reference → nominal, outside reference → review.

**C. Cognitive snapshot.** A card. Edit in [CognitiveSnapshot.tsx](../src/features/health/CognitiveSnapshot.tsx).

- **Domain toggle** with six buttons: Reaction time (vigilance) · Attention · Working memory · Processing speed · Reasoning · Cognitive flexibility.
- **Body:** domain · metric · latest date and mission day. Then a large inflight value with its unit and a "Measured" tag. Then the preflight reference (lower–upper, n, condition, baseline version, matching method). Then a badge: Within preflight reference, or Flagged for contextual review.
- **Data:** `useComparisons()` over the last 7 days. It shows the latest result at or before the mission clock.
- **Link:** "View cognitive trends" goes to Cognitive Trends.

### 2.2 Health Monitoring (`/astronaut/health`)

Edit in [HealthMonitoringPage.tsx](../src/features/health/HealthMonitoringPage.tsx).

- **Page action:** time-range toggle: 24 h · 7 d (default) · 30 d · Mission.
- **Vitals grid:** 2 columns at `xl`. One `ChartFrame` + `TimeSeriesChart` per sensor series (`SENSOR_SERIES`): heart rate, HRV RMSSD, SpO2, respiratory rate, body temperature. Data comes from `useVitalsHistory()` (`sensor_readings`).
  - Only HRV draws the **shaded personal reference band**, from `useVitalsReference()`. Its footer shows the reference range, n and method.
- **Blood pressure:** a placeholder card that always shows "No data: no blood pressure readings are recorded."
- **Sleep section** (2 columns):
  - *Sleep duration per night:* `DailyBarChart` of `total_sleep_minutes` per night.
  - *Sleep timeline:* rows running noon to noon, one per night, last 14 nights. Each bar spans sleep start to sleep end. Edit in [SleepTimeline.tsx](../src/features/health/SleepTimeline.tsx).
- **Radiation section** (2 columns). Dose rate and accumulated dose are deliberately kept in separate charts.
  - *Dose rate:* line chart of `radiation_readings.dose_rate`.
  - *Accumulated dose:* line chart of `accumulated_dose`.
- **Physical activity:** *Activity duration per day*, a `DailyBarChart` of `activity_records.duration_minutes`.

### 2.3 Body Map (`/astronaut/body-map`)

Edit in [src/features/bodymap/](../src/features/bodymap/).

- **Page actions:** a 3D/2D view toggle and a "Radiation overlay" toggle. 3D is disabled when the browser has no WebGL. 2D is chosen automatically when reduced motion is requested.
- **Layout:** three columns at `lg`: `12rem | flexible | up to 22rem`.

```
[ Region list ] [ Body figure (3D Three.js or 2D SVG) + overlay legend ] [ Region panel ]
```

- **Region list:** Whole body, Head, Chest, Abdomen, Left/Right arm, Left/Right leg. Defined in [regions.ts](../src/features/bodymap/regions.ts).
- **Figure:** click a region to select it. With the overlay on, each region is coloured on a four-step violet ramp (`DOSE_RAMP`) by its modelled organ dose (`organ_dose_estimates`). A region with no estimate of its own shows the whole-body estimate. The legend shows the scale from 0 to the maximum, the "Modelled estimate" tag, the model version and the uncertainty.
- **Region panel**, by region. Edit in [RegionPanel.tsx](../src/features/bodymap/RegionPanel.tsx):

| Region | Rows shown | Source |
|---|---|---|
| Whole body | Dose rate, accumulated exposure (Measured); modelled whole-body dose (Estimated) with model and uncertainty | `useRadiation()` (launch → now), overlay |
| Head | Latest value per cognitive domain (6) with a reference badge | `useComparisons()` (7 d) |
| Chest | Heart rate, respiratory rate, SpO2, ECG (sensor configured or "No data") | `useHealthSummary()`, `useSensors()` |
| Abdomen | Modelled organ dose for the region, or "No data" | overlay |
| Arms | Every wearable reading (HR, HRV, SpO2, RR, temperature). Sensor placement is not recorded | `useHealthSummary()` |
| Legs | Activity list for the last 7 days: type, minutes, intensity, average HR, perceived exertion | `useActivity()` |

### 2.4 Mission Mind (`/astronaut/mission-mind`)

Edit in [MissionMindPage.tsx](../src/features/assessment/MissionMindPage.tsx).

- **Page actions:** links to Preflight sessions and Baseline profile.
- **Today card** (3 columns):
  - "Today · date": `X of Y complete`
  - Time estimate: `About N min`
  - Streak: `N days in a row`
- **Games grid** (1 / 2 / 3 columns). One card per game: name, today's state (Done today / Today / Not scheduled today), `skill · N sessions completed`, and a **Play** button or the blocking reason. Below the grid sits an optional **Daily check-in** button for the SURVEY protocol.
- **Today by domain** (2 columns): one small card per result completed today, `Domain: label value`. Footnote: "There is no combined score."
- **Data:** `useMissionMindSummary()` and `useDueAssessments()`. Game names and skills come from `MISSION_MIND_GAMES` in [registry.ts](../src/features/assessment/battery/registry.ts).

**Sub-pages:**

- **Preflight sessions** (`/astronaut/preflight`): a list of due preflight sessions. Each row shows the name, about N min, version, a condition tag, Ready / Conditions not met / Waiting for access, the blocking reason, and a Start button. A banner shows how many offline items are waiting to sync.
- **Baseline profile** (`/astronaut/baseline`): one card per domain, each with a table of `Condition · Median · Reference range · SD · n · Version/date`. Data: `useBaselines()`.
- **Session runners** (`/astronaut/preflight/:id`, `/astronaut/mission-mind/:id`): a full-screen test runner. Mission Mind uses a PixiJS mission skin. The flow is stimulus, then response pad, then a "Session complete" summary. Edit in [AssessmentRunner.tsx](../src/features/assessment/AssessmentRunner.tsx) and [MissionStage.tsx](../src/features/assessment/MissionStage.tsx).

### 2.5 Cognitive Trends (`/astronaut/cognitive-trends`)

Edit in [CognitiveTrendsPage.tsx](../src/features/cognition/CognitiveTrendsPage.tsx). The Medical Researcher reuses this page as *Cognition Comparison*.

- **Controls row:** six domain buttons, plus a range toggle: 7 d · 30 d (default) · Mission.
- **"{Domain} over time":** a full-width `ChartFrame` holding [TrendChart.tsx](../src/features/cognition/TrendChart.tsx). It draws the daily inflight value as a line over the matched preflight reference interval (shaded area). Flagged days are marked with hollow diamonds. The footer says how many of the days in range are flagged for review.
- **Domains compared:** [DomainBars.tsx](../src/features/cognition/DomainBars.tsx), grid 1 / 2 / 3 columns. Each domain gets a small bar chart with two bars: preflight reference median and inflight median. The footer shows n and the SD for each phase.
- **Two-column row:**
  - *Assessment completion:* a calendar heatmap of sessions per day, Monday-first weeks, teal ramp. Edit in [CompletionHeatmap.tsx](../src/features/cognition/CompletionHeatmap.tsx).
  - *Preflight vs inflight variability:* a strip plot of every preflight and inflight value for the domain, with jittered dots. Edit in [DistributionPlot.tsx](../src/features/cognition/DistributionPlot.tsx).
- **Daily detail table:** Date · Day · Result · Preflight reference · Condition/method · Quality (valid trials, sessions) · Review. **Export CSV** is available to the Astronaut, Medical Researcher and Medical Officer roles.
- **Data:** `cognitionApi.comparisons()` for the selected domain and `cognitionApi.summary()` for all domains.

### 2.6 My Schedule (`/astronaut/schedule`)

Edit in [SchedulePage.tsx](../src/features/health/SchedulePage.tsx).

- **Page action:** day navigator (◀ date ▶). Today is labelled "Today".
- **Body:** a vertical list of item cards. Each card shows the kind (Task / Supportive routine / Assessment / Exercise / Sleep) and the title, with a "Draft, not approved" badge where it applies. Below that is a five-field row: Start–End UTC · Duration · Priority · Workload category · Status.
- **Footnote:** meals and breaks are not provided yet.
- **Data:** `useSchedule(astronautId, date)`.

### 2.7 Recovery and Sleep (`/astronaut/recovery`)

Edit in [RecoverySleepPage.tsx](../src/features/health/RecoverySleepPage.tsx).

- **Supportive routines, next 7 days** (2 columns): a card per scheduled routine with the activity name, category · intensity, completion status, date and time, and a description. Data: `useScheduledRecovery()` and `useRecoveryCatalogue()`.
- **Sleep protection windows:** always the empty state ("source does not provide them yet").
- **Recent sleep, last 7 days:** a row per night with the time span, minutes asleep, efficiency %, awakenings, quality score, a Measured tag, and a quality badge when the night is not valid.

### 2.8 Alerts (`/astronaut/alerts`)

Edit in [AlertsPage.tsx](../src/features/health/AlertsPage.tsx).

- **Body:** a list of alert cards. Each shows the severity badge and title, with the sync state on the right (Stored locally / Pending sync / Synced). Below that: the detail text, then `triggered_at · rule id · source table`.
- **Data:** `useAlerts()`.

---

## 3. Mission Planning Leader

Home: `/planner`. This role works across the whole crew and sees **no cognitive scores**. Hooks live in [src/features/planning/hooks.ts](../src/features/planning/hooks.ts).

Menu: Planner Overview · Task Pool · Crew Schedule · Recovery Planning · Planning Effectiveness.

### 3.1 Planner Overview (`/planner`)

Edit in [PlannerOverviewPage.tsx](../src/features/planning/PlannerOverviewPage.tsx).

- **Page action:** day navigator.
- **KPI row** (1 / 2 / 4 columns): Crew members · Tasks submitted · Pending review · Scheduled time. Data: `usePlannerOverview(date)`.
- **Crew operational overview table:** Astronaut · Role · Availability (eligibility, plus limit min and valid-until date) · Qualifications (codes, with an "Unverified" badge) · Assessment status (Assessment current / Review pending / No current assessment). Data: `useCrewOverview()`.

### 3.2 Task Pool (`/planner/tasks`)

Edit in [TaskPoolPage.tsx](../src/features/planning/TaskPoolPage.tsx).

- **Page actions:** day navigator and a **New task** button.
- **Filters:** a category select (technical, maintenance, research, medical) and a title search.
- **Task cards** (2 columns at `lg`). Each shows the title, then `id · category · priority · duration · crew count · due time`, then `certification · safety class · dependencies · flexibility`, and an Edit button.
  - **Demand profile:** five rows of 0–5 segment bars: Sustained attention, Working memory, Physical effort, Time pressure, Procedural complexity. Each is labelled "Proposed by AI, not validated" or "Edited by the mission leader". Edit in [DemandProfile.tsx](../src/features/planning/DemandProfile.tsx) and [demand.ts](../src/features/planning/demand.ts).
- **Dialog:** the task create/edit form. Edit in [TaskForm.tsx](../src/features/planning/TaskForm.tsx).

### 3.3 Crew Schedule (`/planner/schedule`)

Edit in [CrewSchedulePage.tsx](../src/features/planning/CrewSchedulePage.tsx).

```
[ Toolbar: Schedule version ▾ · Astronaut filter ▾ ·            [Generate plan] ]
[ Pipeline stages (while generating): 4 status badges                           ]
[ Approved / Draft badge                                                         ]
[ Gantt timeline: one row per astronaut, 06:00–22:00 UTC                         ]
[ Issues list                       ] [ Duty limits table                       ]
[ Selected assignment: AI explanation + manual override form                     ]
[ Approve and publish: safety-critical confirmations + button                    ]
```

- **Timeline:** clickable task bars, plus dashed "locked" blocks for sleep, exercise, assessments and routines. Conflicting bars are highlighted, and a legend sits below. Edit in [ScheduleTimeline.tsx](../src/features/planning/ScheduleTimeline.tsx).
- **Pipeline stages:** Task interpretation → Constraint checks → Optimisation → Explanation. The page polls every 300 ms.
- **Issues:** Conflict / Missing qualification / Unassigned task, each with the task, the astronaut and the reason.
- **Duty limits table:** Astronaut · Scheduled · Limit · Status (Within limit / Over limit / No data).
- **Selected assignment:** title, astronaut and time, then the "Explanation from Gemma (AI)" box with the model and constraint-check status. Below that is the override form: astronaut, start, end, reason (required). Overrides are queued offline.

### 3.4 Recovery Planning (`/planner/recovery`)

Edit in [RecoveryPlanningPage.tsx](../src/features/planning/RecoveryPlanningPage.tsx).

- **Control card:** astronaut select (defaults to `AST-001`) · current mission day · **Get recommendations**.
- **Recommended supportive routines:** a ranked list. Each item shows #rank, the name, category · minutes, `Reason · algorithm version`, and Approved / Awaiting medical review.
- **Catalogue** (1 / 2 / 3 columns): a card per activity with the name, category · minutes · intensity, and a description.

### 3.5 Planning Effectiveness (`/planner/effectiveness`)

This page is shared with the Medical Researcher (§4.4). The Planning Leader sees only the **Operational results** block. The health-hypotheses block is hidden for this role.

---

## 4. Medical Researcher

Home: `/research`. Participants are pseudonymised. The header's active-astronaut dropdown applies to **Cognition Comparison** only. Hooks live in [src/features/research/hooks.ts](../src/features/research/hooks.ts).

Menu: Research Overview · Analyses · Cognition Comparison · Planning Effectiveness · Reports. Sub-page: Analysis detail.

### 4.1 Research Overview (`/research`)

Edit in [ResearchOverviewPage.tsx](../src/features/research/ResearchOverviewPage.tsx).

- **Page action:** New analysis.
- **Banner badge:** "Synthetic demonstration data: findings are exploratory".
- **KPI row** (3 columns): Participants · Assessment sessions · Mission days with data.
- **Data quality card:** a plain text list of session counts per quality status, and the participant IDs. There is no chart.
- **Data:** `useResearchOverview()`.

### 4.2 Analyses (`/research/analyses`)

Edit in [AnalysesPage.tsx](../src/features/research/AnalysesPage.tsx).

- **Analysis builder form** (2 columns):

| Field | Options / default |
|---|---|
| Question type | Longitudinal trend, Scatter (association), Lagged comparison, Domain heatmap, Paired preflight and inflight, Individual trajectories |
| Research question | Free text |
| Independent / dependent variable | From `useVariables()`, grouped into "Measures" and "Radiation metric (kept separate)". Default: total sleep minutes → median reaction time |
| From / To | Dates. Default 2027-03-01 → 2027-05-29 (hard-coded) |
| Mission phase | Any, Preflight, Inflight |
| Cognitive domain | Any, plus **only 3 domains** (vigilance, attention, working memory) |
| Measurement quality | Any, Valid only |
| Participants | Checkboxes. None selected means all |

- **Analyses list:** a link per analysis with `id · type · Y by X · date range`.

### 4.3 Analysis detail (`/research/analyses/:id`)

Edit in [AnalysisPage.tsx](../src/features/research/AnalysisPage.tsx) and [AnalysisChartView.tsx](../src/features/research/AnalysisChartView.tsx).

- **Header:** the research question, then `type · Y by X · dates`.
- **View toggle:** Within-person (values centred per person) or Pooled. Next to it: an "Exploratory, synthetic data" badge.
- **Charts:** stacked and drawn according to `chart_type`:
  - `scatter`: points coloured by participant.
  - `line`: one line per participant, or one for the crew.
  - `bar`: preflight median vs inflight median per participant.
  - `heatmap`: domain heatmap.
- Each chart footer reports the effect estimate `r` with its 95% CI, or "Descriptive only", and the number of observations missing.
- **Report card:** AI-drafted text, then `model · status · time · not yet reviewed`. A fixed line follows: "Associations are exploratory and are not evidence of cause."

### 4.4 Planning Effectiveness (`/research/effectiveness`)

Edit in [PlanningEffectivenessPage.tsx](../src/features/research/PlanningEffectivenessPage.tsx). Data: `usePlanningComparison()`.

**Operational results** (teal-bordered block). The Planning Leader sees this block too.

- *Workload by astronaut and day:* SVG heatmap with astronauts as rows and dates as columns, coloured by minutes scheduled (teal ramp).
- Two-column row:
  - *Workload by task category:* grouped bar chart. Astronauts on the x-axis, one bar per category (technical, maintenance, research, medical).
  - *Scheduled vs completed tasks:* two-line chart per day. When there are no completions yet, the footer says that `actual_end` is empty in the data.
- *Planning method comparison* table: Period · Method · Metric · Estimate · Evaluation.

**Health hypotheses (exploratory)** (amber-bordered block, hidden from the Planning Leader):

- A three-column grid with one line chart per domain: crew inflight median per day vs preflight reference median.
- *Health comparison* table, with the same columns as the method comparison.

### 4.5 Cognition Comparison (`/research/cognition`)

The same page as the Astronaut's Cognitive Trends (§2.5), titled "Cognition Comparison". It shows the astronaut chosen in the header dropdown and includes CSV export.

### 4.6 Reports (`/research/reports`)

Edit in [ReportsPage.tsx](../src/features/research/ReportsPage.tsx).

- **Body:** a list of report cards, one for each analysis that has a drafted report. Each card shows the title (linking to the analysis), an "AI-drafted from computed results" tag, and a two-line excerpt.

---

## 5. Medical Officer

Home: `/medical`. Every page here is in [MedicalPages.tsx](../src/features/medical/MedicalPages.tsx). The header has an active-astronaut dropdown, but **none of these pages read it**. Oversight is crew-wide, and Crew Assessments has its own filter.

Menu: Oversight · Assessment Programmes · Access Grants · Crew Assessments.

### 5.1 Oversight (`/medical`)

- **Table** (the only content on the page): Astronaut · Completed (`X of Y sessions`) · Valid quality (`X of completed`) · Flagged for contextual review. The flagged column links to "N to review", which opens Crew Assessments filtered to that astronaut.
- **Data:** `assessmentsApi.oversight()`. There are no charts or KPIs.

### 5.2 Assessment Programmes (`/medical/programmes`)

- **Protocol builder form** (3 columns): Programme name · Mission phase · Frequency (Daily / Weekly / Once) · Collection start · Collection end · Local hour (UTC).
- **Conditions fieldset:** a checkbox per condition from `CONDITION_LABELS`. Ticking one reveals checkboxes for its tests (the protocols). **Create programme** makes one schedule template per condition.
- **Assign to astronauts card** (appears after creation): crew checkboxes, a first session date, and **Assign**.
- **Existing programmes:** a row per template showing `id · phase · condition · recurrence at HH:00 · protocol ids · description`.

### 5.3 Access Grants (`/medical/access`)

- **"Grant access until (UTC)"** datetime input. It defaults to the end of the current mission day.
- **Waiting for access table:** Astronaut · Test · Condition · Scheduled · **Grant**.
- **Access granted table:** the same columns plus the expiry time, with **Revoke**.

### 5.4 Crew Assessments (`/medical/assessments`)

- **Astronaut filter:** All crew, or one astronaut.
- **Body:** a list of flagged results, newest first. Each row shows the "flagged for contextual review" badge, the astronaut, the date, `Result X vs preflight Y (Z% difference)`, then the matching method and comparison ID.
- **Data:** `assessmentsApi.flagged()`. There is no chart.

---

## 6. Mission Control Administrator

Home: `/control`. Every page here is in [ControlPages.tsx](../src/features/control/ControlPages.tsx). The role works across the whole crew.

Menu: Mission State · Simulation · Events · Data Integrity · AI Status · Audit.

### 6.1 Mission State (`/control`)

- **State card** (3-column definition grid): Mission (name, status) · Mission day · Mission clock · Simulation run (name, status, speed) · Data mode · Live updates (realtime status).
- **Demo story card:** a **Start demo story** button. It resets the mission to day 25, 12:00 UTC, paused, and clears the local queue. Edit in [DemoStoryControl.tsx](../src/features/control/DemoStoryControl.tsx).

### 6.2 Simulation (`/control/simulation`)

- **Run list:** a card per run with the name, `id · clock · data mode`, a Running/Paused badge, Active run or **Select**, **Start** or **Pause**, and a speed input with **Apply speed**.
- **Create run card:** a name input and **Create run**.

### 6.3 Events (`/control/events`)

- **Triggered this session:** a list of manually triggered events (title, day, timestamp).
- **Predefined events:** rows sorted by mission day. Each shows `Day N · title · type · severity`, the description, and a **Trigger** button.

### 6.4 Data Integrity (`/control/integrity`)

- **Sync queue card:** items waiting and failed on this device, plus the server's sync-event and conflict counts.
- **Lineage table:** Table (CSV file) · Rows · Classification · Sources · Provenance.

### 6.5 AI Status (`/control/ai`)

- **Status card** (3 columns): Model loaded · Last response time (ms) · Fallback (Active (rule-based) / Not active). The card also shows a note when no inferences have been logged. The page does not show `recent_inferences`, even when the list has entries.

### 6.6 Audit (`/control/audit`)

- **Table:** the last 100 entries. Columns: Time · User · Action · Entity · Result · Summary.

---

## 7. Data visibility by role

| Data | Astronaut | Planning Leader | Med. Researcher | Med. Officer | Admin |
|---|---|---|---|---|---|
| Own vitals, sleep, radiation, activity | ✔ | – | – | – | – |
| Body map and modelled organ dose | ✔ | – | – | – | – |
| Readiness factors (personal reference) | ✔ | – | – | – | – |
| Operational readiness (eligibility, workload limit) | ✔ (own) | ✔ (crew) | – | – | – |
| Cognitive results vs preflight | ✔ (own) | ✘ by rule | ✔ (selected astronaut) | flagged only | – |
| Assessment completion / quality | own (Mission Mind, heatmap) | currency badge only | session counts | ✔ per astronaut | – |
| Schedules / tasks | own day | ✔ full editing | workload analytics | – | – |
| Recovery routines | own schedule | catalogue + recommendations | – | – | – |
| Planning effectiveness, operational | – | ✔ | ✔ | – | – |
| Planning effectiveness, health hypotheses | – | ✘ hidden | ✔ | – | – |
| Exploratory analyses / AI reports | – | – | ✔ | – | – |
| Protocols, assignments, access | own due sessions | – | – | ✔ | – |
| Mission clock, simulation, events, lineage, AI, audit | header only | header only | header only | header only | ✔ |

---

## 8. Known gaps and placeholders

These are worth deciding on when you plan changes.

| Where | Current behaviour |
|---|---|
| Health Monitoring: blood pressure | Fixed "No data" card. No sensor is configured |
| Recovery and Sleep: sleep protection windows | Always empty. The source does not provide them |
| My Schedule | Meals and breaks are not listed |
| Body Map: chest | ECG shows only whether a sensor is configured. No waveform or value |
| Body Map: arms | Lists every wearable reading, because sensor placement is not recorded |
| Analyses builder | The domain filter offers only 3 of the 6 domains. The date range default is hard-coded |
| Recovery Planning | The astronaut select defaults to a hard-coded `AST-001` |
| Research Overview: data quality | Text list only. No chart |
| Medical Officer pages | Table and list only, with no charts. They ignore the header's active-astronaut selector |
| Oversight | No trend over time, only cumulative counts |
| AI Status | `recent_inferences` is fetched but never listed |
| Planning Effectiveness: adherence | The completed line is flat until `actual_end` is populated |

---

## 9. Proposing a change

To keep proposals unambiguous, write each change against the page and section IDs above (for example "§2.1 B, Latest measurements"), and cover four things:

1. **Data:** what to add, remove or replace. Name the field, table or endpoint, if it is known.
2. **Visualization:** current form → proposed form (for example "list → bar chart", "card grid 3-col → 4-col").
3. **Roles affected.** Check §7 and the rules in §1.3. Any change to who sees cognitive data is a policy decision.
4. **Backend impact.** Say whether the data already exists in the API or mocks, or needs a new endpoint. Mock data lives in [src/mocks/](../src/mocks/) and the CSVs in [data/csv/](../data/csv/).
