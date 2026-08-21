# Mikro

Mikro is an OSM micropayments platform by Kaart. It manages mapper tasks,
payments, checklists, training, reports, scheduling, and team workflow.

- **Backend** — Flask + SQLAlchemy + PostgreSQL/PostGIS, in `backend/`
- **Frontend** — Next.js 16, React 19, Tailwind 4, Auth0, in `frontend/mikro-next/`

## Repository layout

| Path | What it is |
|---|---|
| `backend/` | The Flask API and its background worker |
| `frontend/mikro-next/` | **The active frontend.** All UI work happens here |
| `frontend/Mikro/` | Legacy frontend — **reference only.** Do not run, build, or install it |
| `comms/` | A separate shared notifications/email service that happens to live in this repo. It has its own database and its own README — see `comms/README.md` |
| `scripts/` | One-off operational scripts |

## Development

Environment files (`backend/.env`, `frontend/mikro-next/.env.local`) are not
committed. Ask the team for current values before first run.

### Backend

```bash
cd backend
source venv/bin/activate
pip3 install -r requirements.txt
flask run -p 5004 --reload
```

The worker handles background jobs — element analysis, transcription, task
syncs from TM4 and MapRoulette. Run it in a second terminal:

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
  Scoping helpers live in `backend/api/auth/team_scoping.py`.
- `User.id` is the Auth0 `sub` string, not an integer; every FK to a user is a
  `db.String(255)`.
- Migrations use Flask-Migrate/Alembic in `backend/migrations/`.

See `CLAUDE.md` for the fuller architecture tour.
