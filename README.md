# AEGIS — Autonomous Edge-Guided Intelligent Supervisor

Offline-first astronaut health, cognitive assessment, supportive routines, mission planning, and exploratory research for the NASA Space Apps Challenge. The existing React/TypeScript dashboards are preserved. FastAPI, SQLite, the mission CSV datasets, the constraint scheduler, and the Mind Companion service run together locally.

The four passwordless demo roles are **Astronaut**, **Mission Planning Leader**, **Impact Reviewer**, and **Medical Officer**. Role selection is a demonstration viewpoint, not secure authentication. Use synthetic data only. Task Readiness is an unvalidated demonstration indicator, not medical clearance.

## Run the integrated application

Requirements: Python 3.11+, Node.js **24.15+** (tested with 24.22.1), npm. Ollama is optional for numerical/operational features and required for genuine model generation.

From this repository's root on Linux/macOS:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r aegis_backend/requirements.txt pytest
npm ci
cp .env.example .env
python aegis_backend/scripts/import_csvs.py
# Explicit demo setup: optional; existing databases are never reset automatically.
python scripts/demo-clock.py --day 25 --hour 9
npm run dev:integrated
```

Open **http://localhost:5173**. The command starts Vite, FastAPI on **127.0.0.1:8010**, and Mind Companion on **127.0.0.1:8787**. Activate the Python virtual environment first, or set `AEGIS_PYTHON` to its interpreter. Stop all services with Ctrl+C. A child service's startup failure stops the other services.

The importer is safe to repeat. Do not use `--reset` on a database containing records you want to keep. The seed clock is initially day 1 at midnight, so early views correctly have no inflight readings. The demo-clock command intentionally positions the simulator; it does not manufacture measurements or assessment results.

The historical CSV assessment sessions are already completed. To take a new assessment in live mode, use **Medical Officer → Assessment Programmes** to create an inflight programme and assign it to an astronaut for the active mission date/hour. Its one-hour access window must include the mission clock. Switch to that astronaut and open **Mission Mind**. Practice trials are kept separately and never scored. The extended battery preserves the frontend's prototype definitions; no preflight baselines are invented for tests without baseline observations.

## Genuine Gemma inference

For an installed Ollama CLI, run the following once while online, and keep Ollama running:

```bash
ollama serve
# In another terminal:
ollama pull gemma3:4b
```

The shared `.env` configures `AEGIS_GEMMA_URL`, `AEGIS_GEMMA_MODEL`, `MIND_CHAT_MODEL_URL`, and `MIND_CHAT_MODEL`. Use a model identifier actually installed on your server. Restart the development command after configuration changes. Backend-only launches retain the backend's original defaults unless overridden.

Mind Companion supports Ollama (`MIND_CHAT_MODEL_API=ollama`, POST `/api/chat`) or compatible OpenAI chat completion servers (`openai`, POST `/v1/chat/completions`). Keys remain server-side. Its messages come only from genuine inference; configuration failures, timeouts, and outages return explicit errors. Conversation JSON persists under `server/mind-chat/data/` by default and is ignored by Git. Demo conversations are separated by astronaut; there is no Medical Officer access to this service's conversations.

Mission Planning's selected assignment includes **Ask Gemma to explain**. Research analyses include **Ask Gemma to draft report**. These call the original backend AI services, which verify generated text against stored decisions/results. They explicitly label rule/template text when the model is unavailable. Assignment, eligibility, and mathematical results remain the responsibility of the backend services, never the language model.

## Architecture and API routing

```text
React + TypeScript → shared typed API client → Vite/reverse proxy
  /api/v1/console/* → FastAPI dashboard adapters → existing scientific services → SQLite
  /api/v1/ai/*      → existing checked Gemma explanation/report services
  /api/v1/mind-chat/* → Node Mind Companion → Ollama/compatible model + conversation storage
  /api/v1/console/ws → mission-state messages
```

The explicit `/console` namespace adapts frontend composite responses without changing legacy API schemas. The main backend's original simulation, administration, audit, research, wellbeing, journal, and synchronization APIs remain available. No administrator dashboard was restored. The console currently follows `RUN-DEMO-001`; native simulator APIs still support independent runs.

See [API compatibility matrix](docs/integration/API_MATRIX.md), [integration contract](docs/integration/CONTRACT.md), [backend guide](aegis_backend/README.md), and [implementation report](docs/integration/IMPLEMENTATION_REPORT.md).

Important environment variables:

| Variable | Purpose |
|---|---|
| `VITE_API_MODE` | `mock` or `live`; integrated command uses live mode |
| `VITE_API_BASE_URL` | Blank for same-origin routing, or a full main API origin |
| `VITE_DEMO_MODE` | `true` enables the passwordless role selector |
| `AEGIS_AUTH_MODE` | `open` for this demo; token mode disables demo sessions |
| `AEGIS_BACKEND_PORT` / `AEGIS_BACKEND_URL` | Main service port / Vite proxy target; defaults to 8010 |
| `AEGIS_PYTHON` | Optional Python executable for the unified launcher |
| `AEGIS_DATABASE_PATH` / `AEGIS_SEED_DIR` | Optional database / validated seed directory overrides |
| `VITE_MIND_CHAT_URL` | Optional separate browser-accessible chat origin; blank uses proxy |
| `MIND_CHAT_PROXY_TARGET` | Chat development proxy target; defaults to 127.0.0.1:8787 |
| `MIND_CHAT_DEMO_AUTH` | Explicitly accept demo identity handles; not production authentication |
| `MIND_CHAT_MODEL_*` | Inference API, URL, model identifier, and optional server-side API key |

Process variables win over `.env`. The backend reads its own `.env`, then the shared root `.env` as defaults. The Node launcher and standalone chat command load the shared root `.env`.

## Data and persistence

Live mode imports the **49 validated CSV tables in `aegis_backend/data/seed`** with foreign-key, type, unit, and provenance checks. The frontend's `data/csv` copies are retained for mock demonstrations. Almost all CSV content agrees; frontend line-ending changes invalidate their recorded byte checksums, and metric definitions differ. The validated backend seed therefore supplies live mission records. No checksum verification was bypassed.

Fixed measurements are filtered against the mission clock. External reference radiation records never become crew dose measurements. Gy, mSv, dose rate, accumulated dose, and modelled organ estimates remain distinct. Blood pressure stays missing because no source measurement exists. Personal physiological references use observed first-week mission records and are labelled as prototype references, not preflight clinical norms.

Assignments, trials, scored results, schedules, supportive routines, task forms, and analysis jobs persist in SQLite. Optional prototype protocol and metric definitions are registered from the existing frontend battery; no synthetic baseline/results are added. Additional console tables store practice data, assessment metadata, programme collection windows, and proposed task-form fields.

## Mock mode and offline operation

```bash
npm run fixtures
npm run dev
```

Mock mode is explicit and shows its badge. `.env.development` selects mock mode and mission day 25. It does not silently take over when a live request fails. Mock state and local demonstration publications use the existing browser storage workflow.

Assessment trials/completions/check-ins, manual overrides, and supportive-routine publications use the persistent IndexedDB outbox. A network failure leaves an item pending. Routine publication displays **Pending Synchronization**, retries after reconnection, revalidates constraints, and surfaces conflicts. It is marked published only after the backend confirms persistence. Replay does not duplicate a routine and does not replay a leader's publication under another selected persona.

Live production builds register the PWA app-shell cache. Development mode does not provide a production service worker. Initial role selection and starting a new assessment still require a reachable backend. Pending records remain local until synchronization succeeds.

## Validation and builds

```bash
npm run fixtures
npm run typecheck
npm run lint
npm test
python -m pytest aegis_backend/tests -c aegis_backend/pyproject.toml
npm run build:live
npm run build
```

`build:live` excludes mock modules/CSV fixture chunks. Deploy its static `dist/` through a reverse proxy that routes the API paths above. `vite preview` alone is not a production API reverse proxy. To build explicitly for mock demonstrations, use `VITE_API_MODE=mock npm run build`.

Browser checks:

```bash
# If Playwright's browser is not already installed:
npx playwright install chromium
npm run e2e
# Starts an isolated live stack and temporary database automatically:
npm run e2e:live
```

For an existing system Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium`. The original suite uses a separate mock server on port 5174. Live tests start isolated services on ports 5175/8011/8788, use a temporary validated database at day 25, and remove it afterwards. Set `AEGIS_E2E_URL` only to target an intentionally disposable existing stack. Optional CP-SAT tests require `ortools`; the built-in constraint solver works without it.

## Current limits

- This is an open, synthetic-data demo, not a production clinical system or authenticated private service. Mind Companion's production token verifier is not implemented.
- Genuine model generation could not be verified in the integration environment because no Ollama service/model was available. Real service outages and conversation isolation were verified.
- Preflight sessions require a prelaunch clock/window. Existing historical sessions and personal baselines are retained. Extended tests without baseline observations report no comparison rather than invented reference values.
- Research currently supports valid inflight observations; unsupported mission-phase/quality filters are rejected explicitly. Domain filters must match the selected cognitive dependent variable. The six chart types use backend calculations and the stored job's cutoff. Associations are exploratory, not causal.
- Console endpoints use one mission/run. Multi-run operations remain available through the original backend APIs.
