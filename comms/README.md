# Kaart Comms

A shared notifications / email / messenger service for all Kaart apps
(Mikro, Viewer, TM4). It is a self-contained Flask app that lives in the
Mikro repo but deploys as its **own App Platform component with its own
database** — completely separate from Mikro's domain tables.

Everything is keyed on the Auth0 `sub` under the shared Kaart tenant, which
is a universal user id. The service has **no foreign keys** into any client
app's schema, so it stays app-agnostic and can serve every app at once.

## Architecture

- **Own database.** Tables: `identities`, `notifications`, `email_campaigns`.
  `identities` is a local projection of a user (sub, email, org, role, and
  the eight `notify_*` email preferences), upserted from the JWT on every
  authenticated request — so the emit path never reaches into a client app's
  user table.
- **Own Alembic chain.** Rooted under `comms/migrations/`, independent of
  Mikro's `backend/migrations/`.
- **Two ways in:**
  - **JWT (browser → service):** self-scoped read/write endpoints. A caller
    can only touch their own notifications / preferences. Tokens minted for
    any client app's audience are accepted (`API_AUDIENCES` is a list),
    since the Auth0 tenant is shared.
  - **HMAC (app backend → service):** trusted server-to-server `/emit`
    endpoints. App backends sign the raw body with `COMMS_WEBHOOK_SECRET`
    (HMAC-SHA256, `X-Comms-Signature` header) — no JWT.

## Cross-app integration model

- App backends **emit** events to comms over HMAC (`/emit/notify`,
  `/emit/notify_batch`). Comms is the single source of truth for the
  bell-row + email-policy decision.
- Browsers **read** their own notifications / set preferences over JWT
  (`/notifications/*`).
- Comms does **not** know any app's teams or regions. For
  `team:<id>` / `region:<id>` / `custom` email audiences, the **calling app
  resolves the recipient list** and passes it in (`recipient_emails` for
  email, resolved subs for `/emit/notify_batch`). Only `all_org` is resolved
  by comms itself, from its own `identities` table (filtered by
  `notify_announcement` unless the campaign is forced).

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET  | `/health` | none | Liveness probe |
| POST | `/notifications/fetch` | JWT | Paginated bell list (+ retention cleanup) |
| POST | `/notifications/unread_count` | JWT | Bell badge count |
| POST | `/notifications/mark_read` | JWT | Mark some / all read |
| POST | `/notifications/preferences` | JWT | Read caller's `notify_*` flags |
| POST | `/notifications/update_preferences` | JWT | Patch `notify_*` flags |
| POST | `/emit/notify` | HMAC | Emit one notification |
| POST | `/emit/notify_batch` | HMAC | Fan one message out to many subs |
| POST | `/email/campaigns_create` | JWT (org_admin+) | Compose & send a campaign |
| POST | `/email/campaigns_list` | JWT (org_admin+) | List recent campaigns |
| POST | `/email/campaigns_preview` | JWT (org_admin+) | Render + count recipients |

## Running locally

```bash
# from the repo root, using the shared venv
source backend/venv/bin/activate
pip install -r comms/requirements.txt

# apply migrations to the comms DB
COMMS_DATABASE_URL=postgresql://localhost/comms_dev \
  python -m alembic -c comms/migrations/alembic.ini upgrade head

# run the dev server on port 5005
COMMS_DATABASE_URL=postgresql://localhost/comms_dev \
AUTH0_DOMAIN=your-tenant.auth0.com \
API_AUDIENCES="https://mikro/api/authorize,https://Viewer/api/authorize" \
COMMS_WEBHOOK_SECRET=dev-secret \
COMMS_BASE_URL=http://localhost:3000 \
  flask --app comms.wsgi:app run -p 5005 --reload
```

For production the app is served by gunicorn: `comms.wsgi:application`.

### Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `COMMS_DATABASE_URL` | yes (prod) | Comms' own DB connection string. Defaults to in-memory SQLite if unset. |
| `AUTH0_DOMAIN` | yes | Auth0 tenant domain (JWKS / token validation). |
| `API_AUDIENCES` | yes | Comma-separated list of acceptable token audiences (one per client app). |
| `COMMS_WEBHOOK_SECRET` | yes | HMAC-SHA256 shared secret for `/emit` callers. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME` | for email | Kaart Gmail SMTP settings (read by `email/mailer.py`). `SMTP_PASSWORD` must be a Gmail **app password**. |
| `COMMS_BASE_URL` | optional | Base URL used to build absolute links in emails. Defaults to `https://mikro.kaart.com`. |
| `ORG_CLAIM_KEYS`, `ROLES_CLAIM_KEYS` | optional | Per-app Auth0 custom-claim namespaces to read org/roles from. Sensible defaults built in. |
| `NOTIFICATION_RETENTION_DAYS` | optional | Bell-row retention window (default 90). |

## Migrations

Comms owns its own Alembic chain under `comms/migrations/`. The DB URL is
resolved at runtime from `COMMS_DATABASE_URL` (falling back to the app's
`SQLALCHEMY_DATABASE_URI`) — never hardcoded in `alembic.ini`.

```bash
# upgrade / downgrade / inspect
python -m alembic -c comms/migrations/alembic.ini upgrade head
python -m alembic -c comms/migrations/alembic.ini downgrade -1
python -m alembic -c comms/migrations/alembic.ini current
```

When adding a model column or table, generate a new revision and chain it
off the latest comms head (not Mikro's chain):

```bash
python -m alembic -c comms/migrations/alembic.ini revision --autogenerate -m "describe change"
```

## Deploying

Comms deploys on **DigitalOcean App Platform** as its own `service` component
inside Mikro's DO app, with its own managed database. See:

- `comms/deploy/app-platform-comms.yaml` — the component fragment to merge into
  the root `.do/app.yaml` (service + PRE_DEPLOY migrate job + `comms-db`).
- `comms/deploy/README.md` — provisioning the DB, env/secrets, migrations,
  public + internal routing, the SMTP app-password requirement, the
  client-side env Mikro's backend needs (`COMMS_URL`, `COMMS_WEBHOOK_SECRET`),
  and the mono-project consolidation note.
