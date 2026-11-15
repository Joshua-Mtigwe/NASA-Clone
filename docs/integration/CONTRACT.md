# Integrated dashboard API contract

The frontend registry is `src/api/endpoints.ts`; request and response interfaces are in `src/api/types.ts`. `src/api/client.ts` routes dashboard endpoint keys to `/api/v1/console` in live mode, while genuine `mindChat.*` and `ai.*` services retain their own paths. Mock mode retains the original `/api/v1` MSW paths.

The backend adapters are `app/api/console.py` and `app/services/console_*.py`. They serialize data for the existing UI and call the original services for windows, scoring, baselines, eligibility, constraint optimization, schedule approval/publication, recovery evidence, and numerical research. The complete per-endpoint inventory and shape differences are in [API_MATRIX.md](API_MATRIX.md).

## Demo persona handshake

```bash
curl -s http://127.0.0.1:8010/api/v1/console/auth/demo-accounts
curl -s -X POST http://127.0.0.1:8010/api/v1/console/auth/demo-session \
  -H 'Content-Type: application/json' -d '{"username":"crew1"}'
curl -s http://127.0.0.1:8010/api/v1/console/astronauts/AST-001/health/summary \
  -H 'X-AEGIS-User: USR-001'
```

A demo session returns `access_token: mock-token.USR-001`, `token_type: bearer`, and a dashboard-shaped `user`. This handle is not a secure credential. The shared client sends the bearer handle for Mind Companion and `X-AEGIS-User` for the Python backend. Open mode still applies the acting role's access rules. In token mode demo accounts/session endpoints refuse access; the existing native token API remains unchanged.

## Persistence and invariants

- Measurement `from/to` filters and pagination operate on stored rows. `to` is capped at the active mission clock. A date-only `to` includes that day up to the clock.
- The console currently follows `RUN-DEMO-001`. Native simulation APIs retain their independent-run behavior. Explicit `scripts/demo-clock.py` changes the clock; reads never regenerate measurements.
- Raw sensor provenance/quality and units remain in row responses. The UI's current-vitals cards still render their existing icon/name/value/unit design. Missing blood pressure remains `null`.
- `/astronauts/:id/readiness/summary` supplies current measurements, observed personal-reference bounds, cognitive-baseline comparisons, and current operational records. It does not replace the existing frontend readiness formula or authorize medical clearance.
- Assessment sessions use backend ownership/window validation. `practice` requests persist separately from scored test trials. The server recomputes correctness/lapses/false starts. Identical numbered-trial retries do not duplicate records; changed retries conflict. Completing an already completed session returns its stored results.
- Extended-test scoring is opt-in for the console and ports the existing frontend prototype definitions. Legacy callers keep their original supported-protocol rules. No missing baseline or clinical validity is inferred.
- Medical Officer programmes persist collection windows, templates, assignments, grants, and revocations. Preflight/inflight restrictions remain tied to mission dates.
- The constraint engine produces drafts. Console approval validates critical-task confirmations, calls the original safety recheck, approves, then publishes. Astronaut timetables use the same persisted version/assignment records. Repeated approval does not write duplicate calendar entries.
- Manual overrides are draft-only, require a reason, preserve minimum task duration and date, and revalidate the original eligibility/dependency/conflict/workload rules. Validation failure rolls back the edit.
- Supportive-routine publication is separate from the retained medically reviewed recovery workflow. A Mission Planning Leader can publish an approved non-clinical catalogue activity. A serialized transaction promotes an existing draft or creates its persisted schedule/booking, checks overlaps and mission time, and makes duplicate retries return the stored publication. `dry_run` writes nothing. An unavailable slot returns `unable_to_schedule` with reasons and conflicts.
- Scheduled future activities may appear in a timetable. Future measurement records cannot appear in current/historical health responses. These are different data contracts.
- Research jobs store their parameters/results. Six chart views use that job's cutoff and participant selection. Within-person charts centre each participant's values; correlation confidence intervals are calculated numerically. Lagged comparisons use the previous day's independent variable. Unsupported phase/quality filters fail explicitly. Chart/report participant identifiers are pseudonyms.
- Template reports and scheduler text are labelled by their actual source. Genuine AI explanation/report requests call the existing checked Gemma APIs, which return `source=gemma` only for a checked model response and explicitly report rule/template fallback.
- Mind Companion has separate persistent conversation storage and real inference transport. A model outage is an explicit error, never a generated mock reply. Another astronaut receives no conversation contents; no route grants the Medical Officer chat access.

## Offline publication

IndexedDB holds `{kind:'publish',sessionId:recommendationId,payload,ownerUserId,createdAt,attempts,status,lastError}`. Enqueue occurs after a network failure. UI status is **Pending Synchronization**. Online events and the periodic queue worker retry the stored payload under its original leader persona. The backend rechecks constraints and prevents duplicates. A refused slot remains a surfaced conflict; the leader can discard the queued request and choose another slot.

The existing outbox also handles trial batches, completions, check-ins, and schedule overrides. Successful replay invalidates dashboard queries. App-shell offline loading is provided by the live production PWA build; dev-server previews do not substitute for service-worker tests.

## Error responses

Original Python service failures use `{error,message,details}`. FastAPI schema errors use `{detail:[{loc,msg,type,...}]}`. The API client normalizes both into `ApiError`, retaining HTTP status and field errors. Invalid JSON/relationships produce validation errors. Permission errors are never silently converted to empty data or mock responses.

## Remaining compatibility boundaries

Removed administrator, login/password, and Astronaut Alerts interfaces are not restored. Their unused frontend registry entries do not imply corresponding console implementations. Use the original backend APIs for administration, simulation, auditing, detailed offline-sync conflict management, and additional mission runs.

The generic console dispatcher is omitted from OpenAPI's catch-all route declaration. Concrete schemas are documented here, in the matrix and TypeScript interfaces, and exercised in `tests/api/test_console_api.py`. The retained original backend routes continue to expose their normal OpenAPI documentation at `/docs`.
