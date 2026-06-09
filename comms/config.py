"""
Configuration for the Kaart Comms service.

Everything is env-driven — no secrets or environment-specific values are
hardcoded. This service is deployed as its own App Platform component with
its own database, separate from Mikro's domain tables.

Auth model: one shared Auth0 tenant across all Kaart apps, so the Auth0
`sub` is a universal user id. The service accepts JWTs minted for ANY of the
client apps' audiences (Mikro, Viewer, TM4) — hence API_AUDIENCES is a list.
"""

import os


def _split_csv(value: str) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def _normalize_db_url() -> str:
    """Resolve COMMS_DATABASE_URL into a SQLAlchemy-parseable URL.

    Tolerates the common deploy footguns:
      - ANY embedded whitespace/newlines from copy-paste wrapping (e.g. a line
        break injected mid-value splitting the port "25060" into "2506\n  0").
        A DB URL never contains literal whitespace, so all of it is removed.
      - surrounding quotes from copy-paste
      - the `postgres://` scheme (DO/Heroku style) which SQLAlchemy rejects;
        rewrite to `postgresql://`
    Falls back to an in-memory SQLite when unset (create_app logs this loudly).
    """
    # "".join(split()) collapses out spaces, tabs, and newlines anywhere in the
    # string — not just the ends — which .strip() would leave behind.
    raw = "".join((os.environ.get("COMMS_DATABASE_URL") or "").split())
    raw = raw.strip('"').strip("'")
    if not raw:
        return "sqlite:///:memory:"
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://") :]
    return raw


class Config:
    # ── Database ──────────────────────────────────────────────────
    # Its OWN database (separate logical DB on the shared managed cluster).
    SQLALCHEMY_DATABASE_URI = _normalize_db_url()
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # ── Auth0 (shared tenant) ─────────────────────────────────────
    AUTH0_DOMAIN = os.environ.get("AUTH0_DOMAIN")
    ALGORITHMS = ["RS256"]
    # Comma-separated list of acceptable token audiences (one per client app).
    # e.g. "https://mikro/api/authorize,https://Viewer/api/authorize,https://tasks.kaart.com/api"
    API_AUDIENCES = _split_csv(os.environ.get("API_AUDIENCES", ""))

    # Custom-claim keys to look for, in priority order, since each app uses
    # its own Auth0 namespace (Mikro "mikro/", TM "tm", Viewer ...).
    ORG_CLAIM_KEYS = _split_csv(
        os.environ.get(
            "ORG_CLAIM_KEYS",
            "mikro/org_id,tm/org_id,viewer/org_id,org_id",
        )
    )
    ROLES_CLAIM_KEYS = _split_csv(
        os.environ.get(
            "ROLES_CLAIM_KEYS",
            "mikro/roles,tm/roles,viewer/roles,roles",
        )
    )

    # ── Server-to-server (event emit) ─────────────────────────────
    # HMAC-SHA256 shared secret for app backends posting to /emit.
    # Reuses the same pattern TM4 already uses to reach Mikro.
    COMMS_WEBHOOK_SECRET = os.environ.get("COMMS_WEBHOOK_SECRET")

    # ── Email (Kaart Gmail SMTP) ──────────────────────────────────
    # SMTP_* are read directly by email/mailer.py from os.environ so the
    # mailer stays a standalone seam; listed here for documentation.
    SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "Kaart")

    # Base URL used to build absolute links in emails (preferences page, etc).
    COMMS_BASE_URL = os.environ.get("COMMS_BASE_URL", "https://mikro.kaart.com")

    # ── Misc ──────────────────────────────────────────────────────
    NOTIFICATION_RETENTION_DAYS = int(
        os.environ.get("NOTIFICATION_RETENTION_DAYS", "90")
    )
