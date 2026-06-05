"""
Email campaign API — admin-composed mass email.

Audience resolution honours the cross-app seam:
  - "all_org": comms resolves recipients itself from its Identity table
    (filtered by notify_announcement unless the campaign is forced).
  - "team:<id>" / "region:<id>" / "custom": comms does NOT know any app's
    teams/regions, so the CALLING app resolves the recipients and passes
    `recipient_emails`. (Mikro wires this through its backend in Phase 2.)

Admin-only (org_admin or above). Adapted from Mikro's backend/api/views/Email.py.
"""

from datetime import datetime

from flask import g, jsonify, request
from flask.views import MethodView

from ..database import EmailCampaign, Identity, db
from ..mail import mailer
from ..mail.audience import parse_audience
from ..auth import requires_admin


class EmailAPI(MethodView):
    """Admin email-campaign endpoints."""

    decorators = [requires_admin]

    def post(self, path: str):
        handler = {
            "campaigns_create": self.create,
            "campaigns_list": self.list_campaigns,
            "campaigns_preview": self.preview,
        }.get(path)
        if handler is None:
            return jsonify({"message": "Endpoint not found", "status": 404}), 404
        return handler()

    # ── recipient resolution ──────────────────────────────────────
    def _resolve_recipient_emails(self, audience: str, is_forced: bool, data: dict):
        """Return (emails, error_response_or_None)."""
        kind, _target = parse_audience(audience)

        if kind == "all_org":
            q = Identity.query.filter(Identity.org_id == g.identity.org_id)
            if not is_forced:
                q = q.filter(Identity.notify_announcement.is_(True))
            emails = [i.email for i in q.all() if i.email]
            return emails, None

        if kind in ("team", "region", "custom"):
            # App-resolved: caller supplies the recipient list.
            emails = data.get("recipient_emails")
            if not isinstance(emails, list) or not emails:
                return None, (
                    jsonify(
                        {
                            "message": (
                                "recipient_emails (resolved by the calling app) "
                                "is required for team/region/custom audiences"
                            ),
                            "status": 400,
                        }
                    ),
                    400,
                )
            return [e for e in emails if e], None

        return None, (
            jsonify({"message": f"Unknown audience: {audience}", "status": 400}),
            400,
        )

    # ── endpoints ─────────────────────────────────────────────────
    def create(self):
        data = request.get_json(silent=True) or {}
        subject = (data.get("subject") or "").strip()
        body_html = data.get("body_html") or ""
        audience = (data.get("audience") or "").strip()
        is_forced = bool(data.get("is_forced", False))

        if not subject or not body_html or not audience:
            return (
                jsonify(
                    {
                        "message": "subject, body_html and audience are required",
                        "status": 400,
                    }
                ),
                400,
            )

        emails, err = self._resolve_recipient_emails(audience, is_forced, data)
        if err is not None:
            return err

        campaign = EmailCampaign(
            org_id=g.identity.org_id,
            subject=subject,
            body_html=body_html,
            sent_by=g.identity.sub,
            audience=audience,
            is_forced=is_forced,
            sent_at=datetime.utcnow(),
            recipient_count=len(emails),
        )
        db.session.add(campaign)
        db.session.commit()

        # Fire-and-forget send on a daemon thread (SMTP latency off the
        # request path); de-duplicate addresses first.
        unique = sorted(set(emails))
        if unique:
            mailer.send_campaign_async(unique, subject, body_html)

        return jsonify({"status": 200, "campaign": campaign.to_dict()}), 200

    def list_campaigns(self):
        rows = (
            EmailCampaign.query.filter(EmailCampaign.org_id == g.identity.org_id)
            .order_by(EmailCampaign.created_at.desc())
            .limit(50)
            .all()
        )
        return jsonify({"status": 200, "campaigns": [c.to_dict() for c in rows]}), 200

    def preview(self):
        data = request.get_json(silent=True) or {}
        subject = (data.get("subject") or "").strip()
        body_html = data.get("body_html") or ""
        audience = (data.get("audience") or "").strip()
        is_forced = bool(data.get("is_forced", False))

        rendered = mailer.render_campaign_html(subject or "(no subject)", body_html)

        recipient_count = None
        if audience:
            emails, err = self._resolve_recipient_emails(audience, is_forced, data)
            if err is None:
                recipient_count = len(set(emails))

        return (
            jsonify(
                {"status": 200, "html": rendered, "recipient_count": recipient_count}
            ),
            200,
        )
