"""Health check — unauthenticated liveness probe for App Platform.

Always returns 200 (so a transient DB blip doesn't pull the component out of
rotation), but reports DB status so operators can diagnose without service
logs — a plain `curl /health` reveals whether the service actually reached its
database and whether the schema is present.
"""

from flask import current_app, jsonify
from flask.views import MethodView

from ..extensions import db
from ..database import Notification


class HealthAPI(MethodView):
    def get(self):
        # Loud signal when COMMS_DATABASE_URL is unset (ephemeral in-memory DB).
        if current_app.config.get("DB_EPHEMERAL"):
            db_status = "ephemeral-in-memory (COMMS_DATABASE_URL not set)"
        else:
            try:
                # Cheap query against a real table — proves connection + schema.
                db.session.query(Notification.id).limit(1).all()
                db_status = "connected"
            except Exception as e:
                # Categorize the cause (no raw connection details on a public
                # endpoint) so it can be diagnosed without service logs.
                msg = str(e).lower()
                if "authentication failed" in msg or "password" in msg:
                    db_status = "error: auth failed (bad DB credentials)"
                elif "database" in msg and "does not exist" in msg:
                    db_status = "error: database name does not exist"
                elif "relation" in msg and "does not exist" in msg:
                    db_status = "error: schema missing (run migrations)"
                elif any(
                    s in msg
                    for s in (
                        "could not connect",
                        "timed out",
                        "timeout",
                        "no pg_hba",
                        "connection refused",
                        "could not translate host",
                        "ssl",
                    )
                ):
                    db_status = "error: cannot connect (network/trusted-source/SSL)"
                else:
                    db_status = f"error: {type(e).__name__}"
                try:
                    current_app.logger.warning("[HEALTH] db check failed: %s", e)
                except Exception:
                    pass

        return jsonify({"status": "ok", "service": "comms", "db": db_status}), 200
