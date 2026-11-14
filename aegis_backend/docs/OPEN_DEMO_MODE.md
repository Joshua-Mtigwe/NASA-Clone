# Open demo mode: what changes for the frontend

The backend now runs **without sign-in** by default, so the project can be submitted as open source
and judges can use it straight away. There are no accounts to create, no passwords and no tokens.
Instead, the app lets the user pick **which persona to view the mission as**. This replaces the
login page.

## 1. Replace the login page with a persona picker

```
GET /api/v1/personas          (no header needed)
```
```json
{"auth_mode": "open", "header": "X-AEGIS-User", "default_persona": "USR-006",
 "personas": [
   {"user_id": "USR-001", "username": "crew1", "role_name": "astronaut", "astronaut_id": "AST-001",
    "mission_id": "MIS-001", "label": "Astronaut AST-001 (Flight Engineer, Systems)"},
   {"user_id": "USR-006", "username": "mission_leader", "role_name": "mission_leader", "label": "Mission leader"},
   ...]}
```

Show these as a "View as" menu, for example in the top bar. Use the `label` as the text and keep the
`user_id`. Store the choice in `localStorage` so it survives a refresh. Switching persona needs no
round trip: just send the new header from then on and refetch.

Show a small note next to the menu: *"Demo personas: choose a viewpoint. This is not a login."*

## 2. Send the persona on every request

Replace `Authorization: Bearer <token>` with:

```
X-AEGIS-User: USR-006
```

Either the `user_id` or the `username` works. If the header is missing, the backend acts as the
mission leader.

In `src/api/client.ts`, this is the only change to the fetch wrapper: set `X-AEGIS-User` from the
stored persona instead of the token.

## 3. What the status codes mean now

| Code | Before (login) | Now (open mode) |
|---|---|---|
| 401 | Not signed in / session ended → go to login | **Unknown or deactivated persona** → clear the stored persona and show the picker |
| 403 | Your role can't do this | Unchanged: this persona's role can't do this. Show the 403 page, or hide the button for this role. |

There is no session expiry and no logout, because there is nothing to sign out of.

## 4. Remove these screens and calls

| Remove | Why |
|---|---|
| Login page, `POST /auth/login` | Returns 404 in open mode |
| Logout, `POST /auth/logout` | 404 |
| "Change password", `POST /auth/change-password` | 404 |
| Admin "reset password", `POST /admin/users/{id}/reset-password` | 404 |
| Any "temporary password" display | `POST /admin/users` no longer returns one; it creates a new persona |

`GET /auth/me` still works and returns the current persona plus `permitted_astronaut_ids`. Use it to
build the role-based menu exactly as before.

## 5. Live clock WebSocket

```
ws://<host>/api/v1/ws/simulation/RUN-DEMO-001              (acts as the mission leader)
ws://<host>/api/v1/ws/simulation/RUN-DEMO-001?as_user=crew1
```
No token. An unknown persona closes the connection immediately.

## 6. Add a "Reset demo" button (mission leader persona only)

```
POST /api/v1/demo/reset
```
This puts every table back to the 49 seed CSVs. Visitors to a shared online demo can change data
(start simulations, approve plans, take tests), and this returns it to a clean state. It takes a few
seconds; show a spinner and then reload the app's data. It returns 403 for other personas, and 404 if the
server has `AEGIS_ALLOW_DEMO_RESET=false`.

## 7. Nothing else changes

All other endpoints, request bodies and responses are the same as in `FRONTEND_HANDOFF.md`. The
role rules still apply to whichever persona is chosen:
* an astronaut sees only their own data;
* only the mission leader approves and publishes plans;
* the medical officer reviews reports and approves recovery.

Showing these differences as you switch personas is the best way to demonstrate the project.

Mock mode (MSW) should mirror this: accept `X-AEGIS-User`, and drop the login handlers.
