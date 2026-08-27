# Mikro — Project Handoff Report

**Repository:** `KaartGroup/Mikro` (github.com/KaartGroup/Mikro)
**Audit date:** 2026-08-27 · master @ `d466f972f`
**Audience:** the engineer taking over Mikro. Assumes no prior exposure.

This document covers what Mikro is, how to run it, how it is deployed, what it
talks to, what is currently in flight, and the non-obvious landmines that are
not discoverable from the code. Read §3 (Deploy topology) and §12 (Landmines)
before you push anything.

---

## 1. What Mikro is

Mikro is Kaart's internal platform for managing OpenStreetMap mapping work and
paying the people who do it. It is a live, production system with real users
during the workday.

It covers:

| Domain | What it does |
|---|---|
| **Tasks** | Syncs mapping/validation tasks from Tasking Manager 4 (TM4) and MapRoulette; attributes them to mappers and validators |
| **Payments** | Per-task ("micropayment"), hourly, and project-based compensation; payment cycles, payment requests, reimbursements |
| **Time tracking** | Clock in/out, activity categories and subcategories, adjustments, long-session detection, payroll hours |
| **Projects** | Project records synced/created from TM4 & MapRoulette, assignment, teams, regions, countries |
| **Reports** | Editing stats, changeset heatmaps, element analysis, Mapillary stats, timekeeping; plus a configurable "Reports v2" layout builder |
| **Training** | Per-project training modules, questions, completion tracking |
| **Teams & orgs** | Multi-tenant by Auth0 organization; team-admin scoping |
| **Scheduling** | Recurring weekly availability + date exceptions |
| **Watchlists** | "Punks" and "Friends" — OSM users whose changesets are monitored |
| **Comms** | Notifications and broadcast email — **a separate product** (see §3) |

Scale: ~986 commits, ~16.6k lines of backend view code, ~50.6k lines of
frontend TS/TSX, 70 Alembic migrations, 50+ database tables.

---

## 2. Day 1 — getting it running

### 2.1 What you need before you start

Ask the team for these; none are in the repo:

- `backend/.env` and `backend/.env.local` values (DB creds, Auth0, TM4 token…)
- `frontend/mikro-next/.env.local` values (Auth0 app creds)
- DigitalOcean team access (App Platform + managed Postgres + Spaces)
- Auth0 tenant access (the Kaart tenant)
- GitHub access to `KaartGroup/Mikro`
- Trello board access (board ID `64fa56eb0834a60d8dc94c7c`, trello.com/b/M7B9xiZu)

### 2.2 Backend

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip3 install -r requirements.txt
flask run -p 5004 --reload
```

### 2.3 Worker (separate terminal)

```bash
cd backend
source venv/bin/activate
python -m api.worker
```

### 2.4 Frontend

```bash
cd frontend/mikro-next
npm install
npm run dev          # http://localhost:3000
```

> **Important:** `frontend/Mikro/` is the **legacy** React frontend. It is
> reference material only. Never run, build, or `npm install` it. All UI work
> happens in `frontend/mikro-next/`.

### 2.5 A note on "local backend"

In practice the previous developer ran the **frontend against the live/staging
Flask API** rather than a local Flask instance, because the database is a
managed DigitalOcean Postgres with PostGIS and no local seed/fixture pipeline
exists. Running Flask locally works, but you need a Postgres+PostGIS database
with the schema migrated and enough data to be useful. Point
`FLASK_BACKEND_URL` in `frontend/mikro-next/.env.local` at whichever backend
you want the proxy to hit.

**Recommended first improvement:** a seeded local database (docker-compose with
PostGIS + a fixture loader). Its absence is the single biggest onboarding
friction point in this project.

---

## 3. Deploy topology — READ THIS FIRST

This is the highest-risk area of the project and the least discoverable from
the code.

There are **three independently deployed things** in this one repo, each
deploying from **its own branch**:

| Thing | DO App Platform component | Deploys from branch | `source_dir` |
|---|---|---|---|
| Flask API | `mikro-backend` | **`master`** | `backend` |
| Next.js frontend | `mikro-frontend` | **`master`** | `frontend/mikro-next` |
| Background worker | **`mikro-backend2`** | **`worker-release`** | `backend` |
| Comms service | `comms` | **`comms-release`** | `comms` |

All four use `deploy_on_push`. The DO app is `plankton-app-vsfmr` (nyc region);
the comms component is publicly routed at `/mikro-comms`.

### 3.1 The rules that follow from this

1. **Merging to `master` does NOT update the worker.** The worker keeps running
   its old code until `worker-release` is advanced and DO redeploys
   `mikro-backend2`. If a feature's effect lives in a nightly job, it is not
   live until `worker-release` carries it.
2. **The worker shares `source_dir: backend` with the API.** So worker code
   *and everything it imports* (models, `api/utils/*`, services) must be
   present on `worker-release`.
3. **Comms changes go to `comms-release` ONLY.** Never merge anything under
   `comms/` into `master` — that triggers a live Mikro redeploy and re-couples
   two products that were deliberately split. Do not "land on master then
   fast-forward `comms-release`" either; go straight to `comms-release`.
4. **`.do/app.yaml` in this repo is documentation only.** It is **stale** and
   is *not* applied on push. The live DO spec is hand-managed in the dashboard
   and is the source of truth. Notably the repo yaml calls the worker component
   `mikro-worker`; the real component is `mikro-backend2`. Do not
   `doctl apps update --spec` from it — you would overwrite dashboard-set
   secrets.
5. **Mikro is live during the workday.** Schema/migration/auth-path changes
   should be deployed off-hours and with explicit sign-off.

### 3.2 Current branch state (as of this audit)

```
master          d466f972f   2026-08-21
worker-release  4cab1d482   2026-06-16   →  74 commits BEHIND master
comms-release   7b5ab6c69   2026-06-15   →  144 behind master, 9 ahead
```

**The worker in production is running code from 2026-06-16.** Everything merged
to master since then that touches `api/worker/`, the models, or shared utils is
*not* running in the worker. Before you advance `worker-release`, diff it
against master and check what 74 commits of model/schema drift will mean for
the nightly jobs. This is the first thing to triage.

`comms-release` being 9 ahead of master is expected and correct — comms work
never lands on master.

### 3.3 Release process (Mikro API + frontend)

```bash
git checkout -b feature/trello-{card-id}-{brief-name}
# ...implement, test locally...
git commit -m "Message"                 # no Co-Authored-By lines
git checkout master && git merge feature/...
git push origin master                  # ← this deploys. Off-hours for risky changes.
```

Migrations run automatically on deploy: the `Procfile` declares
`release: flask db upgrade`.

### 3.4 Rollback

There is no scripted rollback. Options, in order of preference:

1. DO App Platform → the component → **Deployments** tab → redeploy a previous
   successful deployment. Fastest, no git history churn.
2. `git revert <sha> && git push origin master` — triggers a fresh deploy.
3. **Migrations do not roll back automatically.** If a bad migration shipped,
   write a forward-fix migration; do not rely on `downgrade()` (many are
   auto-generated stubs and untested).

---

## 4. Repository map

```
Mikro/
├── backend/                    Flask API + background worker
│   ├── app.py                  App factory; ALL routes registered here
│   ├── api/
│   │   ├── auth/               JWT validation, team scoping, pay visibility
│   │   ├── config.py           All env-var config classes
│   │   ├── database/core.py    ALL SQLAlchemy models (~1,758 lines, 50+ tables)
│   │   ├── views/              ~27 MethodView modules — one per domain
│   │   ├── services/           Business logic extracted out of views
│   │   ├── time_tracking/      Time-entry queries/service/presenter/scope
│   │   ├── worker/             Background worker: main loop + jobs/
│   │   ├── utils/              Decorators, adiff analyzer, changeset fetcher, tz
│   │   ├── comms_client.py     HMAC client → comms service
│   │   └── ai.py               Claude-backed translate helper
│   ├── migrations/versions/    70 Alembic migrations
│   ├── tests/                  562 test functions, pytest
│   └── scripts/                One-off adiff/MapRoulette scripts
├── frontend/mikro-next/        THE ACTIVE FRONTEND (Next.js 16, React 19)
│   └── src/
│       ├── app/(authenticated) Auth-guarded route group
│       ├── app/backend/[...path]/route.ts   ← the API proxy
│       ├── components/         136 components
│       ├── lib/                Client helpers (fetchWithAuth, exports, auth0)
│       └── middleware.ts       Session/route guard
├── frontend/Mikro/             LEGACY — reference only, never run
├── comms/                      Separate notifications/email service (own DB)
├── scripts/                    Operational scripts (DO Spaces CORS fix)
├── .do/app.yaml                STALE — documentation only
├── .claude/                    Implementation plans (see §11)
├── CLAUDE.md / README.md       Architecture tour + dev commands
```

---

## 5. Architecture

### 5.1 Request flow

```
Browser
  └─> Next.js middleware (src/middleware.ts)
        · Auth0 session check; redirects to /auth/logout on missing/expired token
  └─> Next route handler  /backend/[...path]/route.ts
        · auth0.getAccessToken()  (triggers refresh-token rotation if stale)
        · forwards to  FLASK_BACKEND_URL/api/<path>  with Authorization: Bearer
        · streams body through (preserves multipart), passes CSV/PDF through raw
  └─> Flask  before_request → api.auth.authenticate_request()
        · validates JWT against Auth0 JWKS (1h in-memory cache)
        · g.current_user = decoded payload;  g.user = User row
  └─> MethodView.get/post/... → internal sub-path dispatch → handler
```

**Client-side:** `src/lib/fetchWithAuth.ts` wraps fetch, catches 401s and
redirects to `/auth/login`. A heartbeat hits `/auth/heartbeat` every 15 minutes
to keep the session alive.

### 5.2 Auth bypasses (paths that skip JWT validation)

In `api/auth/auth.py::authenticate_request`:

- `OPTIONS` preflight
- `/health`, `/api/health`
- `/api/osm/callback` — OSM redirects here, no bearer token exists yet
- `/api/webhook/*` — uses **HMAC** signature verification instead
  (`MIKRO_WEBHOOK_SECRET`)
- anything not under `/api/`

Custom Auth0 claims use the `mikro/` namespace (`mikro/org_id`, `mikro/roles`),
set by an Auth0 Action in the post-login rule. **The Auth0 Actions are part of
the system and live only in the Auth0 dashboard — they are not in this repo.**
Get access and read them.

### 5.3 The view pattern

Every backend resource is a Flask `MethodView` registered in `app.py` with a
`<path>` URL parameter, and dispatches sub-paths internally:

```python
app.add_url_rule("/api/user/<path>", view_func=UserAPI.as_view("user"))
# POST /api/user/fetch_user_role  →  UserAPI.post(path="fetch_user_role")
#                                 →  self._fetch_user_role()
```

Consequence: **`app.py` is the routing table.** To find what handles an
endpoint, start there, then grep the view module for the sub-path string. There
is no decorator-based route registry.

The largest views are `TimeTracking.py` (2,713 lines) and `Users.py` (2,482).
Both would benefit from further extraction into `api/services/` — that pattern
is already established and partially applied.

### 5.4 Roles and scoping

Hierarchy: `user < validator < team_admin < org_admin (stored as "admin") < super_admin`

- Decorators in `api/utils/decorators.py`: `@requires_auth`,
  `@requires_admin` (org_admin+), `@requires_team_admin_or_above`.
- `@requires_auth` also blocks `is_active=False` users with a
  `reason: "deactivated"` 401.
- Scoping helpers in `api/auth/team_scoping.py`: `managed_team_ids_for`,
  `team_member_ids_for`, `team_admin_can_access_team`,
  `team_admin_can_access_user`, `is_org_admin_or_above`, `is_super_admin`.
- Pay redaction in `api/auth/pay_visibility.py`: `can_view_pay_for`,
  `redact_pay_fields`.
- `api/auth/user_scope.py::UserScope` builds the visible-user set for a viewer.

**Team admins do their own scoping inside handlers** — `@requires_team_admin_or_above`
only gates entry. When you add a team-admin-reachable endpoint, you must apply
the scoping helper yourself or you leak cross-team data. There is a test suite
for this (`tests/test_team_scoping.py`, `tests/test_org_isolation.py`,
`tests/test_user_scope.py`) — extend it whenever you touch scoping.

### 5.5 Multi-tenancy

Every tenant is an **Auth0 Organization**; `User.org_id` holds the Auth0 org id
string. Queries filter on `org_id`. `tests/test_org_isolation.py` guards this.

The Auth0 plan is **B2C with a hard cap of 10 organizations** — enforced in code
by `AUTH0_ORG_LIMIT` (default 10) as a provisioning capacity guard. If Kaart
needs more tenants, the Auth0 plan must move to B2B and the env var raised.

---

## 6. Data model

All models are in one file: `backend/api/database/core.py` (~1,758 lines).

### 6.1 The five things that will trip you up

1. **`User.id` is the Auth0 `sub` string** (e.g. `"auth0|123abc"`), not an
   integer. Every FK to a user is `db.String(255)`. There is *also* a separate
   `auth0_sub` column (unique, indexed) — `authenticate_request` looks the user
   up by `auth0_sub`, not by `id`. Keep both in sync when creating users.
2. **Task attribution stores OSM usernames, not user FKs.** `Task.mapped_by` /
   `validated_by` are OSM username strings. This is deliberate: it preserves
   historical attribution if a user later unlinks their OSM account. Do not
   "fix" it into a foreign key.
3. **Two independent deactivation mechanisms.** `is_active=False` blocks login
   immediately; `deleted_date` is a soft delete for audit trail. A user can
   have `is_active=False` and no `deleted_date`. Check the one you actually
   mean.
4. **`compensation_model` is nullable** for users predating its introduction
   (2026-05-18). `NULL` is treated as `per_task`. Values: `per_task`, `hourly`,
   `project_based`.
5. **`is_tracked_only` users have no Auth0 account and never log in.** They
   exist so OSM activity can be tracked for non-Mikro mappers. Any code that
   assumes "a User row implies a login" is wrong.

### 6.2 Table groups

| Group | Tables |
|---|---|
| Identity | `users`, `organizations`, `pending_invites` |
| Work | `projects`, `tasks`, `project_users`, `user_tasks`, `validator_task_actions` |
| Teams/geo | `teams`, `team_users`, `team_leads`, `project_teams`, `regions`, `countries`, `user_countries`, `project_countries` |
| Money | `requests` (PayRequests), `payments`, `payment_cycle_status`, `hourly_payments`, `user_hourly_rates`, `payroll_config`, `reimbursement_requests` |
| Time | `time_entries`, `custom_topics`, `activity_subcategories` |
| Training | `training`, `training_question`, `training_question_answer`, `project_training`, `training_completed`, `team_trainings`, `training_countries` |
| OSM analysis | `changeset_adiffs`, `punks`, `punk_changesets`, `friends`, `friend_changesets`, `community_entries` |
| Ops | `sync_jobs`, `transcription_jobs`, `monitored_channels`, `channel_posts` |
| Newer | `report_layouts`, `event_proposals`, `project_proposals`, `geo_layers`, `geo_features`, `user_availability`, `user_availability_exceptions` |

### 6.3 Migrations

- Flask-Migrate / Alembic, in `backend/migrations/versions/` — **70 revisions**.
- Chain verified clean at audit time: **one root** (`a1b2c3d4e5f6`
  `baseline_schema`), **one head** (`b7c8d9e0f1a2` `add_user_availability`),
  two merge revisions (`607cbb189b9a`, `a7f8a9b0c1d2`).
- Applied automatically on deploy via the `Procfile` `release` command.

**Mandatory pre-flight before writing any migration** (this broke production
once, on 2026-04-28, with a colliding `a7b8c9d0e1f2`):

```bash
grep -h "^revision = " backend/migrations/versions/*.py | sort -u
```

Confirm your new revision id is not in that list, and that `down_revision`
points at a revision that exists. Glancing at recent filenames is not enough.
Also run `flask db heads` and `flask db current` against the target database
and confirm they agree before you add to the chain.

Note the models declare a PostGIS `geometry` column, so any database you run
`create_all`/migrations against **must have PostGIS installed** or you get
`type "geometry" does not exist`.

---

## 7. The background worker

`backend/api/worker/` — run with `python -m api.worker`. Deployed as DO
component `mikro-backend2` from `worker-release`.

### 7.1 How it works

- Polls the `sync_jobs` table every 5 seconds for `status="queued"`.
- Runs each job in a **daemon thread** so the poll loop stays responsive (this
  is what lets the stale-job timeout fire while a job is in progress).
- One running job per org at a time.
- **Stale-job timeout:** a job `running` for >1 hour is marked failed.
- **Orphan recovery:** a job marked `running` in the DB with no live thread
  (i.e. the previous worker was SIGKILLed / OOMed) is requeued.
- **Graceful shutdown:** SIGTERM/SIGINT writes `/tmp/mikro_worker_clean_shutdown`,
  drains in-flight jobs for up to 120s, and requeues whatever didn't finish.
  On startup, the *absence* of that marker is logged loudly as "previous
  lifetime ended ungracefully" — a useful OOM signal.
- Logs to `/tmp/worker.log` (mode `w`, so it truncates each start) as well as
  stdout.

### 7.2 Job types

| `job_type` | Module | What it does |
|---|---|---|
| `task_sync` (default) | `jobs/sync.py` | Pulls tasks/contributions from TM4 and MapRoulette |
| `element_analysis` | `jobs/element_analysis.py` | Analyses changeset elements (augmented diffs) |
| `element_analysis_backfill` | `jobs/element_analysis.py` | Backfill variant |
| `mr_metadata_backfill` | `jobs/mr_backfill.py` | MapRoulette metadata backfill |
| `watchlist_refresh` | `jobs/watchlist_refresh.py` | Refreshes punk/friend changeset watchlists |

### 7.3 Nightly schedule

At **07:00 UTC (midnight MST)** the worker enqueues `task_sync`,
`element_analysis`, and `watchlist_refresh` for **every distinct `org_id`** in
the users table. Implemented as a wall-clock check in the main loop
(`(now_utc.hour - 7) % 24 == 0 and now_utc.minute < 5`), guarded by
`last_nightly_date` so it fires once per day.

**Caveat:** the schedule is hardcoded to MST and does not follow DST. If the
nightly window matters, this is worth moving to an explicit tz-aware schedule.

---

## 8. External integrations

| Service | Used for | Config | Notes |
|---|---|---|---|
| **Auth0** | All authentication, orgs, invitations, roles | `AUTH0_*` | Post-login **Actions live in the Auth0 dashboard, not this repo**. M2M app used for Management API (invites); a separate Regular Web App client id is used for invitations — see `AUTH0_APP_CLIENT_ID` |
| **Tasking Manager 4** | Primary task source | `TM4_API_URL`, `TM4_API_TOKEN` | `https://tasks.kaart.com/api/v2`. Kaart-run. Codebase at `/Users/goose/Documents/PROJECTS/KAART/TM4` |
| **MapRoulette** | Supplemental task source | `MR_API_URL`, `MR_API_KEY` | Public maproulette.org. **Supplemental — MR stats must always render separately from TM4, never amalgamated** |
| **OpenStreetMap** | OAuth account linking; changeset data | `OSM_OAUTH_*`, `OSM_API_URL` | OAuth 2.0 with HMAC-signed state tokens for CSRF |
| **osmcha adiffs** | Augmented diffs for element analysis | — | `https://adiffs.osmcha.org` |
| **Mapillary** | Imagery stats | `MAPILLARY_ACCESS_TOKEN` | `graph.mapillary.com` |
| **Anthropic (Claude)** | Translation helper (`api/ai.py`) | `ANTHROPIC_API_KEY` | Best-effort; never raises, degrades to `(None, error)` |
| **DigitalOcean Spaces** | File storage (S3-compatible) | `DO_SPACES_*` | Bucket `kaart`, region `sfo3` |
| **Comms service** | Notifications + broadcast email | `COMMS_URL`, `COMMS_WEBHOOK_SECRET` | Internal, HMAC-signed |
| **Supabase** | Realtime presence + layers on the map page | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_KEY` | **Frontend-only. Undocumented — see §13** |
| **SMTP (Gmail)** | Outbound email (via comms) | `SMTP_*` on the comms component | Requires a Gmail **app password** |

### 8.1 Inbound webhooks

`POST /api/webhook/tm4-task-event` — HMAC-authenticated (`MIKRO_WEBHOOK_SECRET`),
skips JWT. Handles `mapped`, `validated`, `invalidated`, and `split` events from
TM4. This is the low-latency path; the nightly `task_sync` is the reconciliation
path.

---

## 9. The Comms service (`comms/`)

**Treat comms and Mikro as two entirely different products that happen to share
a repo and a DO app.** This separation is deliberate and was set up on
2026-06-09 specifically so their deploys stop interrupting each other.

- Standalone Flask app, **own database** (`comms-db`, a separate logical DB on
  the same managed Postgres cluster), **own Alembic chain**
  (`comms/migrations/`), applied by a `comms-migrate` PRE_DEPLOY job.
- Serves multiple Kaart apps (Mikro, Viewer, TM4) — keyed on the Auth0 `sub`
  under the shared tenant. **No foreign keys into any app's schema.**
- Two ways in: **JWT** (browser → self-scoped notification reads/prefs) and
  **HMAC** (app backend → `/emit/*`, signed with `COMMS_WEBHOOK_SECRET`,
  `X-Comms-Signature` header).
- Comms does not know about Mikro's teams or regions. For `team:`/`region:`/
  `custom` audiences **the calling app resolves recipients and passes them in**.
  Only `all_org` is resolved by comms from its own `identities` table.
- Run command must be `wsgi:application` (top-level), **not**
  `comms.wsgi:application` — App Platform builds from `source_dir: comms`.

See `comms/README.md` for the endpoint table and local-run instructions.

### 9.1 Comms deploy gotchas already solved — do not reintroduce

1. `comms/email/` shadowed Python's stdlib `email` module → renamed to
   `comms/mail/`. **Never name a top-level comms package after a stdlib module.**
2. `alembic.ini` **must be pure ASCII** — configparser reads it with
   `encoding='locale'` (ASCII in the container); an em-dash crashed the migrate
   job. `PYTHONUTF8=1` is set on the migrate job.
3. `COMMS_DATABASE_URL` is set to the **literal** connection string. The
   `${comms-db.DATABASE_URL}` DO binding never resolved in the hand-built app.
   Config strips embedded whitespace (a paste-wrap once injected a newline into
   the port) and rewrites `postgres://` → `postgresql://`.
4. If `COMMS_DATABASE_URL` is unset the app silently falls back to in-memory
   SQLite. `/health` reports this — **`GET /mikro-comms/health` returns a `db`
   field** (`connected` / `ephemeral-in-memory` / a categorised error). Use it;
   comms service logs are hard to retrieve.

### 9.2 Comms status

The service is live and green. The **Mikro↔comms client integration**
(`comms_client.py`, triggers, frontend bell) exists on master and on
`comms-release`; verify end-to-end before assuming any given notification type
is wired. Notification types are mirrored in
`backend/api/comms_client.py::NotificationType` and `comms/notifications/types.py`
— **these two lists must be kept in sync manually.**

---

## 10. Testing & quality

### 10.1 Backend

```bash
cd backend
python -m pytest tests/                                # 562 test functions
python -m pytest tests/test_team_scoping.py            # one file
python -m pytest tests/test_team_scoping.py::test_name # one test
```

**The DB-backed tests need a real PostgreSQL with PostGIS**, database name
containing `test` (default `mikro_test`). `createdb mikro_test` then enable
PostGIS on it.

The suite reads `TESTING_DB_HOST/PORT/USER/PASSWORD` **first**, falling back to
the shared `POSTGRES_*` vars. Use the `TESTING_DB_*` names — importing the app
runs `load_dotenv(".env.local", override=True)`, which would otherwise clobber
an inline `POSTGRES_PORT=… pytest`:

```bash
TESTING_DB_PORT=5433 python -m pytest tests/
```

Coverage is strongest exactly where it should be: scoping/isolation
(`test_team_scoping`, `test_org_isolation`, `test_user_scope`,
`test_pay_visibility`), payments (`test_payments_compute`, `test_payroll_hours`,
`test_hourly_rate_history`), and time tracking (`test_clock_in/out_service`,
`test_time_entry_query`, `test_timekeeping_queries`).

### 10.2 Frontend

```bash
cd frontend/mikro-next
npm test        # vitest — only 6 test files
npm run lint    # eslint
```

Frontend test coverage is thin (6 files against 136 components). The
`frontend-preflight` skill exists precisely because `npm run build` passing does
not catch missing imports, undefined identifiers, or failure-path code.

### 10.3 Formatting

```bash
# backend
black . && flake8
# frontend
npx prettier --write .        # NOTE: there is no `npm run prettier` script
```

---

## 11. Current state of work

### 11.1 Unmerged branches (not in master)

- `feature/team-admin-permissions-audit`
- `feature/trello-6a0cb5f4-reports-v2-p4`
- `comms-release` (expected — never merges to master)

Everything else in the ~46 local feature branches is already merged and can be
pruned.

### 11.2 Implementation plans in `.claude/`

These are detailed, still-current design docs written before implementation.
Several are untracked in git — **commit them or move them somewhere durable**,
they are the best record of intent for in-flight work:

| File | Topic |
|---|---|
| `scheduling-availability-plan.md` (29 KB) + `-research.md` | Scheduling & availability; Phase 2 (availability UI + `add_exception` fix) has shipped |
| `reports-v2-configurable-ui-plan.md` + `configurable-reports-ui-research.md` | Reports v2 configurable layout builder |
| `switch-task-deferred-metadata-plan.md` | Task-switch deferred metadata rework |
| `projects-export-plan.md` | Projects CSV export (shipped 2026-08-21) |
| `project-proposal-queue-plan.md` | Project proposal/provisioning queue |
| `archived-projects-plan.md` | Archived projects |
| `admin-undelete-project-plan.md` | Admin undelete |
| `community-visibility-plan.md` | Community auto-visibility |
| `project-dropdown-quickwins-plan.md`, `logan-qol-improvements-plan.md` | QoL batches |

### 11.3 Known backlog items

- **Mapillary account linking has no ownership verification.** The `/account`
  self-service linking only checks that the username *exists* on Mapillary — a
  user can link someone else's account. Needs OAuth or equivalent. (Open since
  2026-02-25.)
- **Results-based / per-task billing is de-prioritised, not removed** (as of
  2026-05-18). Some clients pushed less for micropayments, so payments-v2
  excludes `per_task` contributors by *default filter*. It was explicitly
  flagged as "for now / may be revisited". Keep `per_task` a first-class, fully
  implemented branch that is merely filtered out by a default value — never
  stubbed, skipped, or structurally omitted. Re-enabling must stay a flag flip
  with zero schema or endpoint rework.

### 11.4 Workflow (Trello)

Work intake runs through the Mikro Trello board (`64fa56eb0834a60d8dc94c7c`,
trello.com/b/M7B9xiZu). Intake lists: *Other Changes*, *UI Changes*, *New
Feature Requests*, *Bug Reports*. Flow lists: *In Progress* → *Needs Testing* →
*Ready to Deploy* → *Deliverable*, plus *Blocked*. Each intake list has a pinned
guideline card that should be skipped when scanning. Branch convention:
`feature/trello-{card-id}-{brief-name}`.

Note: *In Progress* is shared with another developer and split by header cards —
put your cards under the right header.

---

## 12. Landmines — hard-won lessons

Each of these cost real production time. They are not inferable from the code.

1. **Merging to master does not deploy the worker.** (§3) Assumed once; nearly
   shipped a wrong "it's live tomorrow" claim about a nightly job.
2. **Never merge `comms/` changes into master.** It redeploys live Mikro and
   undoes the whole point of the branch split.
3. **`.do/app.yaml` is stale and not authoritative.** Verify the live DO spec.
4. **Always check the migration chain before writing a migration.** A colliding
   revision id broke the production deploy on 2026-04-28.
5. **After squashing/consolidating migrations, every database must be
   `flask db stamp`ed to the new baseline.** Skip it and the DB's
   `alembic_version` points at a deleted revision, and *every* migration command
   fails with "Can't locate revision identified by …". The only fix then is a
   direct `UPDATE alembic_version SET version_num = '<baseline>'`.
6. **Verify deployment config, not just source code.** "The code is correct"
   ≠ "it works in production". Check env vars, the live app spec, and the
   component's actual branch.
7. **Read the actual API/source before writing code against it.** Never assume a
   response shape or dict key.
8. **Finish the whole investigation before fixing.** The Recent Activity
   changeset bug (2026-05-01) burned time because a fix started at the first
   inconsistency found rather than after the full trace.
9. **`get_invalidated_TM4_tasks` once undid validations.** It checked whether a
   task was *ever* invalidated in its TM4 history and overwrote a freshly-set
   `validated=True`. Fixed to check only *current* status. If validation counts
   ever go mysteriously to zero again, look at ordering effects between
   `get_validated_TM4_tasks` and `get_invalidated_TM4_tasks` first.
10. **Only create Task records for non-Mikro mappers when a Mikro validator
    validates them.** Never bulk-create all non-Mikro mapper tasks — that was an
    explicit product decision, not an oversight.
11. **Mikro is live during the workday.** Stage schema/auth changes and deploy
    off-hours.

---

## 13. Risks and recommended first actions

Ordered by what I'd do first.

| # | Finding | Why it matters | Suggested action |
|---|---|---|---|
| 1 | **`worker-release` is 74 commits / ~10 weeks behind master.** Production worker code is from 2026-06-16. | Nightly syncs, element analysis and watchlist refresh run old code against a schema that has moved on. Silent divergence. | Diff `worker-release..master` for `api/worker/`, `api/database/`, `api/utils/`, `api/services/`. Advance `worker-release` deliberately, off-hours, and watch `/tmp/worker.log` and `sync_jobs` after. |
| 2 | **No local development database or seed data.** | Highest onboarding cost; encourages developing against live/staging. | Add docker-compose (PostGIS) + a fixture/seed script. Biggest single quality-of-life win. |
| 3 | **Supabase is a live production dependency with zero documentation.** `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY` are consumed by `src/lib/supabase.ts` (used by the map's realtime presence and layers hooks) but appear in **no** `.env.example` and **no** `.env.local`. | A fresh clone silently breaks the map page; nobody knows which Supabase project this is. | Document the project, add the vars to `.env.example`, confirm who owns the Supabase account. |
| 4 | **`COMMS_PROXY_URL` is used in the frontend but not in `.env.example`.** | Same class of problem as #3. | Add to `.env.example`. |
| 5 | **`.do/app.yaml` is stale and actively misleading** (wrong worker component name, wrong branches). | Someone will trust it. | Either regenerate it from the live spec and mark it read-only, or delete it and document the topology in the README. |
| 6 | **Auth0 Actions (the `mikro/` claim mapping) exist only in the Auth0 dashboard.** | They are load-bearing for every request, and unversioned. Losing tenant access or an accidental edit breaks all logins. | Export the Actions into the repo (`docs/auth0/`) as reference, and confirm at least two people have tenant admin. |
| 7 | **Unused dependencies with real supply-chain and confusion cost.** `stripe`, `faster-whisper`, `ctranslate2`, `av`, `onnxruntime`, `huggingface_hub`, `tokenizers`, `google-api-python-client` and friends are in `requirements.txt` but **nothing in `backend/api` imports them.** Likewise `GOOGLE_SHEETS_SPREADSHEET_ID` / `GOOGLE_SHEETS_TAB_NAME` sit in `backend/.env` with no reader. | The ML stack alone is hundreds of MB of build time and CVE surface for code that isn't there. A `TranscriptionJob` model exists with no transcription implementation on master. | Confirm nothing is planned, then prune. Decide whether `transcription_jobs` is dead schema. |
| 8 | **`api/ai.py` docstring references `api/views/ChannelMonitor.py`, which does not exist.** | Stale pointer; suggests a removed feature (`monitored_channels` / `channel_posts` tables are still there). | Verify whether channel monitoring is dead, then drop the model + tables or restore the view. |
| 9 | **Two very large view modules** — `TimeTracking.py` (2,713 lines), `Users.py` (2,482). | Hard to review, easy to break scoping in. | Continue the existing extraction into `api/services/`. |
| 10 | **Frontend test coverage is thin** (6 files / 136 components). | Regressions land silently; the build won't catch them. | Add tests to `src/lib/` helpers first (highest value per line), and run the `frontend-preflight` checks before merges. |
| 11 | **Nightly job schedule is hardcoded to MST and DST-unaware.** | Twice-yearly one-hour drift in when nightly syncs run. | Make it tz-aware if the window matters. |
| 12 | **Untracked plan docs and a 255 KB `logs.txt` / 153 KB `nodekluster.jsx` in the working tree.** | Design intent lives only on one laptop. | Commit `.claude/*.md` (or move to `docs/`); delete the stray files. |
| 13 | **No rollback runbook, no staging environment distinct from production.** | Recovery depends on one person's memory. | Write the rollback steps into the README; consider a staging DO app. |

**Secret hygiene: clean.** No `.env` files are tracked; `.gitignore` correctly
excludes `backend/.env*`, `frontend/mikro-next/.env*`, `*.env` (with an
`!*.env.example` exception), source maps, and Playwright output. Keep it that
way.

---

## 14. Access checklist for the incoming engineer

Confirm you have all of these before you need them urgently:

- [ ] GitHub — `KaartGroup/Mikro` write access (and `KaartGroup/TM4` read)
- [ ] **DigitalOcean team** — App Platform (`plankton-app-vsfmr`), managed
      Postgres cluster, Spaces (`kaart` bucket, `sfo3`)
- [ ] **Auth0 tenant admin** — including the ability to read/edit post-login
      **Actions** and Organizations
- [ ] `backend/.env`, `backend/.env.local`, `frontend/mikro-next/.env.local` values
- [ ] TM4 API token + admin access to `tasks.kaart.com`
- [ ] MapRoulette service-account API key
- [ ] OSM OAuth app credentials (client id/secret + registered redirect URIs)
- [ ] Mapillary access token
- [ ] Anthropic API key
- [ ] `MIKRO_WEBHOOK_SECRET` and `COMMS_WEBHOOK_SECRET` (the latter must match
      across *every* app that emits to comms)
- [ ] Gmail app password for comms SMTP
- [ ] **Supabase project** access (see risk #3)
- [ ] Trello board

> Note: internal notes refer to a `scripts/do_spaces.py` upload helper and a
> `scripts/.env.do-spaces` credentials file. **Neither exists in this repo and
> neither was ever committed** — `scripts/` contains only `fix_spaces_cors.py`.
> If you need Spaces uploads, you are writing that script from scratch.

---

## 15. Quick reference

```bash
# Run everything locally
cd backend && source venv/bin/activate && flask run -p 5004 --reload
cd backend && source venv/bin/activate && python -m api.worker
cd frontend/mikro-next && npm run dev

# Tests
cd backend && python -m pytest tests/
cd frontend/mikro-next && npm test

# Format / lint
cd backend && black . && flake8
cd frontend/mikro-next && npm run lint && npx prettier --write .

# Migrations
cd backend
grep -h "^revision = " migrations/versions/*.py | sort -u   # ALWAYS FIRST
flask db heads && flask db current
flask db migrate -m "message" && flask db upgrade

# Deploy
git push origin master           # → mikro-backend + mikro-frontend
git push origin worker-release   # → mikro-backend2 (the worker)
git push origin comms-release    # → comms

# Health checks
curl https://<app-host>/api/health
curl https://<app-host>/mikro-comms/health     # returns a `db` field

# Debug auth issues — every decision point logs a parseable line
#   grep AUTH-TRACE   in the DO logs for mikro-backend
```

**Key files, in the order you'll need them:**

1. `backend/app.py` — the routing table
2. `backend/api/database/core.py` — every model
3. `backend/api/config.py` — every environment variable
4. `backend/api/auth/auth.py` + `api/utils/decorators.py` — the auth gate
5. `backend/api/auth/team_scoping.py` — who can see what
6. `frontend/mikro-next/src/app/backend/[...path]/route.ts` — the API proxy
7. `frontend/mikro-next/src/middleware.ts` — the session guard
8. `backend/api/worker/main.py` — the background job loop
9. `CLAUDE.md` / `README.md` — architecture tour and dev commands
10. `comms/README.md` — the comms service contract
