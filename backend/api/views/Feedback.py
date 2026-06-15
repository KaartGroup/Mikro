#!/usr/bin/env python3
"""
Feedback / problem-report API endpoint for Mikro.

A signed-in user can submit a free-form problem report. The report is always
logged server-side, and best-effort delivered to the org's admins via the
comms service (broadcast email). Delivery failures never fail the request —
the report is considered captured the moment it's logged.

Contract (shared with frontend):
    POST /api/feedback/submit
    body { description: string, category?: string, context?: object }
    @requires_auth
    returns { status: 200, message }
"""

import json
import html

from flask.views import MethodView
from flask import g, jsonify, request, current_app

from ..utils import requires_auth
from ..targeting import org_admin_users
from .. import comms_client
from ..ai import translate_to_english


class FeedbackAPI(MethodView):
    """User-submitted problem reports.

    All sub-paths require an authenticated user (any role).
    """

    decorators = [requires_auth]

    def post(self, path: str):
        if path == "submit":
            return self.submit()
        return jsonify({"message": "Unknown path", "status": 404}), 404

    def submit(self):
        data = request.get_json(silent=True) or {}
        description = (data.get("description") or "").strip()
        if not description:
            return (
                jsonify({"message": "description is required", "status": 400}),
                400,
            )
        category = data.get("category")
        context = data.get("context") or {}

        # Best-effort translation so admins can read reports written in any
        # language. Never fails the request — falls back to "unavailable".
        translated, terr = translate_to_english(description)

        current_app.logger.info(
            "[FEEDBACK] from=%s org=%s category=%s desc=%r " "translated=%r context=%s",
            g.user.id,
            g.user.org_id,
            category,
            description,
            translated,
            json.dumps(context)[:2000],
        )

        # Best-effort delivery to the org's admins. Wrapped whole so a
        # delivery failure NEVER fails the request — the report is already
        # captured in the logs above.
        try:
            admins = org_admin_users(g.user.org_id)
            recipients = [{"sub": a.id, "email": a.email} for a in admins if a.email]
            if recipients:
                safe_desc = html.escape(description)
                safe_category = html.escape(str(category)) if category else "—"
                safe_context = html.escape(json.dumps(context, indent=2)[:4000])
                safe_email = html.escape(g.user.email or "")
                safe_id = html.escape(g.user.id or "")
                if terr or not translated:
                    safe_translated = "(translation unavailable)"
                else:
                    safe_translated = html.escape(translated)
                body_html = (
                    f"<p><strong>Reported by:</strong> {safe_email} "
                    f"({safe_id})</p>"
                    f"<p><strong>Category:</strong> {safe_category}</p>"
                    f"<p><strong>Original (as written):</strong></p>"
                    f"<p>{safe_desc}</p>"
                    f"<p><strong>English translation:</strong></p>"
                    f"<p>{safe_translated}</p>"
                    f"<p><strong>Context:</strong></p>"
                    f"<pre>{safe_context}</pre>"
                )
                comms_client.send_campaign(
                    org_id=g.user.org_id,
                    subject=f"[Mikro] Problem report from {g.user.email}",
                    body_html=body_html,
                    audience="custom",
                    is_forced=True,
                    sent_by=g.user.id,
                    recipients=recipients,
                )
        except comms_client.CommsError as e:
            current_app.logger.warning("[FEEDBACK] delivery failed: %s", e)
        except Exception as e:
            current_app.logger.warning("[FEEDBACK] delivery failed: %s", e)

        return jsonify({"message": "Report submitted", "status": 200}), 200
