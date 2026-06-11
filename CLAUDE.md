# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mikro is an OSM micropayments platform by Kaart. It manages mapper tasks, payments, checklists, training, reports, and team workflow.

## Tech Stack

- **Backend**: Python 3, Flask, SQLAlchemy, PostgreSQL with PostGIS
- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, Auth0 (`frontend/mikro-next/`)

## Development

### Backend
```bash
cd backend
source venv/bin/activate
pip3 install -r requirements.txt
flask run -p 5004 --reload
```

In a separate terminal, start the worker (handles background jobs like element analysis, transcription, task syncs):
```bash
cd backend
source venv/bin/activate
python -m api.worker
```

### Frontend
```bash
cd frontend/mikro-next
npm install
npm run dev
```

### Format & lint
```bash
# Backend
black .
flake8

# Frontend
npm run prettier
```

### Tests
```bash
# Backend — all tests
python -m pytest tests/

# Single file
python -m pytest tests/test_team_scoping.py

# Single test
python -m pytest tests/test_team_scoping.py::test_name
```

## Architecture

### Auth Flow

Auth0 JWT authentication is validated in a `before_request` hook in `backend/app.py`. `api/auth/auth.py` validates tokens against Auth0's JWKS endpoint (1-hour cache). The decoded payload is stored in `g.current_user`; the User row is loaded into `g.user` and checked by decorators (`@requires_auth`, `@requires_admin`, `@requires_team_admin_or_above` in `api/utils/decorators.py`).

Custom Auth0 claims use the `mikro/` namespace (e.g. `mikro/org_id`, `mikro/roles`) to avoid collision with native Auth0 fields — set by Auth0 Actions in the post-login rule.

OSM account linking is a separate optional OAuth 2.0 flow (`/api/osm/start` → `/api/osm/callback`) that uses HMAC-signed state tokens to prevent CSRF. It stores `osm_id` / `osm_username` / `osm_verified` on the User model.

### Frontend → Backend Request Flow

The frontend proxies all `/api/*` calls through a Next.js route handler at `src/app/backend/[...path]/route.ts`. That handler:
1. Calls `auth0.getAccessToken()` (triggers refresh-token rotation if stale)
2. Forwards the request to Flask with `Authorization: Bearer <token>`

`src/lib/fetchWithAuth.ts` is the client-side fetch wrapper; it catches 401s and redirects to `/auth/login`. A heartbeat call to `/auth/heartbeat` fires every 15 minutes to keep the session alive.

### API View Pattern

All backend routes use Flask `MethodView`. Routes are registered via `app.add_url_rule(...)` in `app.py`. Each view class handles GET/POST/PUT/DELETE; within a method, sub-paths are dispatched internally (e.g. `"fetch_user_role"` → `_fetch_user_role()`). Webhook routes at `/api/webhook/*` skip JWT auth and validate an HMAC signature (`MIKRO_WEBHOOK_SECRET`) instead.

### Role & Team Scoping

Role hierarchy: `user < validator < team_admin < org_admin < super_admin`.

Team scoping logic lives in `api/auth/team_scoping.py`. Team admins see only their managed teams' data; org admins see all data within `org_id`. The key helpers are `managed_team_ids_for(user)`, `team_admin_can_access_user(user, target_user)`, and `is_org_admin_or_above(user)`.

### Data Model Notes

- **User.id** is the Auth0 `sub` string (e.g. `"auth0|123abc"`), not an integer. All FK columns referencing users are `db.String(255)`.
- **Task attribution** stores `mapped_by` / `validated_by` as OSM username strings, not FK to User. This preserves historical data if a user later unlinks their OSM account.
- **Deactivation has two mechanisms**: `is_active=False` blocks login immediately; `deleted_date` is a soft-delete for audit trail. A user can have `is_active=False` and no `deleted_date`.
- **Task sources**: Tasks come from TM4 (Tasking Manager) or MapRoulette, tracked via a `source` column. Background sync jobs pull from each source's API.
- **WeeklyReport.sections** is a JSON blob (stored as `db.Text`), allowing flexible section structure without schema migrations.
- **Compensation model** (`compensation_model` column on User) is nullable for users created before its introduction; backend treats `NULL` as per-task.

### Frontend Structure

- Authenticated routes live under `src/app/(authenticated)/` — the layout there enforces the auth guard, syncs the user from backend, and detects role.
- Public routes: `/auth/`, `/backend/` (proxy), `/api/authorize` (invite), `/unauthorized`, `/no-org`, `/wrong-org`.
- `src/lib/syncUser.ts` is called on every layout mount to refresh role/permissions from the backend.

## Important Notes

- The active frontend is `frontend/mikro-next/`. That is the current implementation.
- Backend API routes are exposed under `/api/<resource>/<path>`.
- Local frontend default port is 3000; backend default dev port is 5004.
- The backend supports database migrations via Flask-Migrate and Alembic in `backend/migrations/`.
- `backend/api/database/core.py` contains all SQLAlchemy models (~1,550 lines).
- `backend/api/views/` contains ~24 view modules covering every domain resource.
