# Mikro

Mikro is an OSM micropayments platform by Kaart. It manages mapper tasks,
payments, time tracking, training, reports, scheduling, and team workflow.

- **Backend** — Flask + SQLAlchemy + PostgreSQL/PostGIS, in `backend/`
- **Frontend** — Next.js 16, React 19, Tailwind 4, Auth0, in `frontend/mikro-next/`

## Repository layout

| Path | What it is |
|---|---|
| `backend/` | The Flask API and its background worker |
| `frontend/mikro-next/` | **The active frontend.** All UI work happens here |
| `frontend/Mikro/` | Legacy frontend — **reference only.** Do not run, build, or install it |
| `comms/` | A separate shared notifications/email service that happens to live in this repo. It has its own database, its own deploy branch, and its own README — see `comms/README.md` |
| `scripts/` | One-off operational scripts |
| `.do/app.yaml` | **Stale — documentation only.** Not applied on push; the live DigitalOcean spec is hand-managed and is the source of truth. See [Deployment](#deployment) |
| `PROJECT_HANDOFF.md` | Full onboarding/maintenance report — deploy topology, integrations, landmines, open risks |

## Development

Environment files (`backend/.env`, `backend/.env.local`,
`frontend/mikro-next/.env.local`) are not committed. Ask the team for current
values before first run.

`frontend/mikro-next/.env.example` lists the frontend variables, but it is
**incomplete** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_KEY` (used by
the map page's realtime presence and layers) and `COMMS_PROXY_URL` are consumed
by the code and missing from it. There is no `backend/.env.example`;
`backend/api/config.py` is the authoritative list of every backend variable.

### Backend

```bash
cd backend
source venv/bin/activate
pip3 install -r requirements.txt
flask run -p 5004 --reload
```

The worker handles background jobs — task syncs from TM4 and MapRoulette,
element analysis, MapRoulette metadata backfill, and watchlist refresh. It
polls the `sync_jobs` table every 5 seconds and self-schedules the nightly run
at 07:00 UTC. Run it in a second terminal:

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

Defaults to port 3000; the backend dev port is 5004.

## Deployment

**Read this before pushing anything.** This repo contains four independently
deployed components, each building from **its own branch** on DigitalOcean App
Platform (all with `deploy_on_push`):

| Component | DO component name | Branch | `source_dir` |
|---|---|---|---|
| Flask API | `mikro-backend` | `master` | `backend` |
| Next.js frontend | `mikro-frontend` | `master` | `frontend/mikro-next` |
| Background worker | `mikro-backend2` | `worker-release` | `backend` |
| Comms service | `comms` | `comms-release` | `comms` |

The consequences are not obvious and have caused real incidents:

- **Merging to `master` does not update the worker.** The worker keeps running
  its old code until `worker-release` is advanced. If a change's effect lives
  in a nightly job, it is not live until then.
- **The worker shares `source_dir: backend` with the API**, so worker code *and
  everything it imports* (models, `api/utils/`, `api/services/`) must be present
  on `worker-release`.
- **Comms changes go to `comms-release` only.** Never merge anything under
  `comms/` into `master` — that triggers a live Mikro redeploy and re-couples
  two products that were deliberately split. Don't land on master and then
  fast-forward `comms-release` either; go straight to `comms-release`.
- **`.do/app.yaml` is stale and not authoritative** — it names the worker
  component `mikro-worker`, which is wrong. Verify against the live DO spec.
- **Mikro is live during the workday.** Deploy schema, migration, and auth-path
  changes off-hours.

```bash
git push origin master           # → mikro-backend + mikro-frontend
git push origin worker-release   # → mikro-backend2 (the worker)
git push origin comms-release    # → comms
```

Migrations apply automatically on deploy — the `Procfile` declares
`release: flask db upgrade`.

There is no scripted rollback. Prefer redeploying a previous successful
deployment from the component's **Deployments** tab in the DO dashboard; failing
that, `git revert` and push. Migrations do not roll back automatically — write a
forward-fix rather than relying on `downgrade()`.

### Health checks

```bash
curl https://<app-host>/api/health
curl https://<app-host>/mikro-comms/health   # returns a `db` field
```

Every auth decision point logs a parseable line — `grep AUTH-TRACE` in the
`mikro-backend` logs when someone reports a login problem.

## Linting / formatting

```bash
# Backend (from backend/)
black .
flake8

# Frontend (from frontend/mikro-next/)
npm run lint          # eslint
npx prettier --write .
```

There is no `npm run prettier` script — call prettier directly, as above.

## Tests

```bash
# Backend (from backend/)
python -m pytest tests/
python -m pytest tests/test_team_scoping.py            # one file
python -m pytest tests/test_team_scoping.py::test_name # one test

# Frontend (from frontend/mikro-next/)
npm test                                               # vitest
```

### Backend test database

The DB-backed tests run against a real PostgreSQL database whose name contains
`test` (default `mikro_test`), and **that database must have PostGIS
installed** — the models declare a `geometry` column, so `create_all` fails
without it:

```
sqlalchemy.exc.ProgrammingError: type "geometry" does not exist
```

The suite reads `TESTING_DB_HOST`, `TESTING_DB_PORT`, `TESTING_DB_USER` and
`TESTING_DB_PASSWORD` first, falling back to the shared `POSTGRES_*` variables.
Use the `TESTING_DB_*` names to point the tests at a cluster that has PostGIS,
without editing `.env.local`:

```bash
TESTING_DB_PORT=5433 python -m pytest tests/
```

They exist because importing the app runs `load_dotenv(".env.local",
override=True)`, which would otherwise clobber an inline `POSTGRES_PORT=…`.

## Architecture notes

- Auth0 JWTs are validated in a `before_request` hook in `backend/app.py`;
  custom claims use the `mikro/` namespace.
- The frontend proxies every `/api/*` call through a Next route handler at
  `src/app/backend/[...path]/route.ts`, which attaches the access token.
- Backend routes are Flask `MethodView` classes registered in `app.py`; each
  dispatches sub-paths internally (e.g. `"fetch_user_role"` → `_fetch_user_role`).
- Role hierarchy: `user < validator < team_admin < org_admin < super_admin`.
  Org admin is stored in the database as the string `admin`, not `org_admin`.
  Scoping helpers live in `backend/api/auth/team_scoping.py`. Note that
  `@requires_team_admin_or_above` only gates entry — **team-admin endpoints must
  apply the scoping helpers themselves inside the handler**, or they leak
  cross-team data.
- `User.id` is the Auth0 `sub` string, not an integer; every FK to a user is a
  `db.String(255)`. There is also a separate `auth0_sub` column, and that is
  what the auth hook looks users up by — keep both in sync.
- Multi-tenancy is by Auth0 Organization, held in `User.org_id`.
- The Auth0 post-login **Actions** that set the `mikro/` claims live in the
  Auth0 dashboard, not in this repo.

## Migrations

Flask-Migrate / Alembic, in `backend/migrations/versions/`. They apply
automatically on deploy.

**Always verify the chain before writing one** — a colliding revision id broke a
production deploy once:

```bash
cd backend
grep -h "^revision = " migrations/versions/*.py | sort -u   # id must not already exist
flask db heads && flask db current                          # these must agree
flask db migrate -m "message" && flask db upgrade
```

Confirm `down_revision` points at a revision that actually exists. Glancing at
recent filenames is not enough.

Any database you migrate against **must have PostGIS installed** — the models
declare a `geometry` column.

---

See `CLAUDE.md` for the fuller architecture tour, and `PROJECT_HANDOFF.md` for
deploy topology, external integrations, known landmines, and open risks.
