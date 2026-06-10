#!/usr/bin/env python3
"""
Comms (broadcast email / announcements) API endpoints for Mikro.

This is the authorization + recipient-resolution gatekeeper that sits in
front of the standalone comms service. comms is app-agnostic and gates its
own JWT email endpoints to org-admin+, so team-lead scoping MUST be enforced
here in Mikro.

The flow for a campaign send:
  1. ``_authorize_audience`` — confirms g.user is allowed to target the
     requested audience (org admins: org-wide + regions + any team + any
     custom user in their org; team admins: only teams they lead and custom
     users who are members of those teams).
  2. ``_resolve_recipients`` — turns the audience into a concrete list of
     ``{"sub", "email"}`` dicts (dropping users with no email).
  3. ``comms_client.send_campaign`` — forwards over HMAC. comms applies the
     opt-out filter (unless is_forced) and persists.

Mikro never trusts comms to authorize team leads — comms only sees the
already-resolved recipient list.
"""

from flask.views import MethodView
from flask import g, jsonify, request

from ..utils import requires_team_admin_or_above
from ..auth import (
    is_org_admin_or_above,
    managed_team_ids_for,
    team_member_ids_for,
    team_admin_can_access_team,
    team_admin_can_access_user,
)
from ..targeting import org_users, team_member_users, region_users
from ..database import Region, Team, User
from .. import comms_client


def _err(message, status):
    """Standard error tuple matching the codebase's (jsonify, status) style."""
    return jsonify({"message": message, "status": status}), status


def _parse_scoped_id(audience, prefix):
    """Return the int id from ``<prefix>:<id>`` or None if malformed."""
    raw = audience[len(prefix) :]
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


class CommsAPI(MethodView):
    """Broadcast-email authorization + recipient resolution.

    All sub-paths require team_admin or above (the decorator blocks
    user/validator); per-audience scoping is enforced inside.
    """

    decorators = [requires_team_admin_or_above]

    def post(self, path: str):
        if path == "targetable_audiences":
            return self.targetable_audiences()
        elif path == "targetable_users":
            return self.targetable_users()
        elif path == "campaign_preview":
            return self.campaign_preview()
        elif path == "campaign_send":
            return self.campaign_send()
        elif path == "campaign_list":
            return self.campaign_list()
        return _err("Unknown path", 404)

    # ─── Authorization + resolution helpers ──────────────────────────

    def _authorize_audience(self, audience, recipient_user_ids):
        """Return an error response tuple if g.user may NOT target this
        audience, else None.

        Mirrors the role/team-lead policy: org admins target anything in
        their org; team admins only their led teams + members thereof.
        """
        org = is_org_admin_or_above(g.user)

        if audience == "all_org":
            if not org:
                return _err("Not authorized to target the whole org.", 403)
            return None

        if audience.startswith("region:"):
            if _parse_scoped_id(audience, "region:") is None:
                return _err("Invalid region id.", 400)
            if not org:
                return _err("Not authorized to target a region.", 403)
            return None

        if audience.startswith("team:"):
            team_id = _parse_scoped_id(audience, "team:")
            if team_id is None:
                return _err("Invalid team id.", 400)
            if org or team_admin_can_access_team(g.user, team_id):
                return None
            return _err("Not authorized to target that team.", 403)

        if audience == "custom":
            if not isinstance(recipient_user_ids, list) or not recipient_user_ids:
                return _err("recipient_user_ids must be a non-empty list.", 400)
            if org:
                # Every sub must belong to this org.
                found = User.query.filter(
                    User.org_id == g.user.org_id,
                    User.id.in_(recipient_user_ids),
                ).all()
                found_ids = {u.id for u in found}
                if any(sub not in found_ids for sub in recipient_user_ids):
                    return _err("One or more recipients are not in your org.", 403)
                return None
            # Team admin: every sub must be a member of a team they lead.
            for sub in recipient_user_ids:
                if not team_admin_can_access_user(g.user, sub):
                    return _err(
                        "One or more recipients are outside the teams you " "manage.",
                        403,
                    )
            return None

        return _err("Unknown audience.", 400)

    def _resolve_recipients(self, audience, recipient_user_ids):
        """Resolve an (already-authorized) audience to a list of
        ``{"sub", "email"}`` dicts. Returns ``(recipients, error_or_None)``.

        Users with no email are dropped — comms keys on email.
        """
        org_id = g.user.org_id

        if audience == "all_org":
            users = org_users(org_id)
        elif audience.startswith("team:"):
            team_id = _parse_scoped_id(audience, "team:")
            if team_id is None:
                return [], _err("Invalid team id.", 400)
            users = team_member_users(team_id, org_id)
        elif audience.startswith("region:"):
            region_id = _parse_scoped_id(audience, "region:")
            if region_id is None:
                return [], _err("Invalid region id.", 400)
            users = region_users(region_id, org_id)
        elif audience == "custom":
            users = User.query.filter(
                User.org_id == org_id,
                User.id.in_(recipient_user_ids or []),
            ).all()
        else:
            return [], _err("Unknown audience.", 400)

        recipients = [{"sub": u.id, "email": u.email} for u in users if u.email]
        return recipients, None

    def _org_teams(self):
        return Team.query.filter_by(org_id=g.user.org_id).order_by(Team.name).all()

    def _org_regions(self):
        return Region.query.filter_by(org_id=g.user.org_id).order_by(Region.name).all()

    # ─── Endpoints ───────────────────────────────────────────────────

    def targetable_audiences(self):
        """What can g.user broadcast to? Drives the compose-screen pickers."""
        org = is_org_admin_or_above(g.user)

        if org:
            teams = self._org_teams()
            regions = [{"id": r.id, "name": r.name} for r in self._org_regions()]
        else:
            managed = set(managed_team_ids_for(g.user))
            teams = [t for t in self._org_teams() if t.id in managed]
            regions = []

        return (
            jsonify(
                {
                    "status": 200,
                    "can_target_org": org,
                    "can_target_regions": org,
                    "can_target_individuals": True,
                    "teams": [{"id": t.id, "name": t.name} for t in teams],
                    "regions": regions,
                }
            ),
            200,
        )

    def targetable_users(self):
        """Individual users g.user may target (for the custom picker)."""
        if is_org_admin_or_above(g.user):
            users = org_users(g.user.org_id)
        else:
            managed = managed_team_ids_for(g.user)
            member_ids = team_member_ids_for(managed)
            if member_ids:
                users = User.query.filter(
                    User.org_id == g.user.org_id,
                    User.id.in_(member_ids),
                ).all()
            else:
                users = []

        return (
            jsonify(
                {
                    "status": 200,
                    "users": [
                        {
                            "sub": u.id,
                            "name": (u.full_name or u.email or u.id),
                            "email": u.email,
                        }
                        for u in users
                    ],
                }
            ),
            200,
        )

    def campaign_preview(self):
        """Resolved audience size (comms applies the opt-out filter at send)."""
        data = request.get_json(silent=True) or {}
        audience = data.get("audience")
        recipient_user_ids = data.get("recipient_user_ids")

        err = self._authorize_audience(audience, recipient_user_ids)
        if err:
            return err
        recipients, err = self._resolve_recipients(audience, recipient_user_ids)
        if err:
            return err
        return jsonify({"status": 200, "recipient_count": len(recipients)}), 200

    def campaign_send(self):
        """Authorize, resolve, then forward the campaign to comms."""
        data = request.get_json(silent=True) or {}
        subject = (data.get("subject") or "").strip()
        body_html = (data.get("body_html") or "").strip()
        audience = data.get("audience")
        is_forced = bool(data.get("is_forced"))
        recipient_user_ids = data.get("recipient_user_ids")

        if not subject or not body_html:
            return _err("Subject and body are required.", 400)

        err = self._authorize_audience(audience, recipient_user_ids)
        if err:
            return err
        recipients, err = self._resolve_recipients(audience, recipient_user_ids)
        if err:
            return err
        if not recipients:
            return _err("No recipients resolved for that audience.", 400)

        try:
            result = comms_client.send_campaign(
                org_id=g.user.org_id,
                subject=subject,
                body_html=body_html,
                audience=audience,
                is_forced=is_forced,
                sent_by=g.user.id,
                recipients=recipients,
            )
        except comms_client.CommsError as e:
            return (
                jsonify(
                    {
                        "status": 502,
                        "message": f"Couldn't reach the comms service: {e}",
                    }
                ),
                502,
            )

        return (
            jsonify(
                {
                    "status": 200,
                    "recipient_count": result.get("recipient_count"),
                    "campaign": result.get("campaign"),
                }
            ),
            200,
        )

    def campaign_list(self):
        """Campaign history. Org admins see all org campaigns; team admins
        see only their own (sent_by == their id)."""
        sent_by = None if is_org_admin_or_above(g.user) else g.user.id
        campaigns = comms_client.fetch_campaigns(org_id=g.user.org_id, sent_by=sent_by)
        return jsonify({"status": 200, "campaigns": campaigns}), 200
