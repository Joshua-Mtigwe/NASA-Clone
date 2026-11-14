# AEGIS Mission Console (frontend)

React 18 + TypeScript frontend for AEGIS: astronaut health monitoring, cognitive assessment (preflight battery and the Mission Mind games), mission planning, medical research, medical oversight and mission control.

The frontend displays and collects. Every score, baseline, statistic, eligibility decision and schedule comes from the backend. In mock mode those calculations are stubbed in `src/mocks/` only.

All bundled data is **synthetic demonstration data**, generated from the 49 CSV tables in `data/csv/`. A badge in the header says so on every page.

## Setup

Requirements: Node.js 20 or later (developed on Node 24) and npm.

```bash
npm install
npm run fixtures      # converts data/csv/*.csv into src/mocks/fixtures/*.json and src/types/tables.ts
npm run dev           # http://localhost:5173 (mock mode, mission day 25)
```

If `data/csv/` only contains `AEGIS_49_Updated_CSV_Tables_Only.zip`, extract it in that folder first; `npm run fixtures` reads the `.csv` files. The fixtures are generated (gitignored); `npm run check` regenerates them automatically.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server in mock mode (MSW + CSV fixtures) |
| `npm run dev:live` | Dev server against the real FastAPI backend (`.env.live`) |
| `npm run check` | `tsc --noEmit` + `eslint . --max-warnings 0` + `vitest run` + `vite build` (runs `fixtures` first) |
| `npm test` | Unit and component tests (Vitest + Testing Library) |
| `npm run e2e` | Playwright end-to-end tests (starts the dev server on port 5174; run `npx playwright install chromium` once) |
| `npm run build` / `npm run preview` | Production build and local preview |
| `npm run format` | Prettier |

## Environment variables

| Variable | Values | Meaning |
|---|---|---|
| `VITE_API_MODE` | `mock` (default) or `live` | `mock`: MSW handlers backed by the CSV fixtures. `live`: the real backend. |
| `VITE_API_BASE_URL` | e.g. `http://localhost:8000` | Required in live mode. All calls go to `<base>/api/v1/...`; realtime uses `ws(s)://<base>/api/v1/ws?token=...`. |
| `VITE_MOCK_MISSION_DAY` | `1` to `90` | Mock mode only: puts the mission clock at 12:00 UTC on that day. `.env.development` sets 25. Unset = the clock in `simulation_runs.csv` (day 1, paused). |

Files: `.env.example` (template), `.env.development` (used by `npm run dev`), `.env.live` (used by `npm run dev:live`). Tests and production builds read neither of the last two.

## Switching between mock and live

- **Mock (default):** `npm run dev`. A **Mock API** badge is shown in the header and on the login page. Data lives in the browser's memory: a full page reload starts again from the CSVs. The mock behaves like an unreachable server when the browser is offline, so the offline queue can be demonstrated.
- **Live:** set `VITE_API_BASE_URL` in `.env.live` (or the environment), then `npm run dev:live`, or build with `VITE_API_MODE=live VITE_API_BASE_URL=... npm run build`. Live builds contain no mock code or fixtures, and they register the service worker (PWA) for offline app-shell loading.

The full API contract (every route, endpoint, request and response type, and source table) is in [`docs/FRONTEND_CONTRACT.md`](docs/FRONTEND_CONTRACT.md).

## Demo accounts (mock mode)

The login page shows one card per role. The password for every account is `demo`.

| Role | Username | Home |
|---|---|---|
| Astronaut | `crew1` (also `crew2`…`crew5`) | `/astronaut` |
| Mission Planning Leader | `mission_leader` | `/planner` |
| Medical Researcher | `researcher` | `/research` |
| Medical Officer | `medical_officer` | `/medical` |
| Mission Control Administrator | `mission_control` | `/control` |

`mission_control` is a mock-only seed: `roles.csv` and `users.csv` have no administrator. See `src/mocks/seeds.ts`.

## Demo story

Sign in as **Mission Control Administrator**, open **Mission State** and press **Start demo story**. This resets the mock to a known state: mission day 25 at 12:00 UTC, simulation paused, every change from the session discarded, and this device's offline queue cleared. The Playwright suite in `e2e/demo-story.spec.ts` walks through it:

1. The astronaut completes a preflight session and a Mission Mind game, then opens Cognitive Trends.
2. The leader generates a plan, overrides an assignment (a reason is required), approves it, and the astronaut sees the approved plan in My Schedule.
3. The researcher runs an analysis and reads the AI-drafted report.
4. Offline: a game is completed with the network off, then syncs on reconnect.

## Offline

Assessment trials, session completions, check-ins and schedule overrides are written to IndexedDB (Dexie) first. They are sent in order now, on reconnect, and every 30 s. The header shows **Offline**, **Syncing** (requests in flight or items queued) or **Synced**. In live builds the PWA service worker caches the app shell, so the app loads with the network off.

## Project layout

```
src/api/          typed clients, one per backend area, and the endpoint registry
src/app/          routes (lazy, one chunk per area), navigation, query client
src/components/   shadcn/ui primitives, shared primitives (DataState, ChartFrame, ...), charts
src/features/     auth, shell, health, bodymap, assessment, cognition, planning,
                  research, medical, control, realtime
src/mocks/        MSW handlers, mock-only seeds and stub calculations (compute/)
src/types/        tables.ts, generated from the CSV headers
scripts/          csv-to-fixtures
e2e/              Playwright tests
docs/             BUILD_PLAN.md, FRONTEND_CONTRACT.md
```

## Known limitations

- No real backend was available during the build, so the live-mode contract pass (build plan Phase 9, item 2) has not been run. Live mode is wired and builds, but every endpoint is so far verified only against the mock.
- Several fields the plan asks for have no CSV column; they are sent as proposed request fields and listed under "Open questions" in the contract.
- Stroop relies on ink colour by design.
