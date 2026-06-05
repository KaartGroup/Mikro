"""
Notifications API — bell menu + per-user email preferences.

All endpoints are self-scoped to g.identity: a caller can only fetch,
mark-read, or change prefs for themselves. Per-org siloing is enforced by
filtering Notification.org_id alongside user_id.

Adapted from Mikro's backend/api/views/Notifications.py (g.user → g.identity).
"""

from datetime import datetime, timedelta

from flask import current_app, g, jsonify, request
from flask.views import MethodView

from ..database import Notification, NOTIFY_PREF_COLUMNS, db
from ..auth import requires_auth

PREFERENCE_FIELDS = list(NOTIFY_PREF_COLUMNS)


class NotificationsAPI(MethodView):
    """Self-scoped notification endpoints."""

    decorators = [requires_auth]

    def post(self, path: str):
        handler = {
            "fetch": self.fetch,
            "unread_count": self.unread_count,
            "mark_read": self.mark_read,
            "preferences": self.preferences,
            "update_preferences": self.update_preferences,
        }.get(path)
        if handler is None:
            return jsonify({"message": "Endpoint not found", "status": 404}), 404
        return handler()

    def fetch(self):
        """Return paginated notifications + auto-cleanup of old rows."""
        data = request.get_json(silent=True) or {}
        # Clamp to sane bounds so a client can't request an unbounded scan.
        try:
            limit = max(1, min(int(data.get("limit", 20)), 100))
        except (TypeError, ValueError):
            limit = 20
        try:
            offset = max(0, int(data.get("offset", 0)))
        except (TypeError, ValueError):
            offset = 0

        # Auto-cleanup: delete this user's notifications older than the
        # retention window on every fetch. Cheap; keeps the table lean.
        retention_days = current_app.config.get("NOTIFICATION_RETENTION_DAYS", 90)
        cutoff = datetime.utcnow() - timedelta(days=retention_days)
        Notification.query.filter(
            Notification.user_id == g.identity.sub,
            Notification.org_id == g.identity.org_id,
            Notification.created_at < cutoff,
        ).delete(synchronize_session=False)
        db.session.commit()

        query = Notification.query.filter(
            Notification.user_id == g.identity.sub,
            Notification.org_id == g.identity.org_id,
        ).order_by(Notification.created_at.desc())

        total = query.count()
        rows = query.limit(limit).offset(offset).all()

        return (
            jsonify(
                {
                    "status": 200,
                    "notifications": [n.to_dict() for n in rows],
                    "total": total,
                }
            ),
            200,
        )

    def unread_count(self):
        """Single int for the bell badge — cheap, called every 30s."""
        count = (
            db.session.query(db.func.count(Notification.id))
            .filter(
                Notification.user_id == g.identity.sub,
                Notification.org_id == g.identity.org_id,
                Notification.is_read.is_(False),
            )
            .scalar()
            or 0
        )
        return jsonify({"status": 200, "unread_count": int(count)}), 200

    def mark_read(self):
        """Mark notifications read. If `ids` present → just those; else all
        unread for the caller."""
        data = request.get_json(silent=True) or {}
        ids = data.get("ids")

        query = Notification.query.filter(
            Notification.user_id == g.identity.sub,
            Notification.org_id == g.identity.org_id,
            Notification.is_read.is_(False),
        )
        if ids:
            query = query.filter(Notification.id.in_(ids))

        updated = query.update({Notification.is_read: True}, synchronize_session=False)
        db.session.commit()
        return jsonify({"status": 200, "updated": updated}), 200

    def preferences(self):
        """Return the caller's notify_* flags."""
        prefs = {f: bool(getattr(g.identity, f, True)) for f in PREFERENCE_FIELDS}
        return jsonify({"status": 200, "preferences": prefs}), 200

    def update_preferences(self):
        """Patch one or more notify_* flags. Unknown keys ignored."""
        data = request.get_json(silent=True) or {}
        prefs = data.get("preferences") or {}

        for field in PREFERENCE_FIELDS:
            if field in prefs:
                setattr(g.identity, field, bool(prefs[field]))
        db.session.commit()

        updated = {f: bool(getattr(g.identity, f, True)) for f in PREFERENCE_FIELDS}
        return jsonify({"status": 200, "preferences": updated}), 200
