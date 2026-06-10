"""
Kaart Comms service — application factory.

A self-contained Flask app that lives in the Mikro repo but deploys as its
own App Platform component with its own database. Serves notifications +
email (+ messenger, Phase 3) to every Kaart app via:
  - JWT-authenticated, self-scoped read/write endpoints (browser → service)
  - HMAC-signed /emit endpoints (app backend → service)

Identity is keyed on the Auth0 `sub` (shared tenant), with no foreign keys
into any client app's tables.
"""

import os

from flask import Flask, jsonify

from .config import Config
from .extensions import db


def create_app(config_object=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)

    # Surface misconfiguration at boot (in logs) rather than on first request.
    # These are required in any real deployment; auth fails closed without them.
    for key in ("AUTH0_DOMAIN", "API_AUDIENCES", "COMMS_WEBHOOK_SECRET"):
        if not app.config.get(key):
            app.logger.warning(
                "[CONFIG] %s is not set - dependent endpoints will reject requests",
                key,
            )

    # The single most dangerous misconfig: if COMMS_DATABASE_URL is unset the
    # service silently falls back to an EPHEMERAL in-memory SQLite (empty, no
    # tables) and every write 500s while /health still passes. Make that loud.
    db_uri = app.config.get("SQLALCHEMY_DATABASE_URI") or ""
    app.config["DB_EPHEMERAL"] = (not os.environ.get("COMMS_DATABASE_URL")) and (
        "memory" in db_uri or db_uri.startswith("sqlite")
    )
    if app.config["DB_EPHEMERAL"] and not app.config.get("TESTING"):
        app.logger.critical(
            "[CONFIG] COMMS_DATABASE_URL is NOT set - using an ephemeral in-memory "
            "SQLite DB. No tables exist; all writes will fail with 500. Set "
            "COMMS_DATABASE_URL (e.g. ${comms-db.DATABASE_URL}) on this component."
        )

    # If a value IS set but isn't a parseable URL, db.init_app() crashes the
    # worker with an opaque ArgumentError. Diagnose it clearly first (this shows
    # in the deploy logs), then let it fail so App Platform keeps the prior
    # deploy rather than promoting a broken one.
    if not app.config["DB_EPHEMERAL"]:
        if "${" in db_uri:
            app.logger.critical(
                "[CONFIG] COMMS_DATABASE_URL looks like an UNEXPANDED binding "
                "placeholder (%r...). The bound DB resource name likely doesn't "
                "match - attach a database named to match the ${...} binding, or "
                "set a literal connection string.",
                db_uri[:30],
            )
        else:
            from sqlalchemy.engine import make_url

            try:
                make_url(db_uri)
            except Exception as e:
                app.logger.critical(
                    "[CONFIG] COMMS_DATABASE_URL is not a valid SQLAlchemy URL "
                    "(prefix=%r, len=%d): %s",
                    db_uri[:15],
                    len(db_uri),
                    e,
                )

    db.init_app(app)

    # Import models so they register on db.metadata before create_all / migrations.
    from . import database  # noqa: F401

    # Self-heal the schema on boot. create_all is idempotent (checkfirst skips
    # existing tables, creates only what's missing), so no matter what state
    # the database is in after a redeploy — empty, partial, or full — the
    # service comes up with its full schema present. This is the durable fix
    # for the schema repeatedly going missing across deploys; the bell/messages
    # endpoints can never come up tableless again. Wrapped so a transient DB
    # blip logs loudly but doesn't crash-loop the worker (the next boot, or
    # /health, surfaces it).
    if not app.config.get("DB_EPHEMERAL"):
        try:
            with app.app_context():
                db.create_all()
        except Exception as e:
            app.logger.critical("[SCHEMA] create_all on boot failed: %s", e)

    # Auth: validate JWT + project Identity on every non-public request.
    from .auth import authenticate_request

    app.before_request(authenticate_request)

    # Routes.
    from .views import register_routes

    register_routes(app)

    @app.errorhandler(404)
    def _not_found(_e):
        return jsonify({"message": "Not found", "status": 404}), 404

    @app.errorhandler(500)
    def _server_error(_e):
        app.logger.exception("Unhandled error")
        return jsonify({"message": "Internal server error", "status": 500}), 500

    return app
