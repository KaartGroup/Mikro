#!/usr/bin/env python3
"""
Reimbursements API — editor + admin endpoints for the reimbursement-request
workflow (Trello PkljPEJx).

Routes mounted under ``/api/reimbursements/`` in ``app.py``.

Workflow rules:
  - Editor submits a request -> row in pending state. user_id + org_id
    always derived from g.user (never trusted from body).
  - Editor can withdraw their own pending requests; not after review.
  - Admin can approve (creates paired PaymentAdjustment) or reject (with
    reviewer_note). Admin picks the cycle at approval time.
  - Pay-visibility model: editors see their own rows only; admins see rows
    for users they can ``can_view_pay_for``.

Notifications are stubbed (comms platform not yet built); the three trigger
points are marked TODO comms-platform inline.
"""

import re
import uuid
from datetime import date, datetime
from decimal import Decimal

import boto3
from flask import current_app, g, request
from flask.views import MethodView

from ..auth import can_view_pay_for
from ..database import ReimbursementRequest, User
from ..services.reimbursements import ReimbursementService
from ..utils import requires_team_admin_or_above


# ─── DO Spaces helpers (receipt uploads / fetches) ──────────────────
#
# Issues short-lived signed URLs for editor receipt uploads and admin
# receipt views. The bucket stays private at the DO Spaces ACL level —
# every read is mediated by a backend permission check followed by a
# fresh GET URL signed for that one viewer.

_RECEIPT_ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/heic",
    "application/pdf",
}
_RECEIPT_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_RECEIPT_URL_EXPIRES_S = 300  # 5 minutes


def _spaces_client():
    """boto3 S3 client for DO Spaces."""
    return boto3.client(
        "s3",
        endpoint_url=current_app.config.get("DO_SPACES_ENDPOINT"),
        aws_access_key_id=current_app.config.get("DO_SPACES_KEY"),
        aws_secret_access_key=current_app.config.get("DO_SPACES_SECRET"),
        region_name=current_app.config.get("DO_SPACES_REGION"),
    )


_FILENAME_SAFE_RE = re.compile(r"[^a-zA-Z0-9._-]+")


def _safe_filename(name):
    if not name:
        return "receipt"
    cleaned = _FILENAME_SAFE_RE.sub("_", name).strip("._-")
    return cleaned[-80:] or "receipt"


def _receipt_object_key(user_id, filename):
    return f"reimbursements/{user_id}/{uuid.uuid4()}/{_safe_filename(filename)}"


def _presigned_put_url(key, content_type, max_bytes=_RECEIPT_MAX_BYTES):
    bucket = current_app.config.get("DO_SPACES_BUCKET")
    if not bucket:
        raise RuntimeError("DO_SPACES_BUCKET not configured")
    s3 = _spaces_client()
    return s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": bucket,
            "Key": key,
            "ContentType": content_type,
            "ContentLength": max_bytes,
            "ACL": "private",
        },
        ExpiresIn=_RECEIPT_URL_EXPIRES_S,
        HttpMethod="PUT",
    )


def _presigned_get_url(key):
    bucket = current_app.config.get("DO_SPACES_BUCKET")
    if not bucket:
        raise RuntimeError("DO_SPACES_BUCKET not configured")
    s3 = _spaces_client()
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=_RECEIPT_URL_EXPIRES_S,
        HttpMethod="GET",
    )


def _parse_iso_date(raw):
    """Parse an ISO date (YYYY-MM-DD) from a request payload."""
    if not raw:
        return None
    try:
        if isinstance(raw, date) and not isinstance(raw, datetime):
            return raw
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


class ReimbursementsAPI(MethodView):
    """Reimbursement-request workflow endpoints."""

    def post(self, path: str):
        if path == "submit":
            return self.submit()
        elif path == "my":
            return self.my()
        elif path == "withdraw":
            return self.withdraw()
        elif path == "upload-url":
            return self.upload_url()
        elif path == "pending":
            return self.pending()
        elif path == "approve":
            return self.approve()
        elif path == "reject":
            return self.reject()
        elif path == "attachment-url":
            return self.attachment_url()
        return {"message": f"Unknown reimbursements path: {path}", "status": 404}, 404

    # ── Serialisers ──────────────────────────────────────────────────

    @staticmethod
    def _format_reimbursement(req):
        return {
            "id": req.id,
            "user_id": req.user_id,
            "org_id": req.org_id,
            "amount": float(req.amount) if req.amount is not None else None,
            "description": req.description,
            "attachment_url": req.attachment_url,
            "has_attachment": bool(req.attachment_url),
            "status": req.status,
            "submitted_at": req.submitted_at.isoformat() + "Z" if req.submitted_at else None,
            "reviewed_by": req.reviewed_by,
            "reviewed_at": req.reviewed_at.isoformat() + "Z" if req.reviewed_at else None,
            "reviewer_note": req.reviewer_note,
            "adjustment_id": req.adjustment_id,
        }

    @staticmethod
    def _format_reimbursement_with_user(req, user):
        from ..services.payment_cycle import PaymentCycleService
        out = ReimbursementsAPI._format_reimbursement(req)
        if user is not None:
            out["user_name"] = PaymentCycleService.display_name(user)
            out["user_osm_username"] = user.osm_username or ""
        return out

    # ── Editor endpoints ─────────────────────────────────────────────

    def submit(self):
        """Editor submits a new reimbursement request."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        try:
            amount = Decimal(str(body.get("amount")))
        except Exception:
            return {"message": "amount must be a number", "status": 400}
        if amount <= 0:
            return {"message": "amount must be > 0", "status": 400}

        description = (body.get("description") or "").strip()
        if not description:
            return {"message": "description is required", "status": 400}
        if len(description) > 2000:
            return {"message": "description exceeds 2000 characters", "status": 400}

        attachment_url = (body.get("attachment_url") or "").strip() or None
        if attachment_url and not attachment_url.startswith("reimbursements/"):
            return {
                "message": "attachment_url must be a reimbursements/ object key",
                "status": 400,
            }

        svc = ReimbursementService(g.user.org_id)
        row = svc.submit_reimbursement(
            user_id=g.user.id,
            amount=amount,
            description=description,
            attachment_url=attachment_url,
        )
        # TODO comms-platform: notify org admins of new pending request.
        return {
            "request": self._format_reimbursement(row),
            "message": "Reimbursement request submitted",
            "status": 200,
        }

    def my(self):
        """List the current user's own reimbursement requests."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        status_filter = (body.get("status") or "").strip().lower() or None
        if status_filter and status_filter not in {
            "pending", "approved", "rejected", "withdrawn",
        }:
            return {"message": "invalid status filter", "status": 400}

        svc = ReimbursementService(g.user.org_id)
        rows = svc.get_user_reimbursements(g.user.id, status_filter=status_filter)
        return {
            "requests": [self._format_reimbursement(r) for r in rows],
            "status": 200,
        }

    def withdraw(self):
        """Editor withdraws their own pending request."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        req_id = body.get("request_id")
        if not req_id:
            return {"message": "request_id required", "status": 400}

        existing = ReimbursementRequest.query.get(req_id)
        if not existing or existing.user_id != g.user.id:
            return {"message": "Request not found", "status": 404}
        if existing.status != "pending":
            return {
                "message": f"Cannot withdraw a request in '{existing.status}' state",
                "status": 409,
            }

        svc = ReimbursementService(g.user.org_id)
        row = svc.withdraw_reimbursement(req_id, user_id=g.user.id)
        if row is None:
            return {"message": "Request not found", "status": 404}
        return {
            "request": self._format_reimbursement(row),
            "message": "Reimbursement request withdrawn",
            "status": 200,
        }

    def upload_url(self):
        """Issue a short-lived presigned PUT URL for a receipt upload."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        filename = (body.get("filename") or "").strip()
        content_type = (body.get("content_type") or "").strip().lower()
        if not filename:
            return {"message": "filename required", "status": 400}
        if content_type not in _RECEIPT_ALLOWED_CONTENT_TYPES:
            return {
                "message": (
                    "content_type must be one of: "
                    + ", ".join(sorted(_RECEIPT_ALLOWED_CONTENT_TYPES))
                ),
                "status": 400,
            }

        key = _receipt_object_key(g.user.id, filename)
        try:
            url = _presigned_put_url(key, content_type)
        except RuntimeError as e:
            return {"message": str(e), "status": 500}
        return {
            "url": url,
            "key": key,
            "expires_in_seconds": _RECEIPT_URL_EXPIRES_S,
            "max_bytes": _RECEIPT_MAX_BYTES,
            "status": 200,
        }

    # ── Admin endpoints ──────────────────────────────────────────────

    @requires_team_admin_or_above
    def pending(self):
        """List reimbursement requests visible to this admin."""
        body = request.json or {}
        status_filter = (body.get("status") or "pending").strip().lower()
        if status_filter not in {"pending", "approved", "rejected", "withdrawn", "all"}:
            return {"message": "invalid status filter", "status": 400}

        svc = ReimbursementService(g.user.org_id)
        rows = svc.get_pending_reimbursements(status_filter=status_filter)

        out = []
        for r in rows:
            owner = User.query.get(r.user_id)
            if owner is None:
                continue
            if not can_view_pay_for(g.user, owner):
                continue
            out.append(self._format_reimbursement_with_user(r, owner))
        return {
            "requests": out,
            "pending_count": sum(1 for x in out if x["status"] == "pending"),
            "status": 200,
        }

    @requires_team_admin_or_above
    def approve(self):
        """Approve a pending request → creates the paired PaymentAdjustment."""
        body = request.json or {}
        req_id = body.get("request_id")
        cycle_start = _parse_iso_date(body.get("cycle_start"))
        cycle_end = _parse_iso_date(body.get("cycle_end"))
        reviewer_note = (body.get("reviewer_note") or "").strip() or None

        if not req_id:
            return {"message": "request_id required", "status": 400}
        if not cycle_start or not cycle_end or cycle_end < cycle_start:
            return {"message": "cycle_start + cycle_end required", "status": 400}
        if reviewer_note and len(reviewer_note) > 2000:
            return {"message": "reviewer_note exceeds 2000 characters", "status": 400}

        row = ReimbursementRequest.query.get(req_id)
        if row is None:
            return {"message": "Request not found", "status": 404}
        if row.org_id != g.user.org_id:
            return {"message": "Cross-org request denied", "status": 403}
        if row.status != "pending":
            return {
                "message": f"Cannot approve a request in '{row.status}' state",
                "status": 409,
            }

        owner = User.query.get(row.user_id)
        if owner is None or not can_view_pay_for(g.user, owner):
            return {"message": "Not authorized for this request", "status": 403}

        svc = ReimbursementService(g.user.org_id)
        row, adj = svc.approve_reimbursement(
            request_id=req_id,
            reviewer_id=g.user.id,
            cycle_start=cycle_start,
            cycle_end=cycle_end,
            reviewer_note=reviewer_note,
        )
        # TODO comms-platform: notify editor that their request was approved.
        return {
            "request": self._format_reimbursement(row),
            "adjustment_id": adj.id,
            "message": "Reimbursement approved",
            "status": 200,
        }

    @requires_team_admin_or_above
    def reject(self):
        """Reject a pending request with a required reviewer note."""
        body = request.json or {}
        req_id = body.get("request_id")
        reviewer_note = (body.get("reviewer_note") or "").strip()
        if not req_id:
            return {"message": "request_id required", "status": 400}
        if not reviewer_note:
            return {"message": "reviewer_note is required when rejecting", "status": 400}
        if len(reviewer_note) > 2000:
            return {"message": "reviewer_note exceeds 2000 characters", "status": 400}

        row = ReimbursementRequest.query.get(req_id)
        if row is None:
            return {"message": "Request not found", "status": 404}
        if row.org_id != g.user.org_id:
            return {"message": "Cross-org request denied", "status": 403}
        if row.status != "pending":
            return {
                "message": f"Cannot reject a request in '{row.status}' state",
                "status": 409,
            }

        owner = User.query.get(row.user_id)
        if owner is None or not can_view_pay_for(g.user, owner):
            return {"message": "Not authorized for this request", "status": 403}

        svc = ReimbursementService(g.user.org_id)
        row = svc.reject_reimbursement(
            request_id=req_id,
            reviewer_id=g.user.id,
            reviewer_note=reviewer_note,
        )
        # TODO comms-platform: notify editor of rejection with reason.
        return {
            "request": self._format_reimbursement(row),
            "message": "Reimbursement rejected",
            "status": 200,
        }

    def attachment_url(self):
        """Issue a short-lived signed GET URL for a request's receipt.

        Dual-audience endpoint — no role decorator on purpose. The
        permission check is inline because:

          - The editor (any authenticated user) needs access to their
            own receipts.

          - An admin with ``can_view_pay_for`` access to the owner
            also needs access (to review attached receipts during
            approval triage).

        Auth gating is the ``if not g.user`` check + the explicit
        ownership-OR-pay-visibility branch below. Cross-org is hard-
        denied first via the org_id match.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        req_id = body.get("request_id")
        if not req_id:
            return {"message": "request_id required", "status": 400}

        row = ReimbursementRequest.query.get(req_id)
        if row is None:
            return {"message": "Request not found", "status": 404}
        if not row.attachment_url:
            return {"message": "This request has no attachment", "status": 404}

        # Owner OR admin-with-pay-visibility-for-owner.
        if row.user_id != g.user.id:
            if row.org_id != g.user.org_id:
                return {"message": "Cross-org access denied", "status": 403}
            owner = User.query.get(row.user_id)
            if owner is None or not can_view_pay_for(g.user, owner):
                return {"message": "Not authorized for this request", "status": 403}

        try:
            url = _presigned_get_url(row.attachment_url)
        except RuntimeError as e:
            return {"message": str(e), "status": 500}
        return {
            "url": url,
            "expires_in_seconds": _RECEIPT_URL_EXPIRES_S,
            "status": 200,
        }
