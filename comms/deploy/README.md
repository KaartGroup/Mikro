# Deploying Kaart Comms (DigitalOcean App Platform)

Mikro deploys on **DigitalOcean App Platform**, not Kubernetes/GitLab. The live
spec is at the repo root: `.do/app.yaml`. It includes all components: services
`mikro-backend` / `mikro-frontend` / `comms`, worker `mikro-worker`, and
databases `db` / `comms-db`.

---

## 1. Provision the separate database

Comms keeps its data in its **own logical database**, separate from Mikro's
domain tables. Two options:

- **Share Mikro's cluster (recommended):** set `cluster_name:` on the `comms-db`
  database block (in the fragment) to the existing Mikro PG cluster name. Find
  it with `doctl databases list`. This creates a separate logical DB + user on
  the same cluster. When sharing a cluster you must also set `production: true`
  on that database block.
- **Fresh dev DB:** leave `cluster_name` unset and App Platform provisions a new
  database for the app.

Either way, App Platform injects the connection string, which the spec maps to
`COMMS_DATABASE_URL` via `${comms-db.DATABASE_URL}`.

## 2. Set env vars / secrets

App-level secrets (set once on the DO app; referenced as `${...}` in the spec):

| Secret | Purpose |
|--------|---------|
| `AUTH0_DOMAIN` | Shared Kaart Auth0 tenant (already set for Mikro). |
| `COMMS_WEBHOOK_SECRET` | HMAC-SHA256 secret for `/emit`. New — must match every calling backend. |
| `SMTP_USERNAME` | Sender mailbox, e.g. `mikro@kaart.com`. |
| `SMTP_PASSWORD` | Gmail **app password** (see §5 — PENDING). |

App-level plain vars:

| Var | Example |
|-----|---------|
| `COMMS_API_AUDIENCES` | `https://mikro/api/authorize,https://Viewer/api/authorize,https://tasks.kaart.com/api` |
| `SMTP_FROM_EMAIL` | `mikro@kaart.com` (defaults to `SMTP_USERNAME` if unset) |
| `APP_BASE_URL` | already set for Mikro; reused as `COMMS_BASE_URL` |

> **Env-var naming note:** the comms code (`comms/email/mailer.py`,
> `comms/config.py`) reads `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`,
> `SMTP_FROM_NAME`. The table in `comms/README.md` uses the shorthand
> `SMTP_USER` / `SMTP_FROM`; the names in the deploy spec and this doc are the
> source of truth.

Full required-vs-optional checklist is in `comms/README.md` →
"Environment variables".

## 3. Run migrations (`alembic upgrade head`)

Comms owns its **own Alembic chain** (`comms/migrations/`, chain root
`c0115ec7100`), independent of Mikro's `backend/migrations/`. Do **not** run
`flask db upgrade` for comms — that targets Mikro's chain.

This runs automatically on every deploy via the `comms-migrate` **PRE_DEPLOY
job** in `.do/app.yaml`.

`comms/migrations/env.py` resolves the DB URL from `COMMS_DATABASE_URL` at
runtime. To run it by hand against the managed DB (from the repo root):

```bash
COMMS_DATABASE_URL='<comms managed DB url>' \
  python -m alembic -c comms/migrations/alembic.ini upgrade head
```

## 4. Public + internal routing

- **Public route `/comms`** (in the spec): App Platform strips the prefix and
  forwards to the app, so the app still serves `/health`, `/emit/*`,
  `/notifications/*`, `/email/*`. This is how **other-team apps in different DO
  apps** (Viewer, TM4) reach comms — over HTTPS at
  `https://<mikro-domain>/comms/emit/notify`.
- **Internal route**: within the Mikro DO app, components reach each other by
  service name on the private mesh. Mikro's backend reaches comms at
  `http://comms:8080` (no public hop). This is the same pattern
  `mikro-frontend` already uses to reach `mikro-backend`
  (`FLASK_BACKEND_URL=http://mikro-backend:8080`).

## 5. SMTP app-password requirement (PENDING)

`SMTP_PASSWORD` must be a Gmail **app password**, not the mailbox account
password. Gmail app passwords require 2-Step Verification on the sending Google
account. Until the app password is generated for the `mikro@kaart.com` (or
chosen) mailbox and stored as the `SMTP_PASSWORD` secret, the mailer runs in
**no-op mode** — `_configured()` returns False and every send is logged and
skipped, no error. Notifications still write to the bell row; only email
delivery is suppressed.

## 6. Eventual mono-project consolidation

When the apps consolidate into one DO app, drop the public `/comms` route and
point every caller at the internal `http://comms:8080` service name. The HMAC
`/emit` contract and JWT endpoints are unchanged — **no application code
change**, only env (`COMMS_URL`) and spec routing.

---

## Client-side env (Mikro backend → comms)

For Mikro's backend to **reach** comms, add these to the `mikro-backend`
service's `envs` in `.do/app.yaml`:

| Key | Value | Why |
|-----|-------|-----|
| `COMMS_URL` | `http://comms:8080` | Internal mesh URL of the comms component. Use the public `https://<mikro-domain>/comms` form only from a different DO app. |
| `COMMS_WEBHOOK_SECRET` | `${COMMS_WEBHOOK_SECRET}` | The **same** shared HMAC secret comms verifies. Reference the same app-level secret the comms component uses. |

Viewer and TM4 backends (separate DO apps) get the same two vars, except
`COMMS_URL` is the **public** `https://<mikro-domain>/comms` and
`COMMS_WEBHOOK_SECRET` is the identical secret value, set in each app's own DO
config.
