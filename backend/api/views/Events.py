#!/usr/bin/env python3
"""
Event Proposals API.

Routes mounted under ``/api/event/`` in ``app.py``.

Workflow:
  - Any authenticated user submits a proposal → row lands as ``pending``.
  - Submitter can withdraw their own pending proposals.
  - Team-admin-or-above can list, approve, or reject proposals in their scope.
"""

import json
import re
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import boto3
from flask import current_app, g, request
from flask.views import MethodView

from ..database import EventProposal, TeamUser
from ..utils import requires_auth, requires_team_admin_or_above
from ..auth.team_scoping import is_org_admin_or_above
from ..auth.team_scoping import managed_team_ids_for

# ── Supporting-document upload helpers ──────────────────────────────────────

_EVENT_ATTACHMENT_ALLOWED_TYPES = {
    "application/msword",
    "application/octet-stream",
    "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/gif",
    "image/heic",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/csv",
    "text/plain",
}
_EVENT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024  # 20 MB
_EVENT_ATTACHMENT_URL_EXPIRES_S = 300

_FILENAME_SAFE_RE = re.compile(r"[^a-zA-Z0-9._-]+")


def _safe_event_filename(name: str) -> str:
    if not name:
        return "attachment"
    cleaned = _FILENAME_SAFE_RE.sub("_", name).strip("._-")
    return cleaned[-80:] or "attachment"


def _event_presigned_put_url(key: str, content_type: str) -> str:
    bucket = current_app.config.get("DO_SPACES_BUCKET")
    if not bucket:
        raise RuntimeError("DO_SPACES_BUCKET not configured")
    s3 = boto3.client(
        "s3",
        endpoint_url=current_app.config.get("DO_SPACES_ENDPOINT"),
        aws_access_key_id=current_app.config.get("DO_SPACES_KEY"),
        aws_secret_access_key=current_app.config.get("DO_SPACES_SECRET"),
        region_name=current_app.config.get("DO_SPACES_REGION"),
    )
    return s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": bucket,
            "Key": key,
            "ContentType": content_type,
            "ContentLength": _EVENT_ATTACHMENT_MAX_BYTES,
            "ACL": "private",
        },
        ExpiresIn=_EVENT_ATTACHMENT_URL_EXPIRES_S,
        HttpMethod="PUT",
    )


_VALID_EVENT_TYPES = {
    "community_field_mapping",
    "conference",
    "mapping_party",
    "meetup_networking",
    "multi_activity_event",
    "other",
    "presentation",
    "themed_mapathon",
    "training_workshop",
    "university_engagement",
}

_VALID_EVENT_FORMATS = {"field_based", "hybrid", "in_person", "remote"}

_VALID_TRANSPORT_METHODS = {
    "bus",
    "motorcycle",
    "other",
    "personal_vehicle",
    "rental_vehicle",
    "taxi",
    "train",
}

_VALID_BUDGET_CATEGORIES = {
    "accommodation",
    "equipment",
    "food",
    "fuel",
    "mobile_data",
    "printing",
    "venue",
}

_VALID_TRAVEL_EXTRAS = {"parking", "public_transit", "tolls", "vehicle_rental"}


def _parse_date(raw):
    if not raw:
        return None
    try:
        if isinstance(raw, date) and not isinstance(raw, datetime):
            return raw
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _parse_decimal(raw):
    if raw is None or raw == "":
        return None
    try:
        return Decimal(str(raw))
    except (InvalidOperation, TypeError):
        return None


def _format_proposal(p):
    return {
        "id": p.id,
        "user_id": p.user_id,
        "org_id": p.org_id,
        "title": p.title,
        "co_organizers": p.co_organizers,
        "event_type": p.event_type,
        "event_format": p.event_format,
        "start_date": p.start_date.isoformat() if p.start_date else None,
        "end_date": p.end_date.isoformat() if p.end_date else None,
        "country_id": p.country_id,
        "city_region": p.city_region,
        "venue_name": p.venue_name,
        "description": p.description,
        "attendees": p.attendees,
        "external_orgs": p.external_orgs,
        "expected_outcomes": p.expected_outcomes,
        "needs_travel": p.needs_travel,
        "num_travelers": p.num_travelers,
        "transport_method": p.transport_method,
        "origin_city": p.origin_city,
        "origin_country_id": p.origin_country_id,
        "destination_city": p.destination_city,
        "destination_country_id": p.destination_country_id,
        "estimated_transport_cost": (
            float(p.estimated_transport_cost)
            if p.estimated_transport_cost is not None
            else None
        ),
        "additional_travel_expenses": (
            json.loads(p.additional_travel_expenses)
            if p.additional_travel_expenses
            else []
        ),
        "currency": p.currency,
        "budget_categories": (
            json.loads(p.budget_categories) if p.budget_categories else []
        ),
        "budget_amounts": (json.loads(p.budget_amounts) if p.budget_amounts else {}),
        "other_expense_amount": (
            float(p.other_expense_amount)
            if p.other_expense_amount is not None
            else None
        ),
        "other_expense_explanation": p.other_expense_explanation,
        "cost_justification": p.cost_justification,
        "agrees_to_report": p.agrees_to_report,
        "attachment_keys": (json.loads(p.attachment_keys) if p.attachment_keys else []),
        "additional_notes": p.additional_notes,
        "status": p.status,
        "submitted_at": p.submitted_at.isoformat() + "Z" if p.submitted_at else None,
        "reviewed_by": p.reviewed_by,
        "reviewed_at": p.reviewed_at.isoformat() + "Z" if p.reviewed_at else None,
        "reviewer_note": p.reviewer_note,
    }


class EventsAPI(MethodView):
    """Event proposal endpoints."""

    decorators = [requires_auth]

    def post(self, path: str):
        if path == "submit":
            return self._submit()
        if path == "my":
            return self._my()
        if path == "withdraw":
            return self._withdraw()
        if path == "list":
            return self._list()
        if path == "update_status":
            return self._update_status()
        if path == "upload-url":
            return self._upload_url()
        return {"message": f"Unknown event path: {path}", "status": 404}, 404

    # ── Submit ───────────────────────────────────────────────────────

    def _submit(self):
        if not g.user:
            return {"message": "Missing user info", "status": 401}, 401

        body = request.json or {}

        # ── Page 1 validation ────────────────────────────────────────
        title = (body.get("title") or "").strip()
        if not title:
            return {"message": "title is required", "status": 400}, 400
        if len(title) > 255:
            return {"message": "title exceeds 255 characters", "status": 400}, 400

        event_type = body.get("eventType") or body.get("event_type") or ""
        if event_type not in _VALID_EVENT_TYPES:
            return {"message": "invalid eventType", "status": 400}, 400

        event_format = body.get("eventFormat") or body.get("event_format") or ""
        if event_format not in _VALID_EVENT_FORMATS:
            return {"message": "invalid eventFormat", "status": 400}, 400

        start_date = _parse_date(body.get("startDate") or body.get("start_date"))
        end_date = _parse_date(body.get("endDate") or body.get("end_date"))
        if not start_date:
            return {"message": "startDate is required", "status": 400}, 400
        if not end_date:
            return {"message": "endDate is required", "status": 400}, 400
        if end_date < start_date:
            return {
                "message": "endDate must be on or after startDate",
                "status": 400,
            }, 400

        raw_country = body.get("country")
        try:
            country_id = int(raw_country) if raw_country not in (None, "") else None
        except (TypeError, ValueError):
            return {"message": "country must be a valid country id", "status": 400}, 400

        city_region = (body.get("cityRegion") or body.get("city_region") or "").strip()
        if not city_region:
            return {"message": "cityRegion is required", "status": 400}, 400

        venue_name = (body.get("venueName") or body.get("venue_name") or "").strip()
        if not venue_name:
            return {"message": "venueName is required", "status": 400}, 400

        description = (body.get("description") or "").strip()
        if not description:
            return {"message": "description is required", "status": 400}, 400

        # ── Page 2 validation ────────────────────────────────────────
        try:
            attendees = int(body.get("attendees") or 0)
            if attendees < 1:
                raise ValueError
        except (TypeError, ValueError):
            return {
                "message": "attendees must be a positive integer",
                "status": 400,
            }, 400

        expected_outcomes = (
            body.get("expectedOutcomes") or body.get("expected_outcomes") or ""
        ).strip()
        if not expected_outcomes:
            return {"message": "expectedOutcomes is required", "status": 400}, 400

        # ── Page 3 validation ────────────────────────────────────────
        needs_travel_raw = body.get("needsTravel") or body.get("needs_travel") or ""
        if needs_travel_raw not in ("yes", "no", True, False):
            return {"message": "needsTravel is required (yes/no)", "status": 400}, 400
        needs_travel = needs_travel_raw in ("yes", True)

        num_travelers = None
        transport_method = None
        origin_city = None
        origin_country_id = None
        destination_city = None
        destination_country_id = None
        estimated_transport_cost = None
        additional_travel_expenses = []

        if needs_travel:
            try:
                num_travelers = int(
                    body.get("numTravelers") or body.get("num_travelers") or 0
                )
                if num_travelers < 1:
                    raise ValueError
            except (TypeError, ValueError):
                return {
                    "message": "numTravelers must be a positive integer",
                    "status": 400,
                }, 400

            transport_method = (
                body.get("transportMethod") or body.get("transport_method") or ""
            )
            if transport_method not in _VALID_TRANSPORT_METHODS:
                return {"message": "invalid transportMethod", "status": 400}, 400

            origin_city = (
                body.get("originCity") or body.get("origin_city") or ""
            ).strip()
            if not origin_city:
                return {
                    "message": "originCity is required when traveling",
                    "status": 400,
                }, 400

            raw_origin_country = body.get("originCountry") or body.get("origin_country")
            try:
                origin_country_id = (
                    int(raw_origin_country)
                    if raw_origin_country not in (None, "")
                    else None
                )
            except (TypeError, ValueError):
                return {
                    "message": "originCountry must be a valid country id",
                    "status": 400,
                }, 400
            if not origin_country_id:
                return {
                    "message": "originCountry is required when traveling",
                    "status": 400,
                }, 400

            destination_city = (
                body.get("destinationCity") or body.get("destination_city") or ""
            ).strip()
            if not destination_city:
                return {
                    "message": "destinationCity is required when traveling",
                    "status": 400,
                }, 400

            raw_dest_country = body.get("destinationCountry") or body.get(
                "destination_country"
            )
            try:
                destination_country_id = (
                    int(raw_dest_country)
                    if raw_dest_country not in (None, "")
                    else None
                )
            except (TypeError, ValueError):
                return {
                    "message": "destinationCountry must be a valid country id",
                    "status": 400,
                }, 400
            if not destination_country_id:
                return {
                    "message": "destinationCountry is required when traveling",
                    "status": 400,
                }, 400

            raw_cost = (
                body.get("estimatedTransportCost")
                or body.get("estimated_transport_cost")
                or ""
            )
            if not str(raw_cost).strip():
                return {
                    "message": "estimatedTransportCost is required when traveling",
                    "status": 400,
                }, 400
            estimated_transport_cost = _parse_decimal(raw_cost)
            if estimated_transport_cost is None or estimated_transport_cost < 0:
                return {
                    "message": "estimatedTransportCost must be a non-negative number",
                    "status": 400,
                }, 400

            raw_extras = (
                body.get("additionalTravelExpenses")
                or body.get("additional_travel_expenses")
                or []
            )
            if not isinstance(raw_extras, list):
                return {
                    "message": "additionalTravelExpenses must be an array",
                    "status": 400,
                }, 400
            for item in raw_extras:
                if item not in _VALID_TRAVEL_EXTRAS:
                    return {
                        "message": f"invalid additionalTravelExpenses value: {item}",
                        "status": 400,
                    }, 400
            additional_travel_expenses = raw_extras

        # ── Page 4 validation ────────────────────────────────────────
        currency = (body.get("currency") or "").strip()
        if not currency:
            return {"message": "currency is required", "status": 400}, 400
        if len(currency) > 10:
            return {"message": "currency code too long", "status": 400}, 400

        cost_justification = (
            body.get("costJustification") or body.get("cost_justification") or ""
        ).strip()
        if not cost_justification:
            return {"message": "costJustification is required", "status": 400}, 400

        raw_budget_cats = (
            body.get("selectedBudgetCategories") or body.get("budget_categories") or []
        )
        if not isinstance(raw_budget_cats, list):
            return {
                "message": "selectedBudgetCategories must be an array",
                "status": 400,
            }, 400
        for cat in raw_budget_cats:
            if cat not in _VALID_BUDGET_CATEGORIES:
                return {
                    "message": f"invalid budget category: {cat}",
                    "status": 400,
                }, 400

        raw_budget_amounts = (
            body.get("budgetAmounts") or body.get("budget_amounts") or {}
        )
        if not isinstance(raw_budget_amounts, dict):
            return {"message": "budgetAmounts must be an object", "status": 400}, 400

        other_expense_amount = _parse_decimal(
            body.get("otherExpenseAmount") or body.get("other_expense_amount")
        )
        if other_expense_amount is not None and other_expense_amount < 0:
            return {
                "message": "otherExpenseAmount must be non-negative",
                "status": 400,
            }, 400

        # ── Page 5 validation ────────────────────────────────────────
        agrees_to_report = bool(
            body.get("agreesToReport") or body.get("agrees_to_report")
        )
        if not agrees_to_report:
            return {"message": "agreesToReport must be true", "status": 400}, 400

        # ── Optional page 6 fields ───────────────────────────────────
        additional_notes = (
            body.get("additionalNotes") or body.get("additional_notes") or ""
        ).strip() or None

        raw_attachment_keys = (
            body.get("attachmentKeys") or body.get("attachment_keys") or []
        )
        if not isinstance(raw_attachment_keys, list):
            return {"message": "attachmentKeys must be an array", "status": 400}, 400
        attachment_keys = [
            k
            for k in raw_attachment_keys
            if isinstance(k, str) and k.startswith("event-proposals/")
        ]

        proposal = EventProposal(
            user_id=g.user.id,
            org_id=g.user.org_id,
            title=title,
            co_organizers=(
                body.get("coOrganizers") or body.get("co_organizers") or ""
            ).strip()
            or None,
            event_type=event_type,
            event_format=event_format,
            start_date=start_date,
            end_date=end_date,
            country_id=country_id,
            city_region=city_region,
            venue_name=venue_name,
            description=description,
            attendees=attendees,
            external_orgs=(
                body.get("externalOrgs") or body.get("external_orgs") or ""
            ).strip()
            or None,
            expected_outcomes=expected_outcomes,
            needs_travel=needs_travel,
            num_travelers=num_travelers,
            transport_method=transport_method,
            origin_city=origin_city,
            origin_country_id=origin_country_id,
            destination_city=destination_city,
            destination_country_id=destination_country_id,
            estimated_transport_cost=estimated_transport_cost,
            additional_travel_expenses=json.dumps(additional_travel_expenses),
            currency=currency,
            budget_categories=json.dumps(raw_budget_cats),
            budget_amounts=json.dumps(raw_budget_amounts),
            other_expense_amount=other_expense_amount,
            other_expense_explanation=(
                (
                    body.get("otherExpenseExplanation")
                    or body.get("other_expense_explanation")
                    or ""
                ).strip()
                or None
            ),
            cost_justification=cost_justification,
            agrees_to_report=agrees_to_report,
            attachment_keys=json.dumps(attachment_keys),
            additional_notes=additional_notes,
            status="pending",
        )
        proposal.save()

        return {"status": 200, "proposal": _format_proposal(proposal)}, 200

    # ── My proposals ─────────────────────────────────────────────────

    def _my(self):
        if not g.user:
            return {"message": "Missing user info", "status": 401}, 401

        proposals = (
            EventProposal.query.filter_by(user_id=g.user.id, org_id=g.user.org_id)
            .order_by(EventProposal.submitted_at.desc())
            .all()
        )
        return {
            "status": 200,
            "proposals": [_format_proposal(p) for p in proposals],
        }, 200

    # ── Withdraw ─────────────────────────────────────────────────────

    def _withdraw(self):
        if not g.user:
            return {"message": "Missing user info", "status": 401}, 401

        body = request.json or {}
        proposal_id = body.get("proposal_id") or body.get("id")
        if not proposal_id:
            return {"message": "proposal_id is required", "status": 400}, 400

        proposal = EventProposal.query.get(proposal_id)
        if not proposal:
            return {"message": "Proposal not found", "status": 404}, 404
        if proposal.user_id != g.user.id:
            return {"message": "Forbidden", "status": 403}, 403
        if proposal.status != "pending":
            return {
                "message": "Only pending proposals can be withdrawn",
                "status": 400,
            }, 400

        proposal.update(status="withdrawn")
        return {"status": 200, "proposal": _format_proposal(proposal)}, 200

    # ── Admin: list ──────────────────────────────────────────────────

    @requires_team_admin_or_above
    def _list(self):
        body = request.json or {}
        status_filter = body.get("status")

        query = EventProposal.query.filter_by(org_id=g.user.org_id)
        if not is_org_admin_or_above(g.user):
            managed_ids = managed_team_ids_for(g.user)
            member_user_ids = (
                TeamUser.query.filter(TeamUser.team_id.in_(managed_ids))
                .with_entities(TeamUser.user_id)
                .distinct()
                .all()
            )
            member_user_ids = [r[0] for r in member_user_ids]
            member_user_ids.append(g.user.id)
            query = query.filter(EventProposal.user_id.in_(member_user_ids))

        if status_filter:
            query = query.filter_by(status=status_filter)

        proposals = query.order_by(EventProposal.submitted_at.desc()).all()
        return {
            "status": 200,
            "proposals": [_format_proposal(p) for p in proposals],
        }, 200

    # ── Admin: update status ─────────────────────────────────────────

    @requires_team_admin_or_above
    def _update_status(self):
        body = request.json or {}
        proposal_id = body.get("proposal_id") or body.get("id")
        if not proposal_id:
            return {"message": "proposal_id is required", "status": 400}, 400

        new_status = body.get("status") or ""
        if new_status not in ("approved", "rejected"):
            return {
                "message": "status must be 'approved' or 'rejected'",
                "status": 400,
            }, 400

        proposal = EventProposal.query.get(proposal_id)
        if not proposal:
            return {"message": "Proposal not found", "status": 404}, 404
        if proposal.org_id != g.user.org_id:
            return {"message": "Forbidden", "status": 403}, 403
        if not is_org_admin_or_above(g.user):
            managed_ids = managed_team_ids_for(g.user)
            member_user_ids = [
                r[0]
                for r in (
                    TeamUser.query.filter(TeamUser.team_id.in_(managed_ids))
                    .with_entities(TeamUser.user_id)
                    .distinct()
                    .all()
                )
            ]
            member_user_ids.append(g.user.id)
            if proposal.user_id not in member_user_ids:
                return {"message": "Forbidden", "status": 403}, 403
        if proposal.status not in ("pending",):
            return {
                "message": "Only pending proposals can be reviewed",
                "status": 400,
            }, 400

        reviewer_note = (body.get("reviewer_note") or "").strip() or None
        proposal.update(
            status=new_status,
            reviewed_by=g.user.id,
            reviewed_at=datetime.utcnow(),
            reviewer_note=reviewer_note,
        )

        return {"status": 200, "proposal": _format_proposal(proposal)}, 200

    # ── Upload URL ───────────────────────────────────────────────────────

    def _upload_url(self):
        """Issue a short-lived presigned PUT URL for a supporting-document upload."""
        if not g.user:
            return {"message": "Missing user info", "status": 401}, 401

        body = request.json or {}
        filename = (body.get("filename") or "").strip()
        content_type = (
            body.get("content_type") or ""
        ).strip().lower() or "application/octet-stream"
        if not filename:
            return {"message": "filename required", "status": 400}, 400
        if content_type not in _EVENT_ATTACHMENT_ALLOWED_TYPES:
            return {
                "message": (
                    "Unsupported content_type. Allowed: "
                    + ", ".join(sorted(_EVENT_ATTACHMENT_ALLOWED_TYPES))
                ),
                "status": 400,
            }, 400

        key = f"event-proposals/{g.user.id}/{uuid.uuid4()}/{_safe_event_filename(filename)}"
        try:
            url = _event_presigned_put_url(key, content_type)
        except RuntimeError as e:
            return {"message": str(e), "status": 500}, 500
        return {
            "url": url,
            "key": key,
            "expires_in_seconds": _EVENT_ATTACHMENT_URL_EXPIRES_S,
            "max_bytes": _EVENT_ATTACHMENT_MAX_BYTES,
            "status": 200,
        }, 200
