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

    db.init_app(app)

    # Import models so they register on db.metadata before create_all / migrations.
    from . import database  # noqa: F401

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
