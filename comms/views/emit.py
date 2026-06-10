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

from ..database import db, EmailCampaign
from ..notifications import create_notification
from ..mail import campaign_service
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
            "campaign": self.campaign,
            "campaign_list": self.campaign_list,
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

    def campaign(self):
        """Send a campaign with recipients the calling app has already
        resolved + authorized. comms still owns the notify_announcement
        opt-out filter (unless forced), persistence, and sending."""
        data = request.get_json(silent=True) or {}
        org_id = data.get("org_id")
        subject = (data.get("subject") or "").strip()
        body_html = data.get("body_html")
        audience = (data.get("audience") or "").strip()
        sent_by = data.get("sent_by")
        recipients = data.get("recipients")

        if not org_id or not subject or not body_html or not audience or not sent_by:
            return (
                jsonify(
                    {
                        "message": (
                            "org_id, subject, body_html, audience and sent_by "
                            "are required"
                        ),
                        "status": 400,
                    }
                ),
                400,
            )
        if not isinstance(recipients, list) or not recipients:
            return (
                jsonify(
                    {"message": "recipients must be a non-empty list", "status": 400}
                ),
                400,
            )

        is_forced = bool(data.get("is_forced", False))
        emails = campaign_service.emails_for_subs_pref_filtered(
            recipients, org_id=org_id, is_forced=is_forced
        )
        campaign = campaign_service.persist_and_send(
            org_id=org_id,
            subject=subject,
            body_html=body_html,
            audience=audience,
            is_forced=is_forced,
            sent_by=sent_by,
            emails=emails,
        )
        return (
            jsonify(
                {
                    "status": 200,
                    "recipient_count": campaign.recipient_count,
                    "campaign": campaign_service.campaign_dict_with_sender(campaign),
                }
            ),
            200,
        )

    def campaign_list(self):
        """List recent campaigns for an org (optionally one sender)."""
        data = request.get_json(silent=True) or {}
        org_id = data.get("org_id")
        if not org_id:
            return jsonify({"message": "Missing field: org_id", "status": 400}), 400

        sent_by = data.get("sent_by")
        q = EmailCampaign.query.filter(EmailCampaign.org_id == org_id)
        if sent_by:
            q = q.filter(EmailCampaign.sent_by == sent_by)
        rows = q.order_by(EmailCampaign.created_at.desc()).limit(50).all()
        return (
            jsonify(
                {
                    "status": 200,
                    "campaigns": [
                        campaign_service.campaign_dict_with_sender(c) for c in rows
                    ],
                }
            ),
            200,
        )
