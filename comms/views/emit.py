"""
Emit API — server-to-server notification ingestion.

App backends (Mikro, Viewer, TM4) POST here, signed with the shared
COMMS_WEBHOOK_SECRET (HMAC-SHA256 over the raw body, `X-Comms-Signature`
header). No JWT — these are trusted backend callers, not browsers.

Every path funnels through create_notification(), the single emit SSOT, so
bell-row + email policy stays in one place.

  POST /emit/notify        — one notification
  POST /emit/notify_batch  — fan one message out to many recipient subs
"""

from flask import jsonify, request
from flask.views import MethodView

from ..database import db
from ..notifications import create_notification
from ..auth import requires_hmac

_REQUIRED_SINGLE = ("user_id", "org_id", "type", "message")


def _clean_optional(data: dict) -> dict:
    return {
        "link": data.get("link"),
        "actor_id": data.get("actor_id"),
        "entity_type": data.get("entity_type"),
        "entity_id": data.get("entity_id"),
        "send_email": data.get("send_email"),
    }


class EmitAPI(MethodView):
    """HMAC-gated event ingestion for app backends."""

    decorators = [requires_hmac]

    def post(self, path: str):
        handler = {
            "notify": self.notify,
            "notify_batch": self.notify_batch,
        }.get(path)
        if handler is None:
            return jsonify({"message": "Endpoint not found", "status": 404}), 404
        return handler()

    def notify(self):
        data = request.get_json(silent=True) or {}
        missing = [f for f in _REQUIRED_SINGLE if not data.get(f)]
        if missing:
            return (
                jsonify(
                    {"message": f"Missing fields: {', '.join(missing)}", "status": 400}
                ),
                400,
            )

        n = create_notification(
            user_id=data["user_id"],
            org_id=data["org_id"],
            type=data["type"],
            message=data["message"],
            **_clean_optional(data),
        )
        return jsonify({"status": 200, "id": n.id}), 200

    def notify_batch(self):
        """Fan a single message out to many recipients (e.g. a team/region/
        org broadcast the calling app has already resolved to subs)."""
        data = request.get_json(silent=True) or {}
        user_ids = data.get("user_ids") or []
        for f in ("org_id", "type", "message"):
            if not data.get(f):
                return jsonify({"message": f"Missing field: {f}", "status": 400}), 400
        if not isinstance(user_ids, list) or not user_ids:
            return (
                jsonify(
                    {"message": "user_ids must be a non-empty list", "status": 400}
                ),
                400,
            )

        optional = _clean_optional(data)
        ids = []
        for sub in user_ids:
            n = create_notification(
                user_id=sub,
                org_id=data["org_id"],
                type=data["type"],
                message=data["message"],
                commit=False,  # batch — commit once at the end
                **optional,
            )
            ids.append(n.id)
        db.session.commit()
        return jsonify({"status": 200, "count": len(ids), "ids": ids}), 200
