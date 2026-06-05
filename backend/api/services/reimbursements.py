#!/usr/bin/env python3
"""
ReimbursementService — database operations for the reimbursement-request
workflow.

The Flask view delegates to this
class; the view retains HTTP request parsing, auth decorators, permission
checks, and response building.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

from ..database import (
    PaymentAdjustment,
    ReimbursementRequest,
)


class ReimbursementService:
    """Database operations for the reimbursement-request workflow.

    Construct with the current viewer's ``org_id``; all instance methods
    are org-scoped by construction.
    """

    def __init__(self, org_id: str):
        self.org_id = org_id

    def get_user_reimbursements(
        self, user_id: str, status_filter: str = None
    ) -> list:
        """Return a user's own reimbursement requests, newest-first."""
        q = ReimbursementRequest.query.filter(
            ReimbursementRequest.user_id == user_id
        )
        if status_filter:
            q = q.filter(ReimbursementRequest.status == status_filter)
        return q.order_by(ReimbursementRequest.submitted_at.desc()).all()

    def get_pending_reimbursements(self, status_filter: str = "pending") -> list:
        """Return reimbursement requests for the org, newest-first.

        Pass ``status_filter="all"`` to skip the status clause.
        """
        q = ReimbursementRequest.query.filter(
            ReimbursementRequest.org_id == self.org_id
        )
        if status_filter != "all":
            q = q.filter(ReimbursementRequest.status == status_filter)
        return q.order_by(ReimbursementRequest.submitted_at.desc()).all()

    def submit_reimbursement(
        self,
        user_id: str,
        amount: Decimal,
        description: str,
        attachment_url: str = None,
    ) -> ReimbursementRequest:
        """Create and return a new pending ReimbursementRequest."""
        return ReimbursementRequest.create(
            user_id=user_id,
            org_id=self.org_id,
            amount=amount,
            description=description,
            attachment_url=attachment_url,
            status="pending",
        )

    def withdraw_reimbursement(
        self, request_id, user_id: str
    ) -> ReimbursementRequest | None:
        """Set a pending request to withdrawn (editor action).

        Returns the updated row, or None if not found / not owned by
        user_id. Callers must verify the row is still ``pending`` before
        calling — state-machine check stays in the view.
        """
        row = ReimbursementRequest.query.get(request_id)
        if not row or row.user_id != user_id:
            return None
        row.status = "withdrawn"
        row.save()
        return row

    def approve_reimbursement(
        self,
        request_id,
        reviewer_id: str,
        cycle_start: date,
        cycle_end: date,
        reviewer_note: str = None,
    ) -> tuple[ReimbursementRequest, PaymentAdjustment]:
        """Approve a pending request and create the paired PaymentAdjustment.

        Returns ``(ReimbursementRequest, PaymentAdjustment)``. The caller
        is responsible for verifying the request is ``pending`` and that
        the reviewer has ``can_view_pay_for`` access to the owner.
        """
        row = ReimbursementRequest.query.get(request_id)
        adj = PaymentAdjustment.create(
            user_id=row.user_id,
            cycle_start=cycle_start,
            cycle_end=cycle_end,
            amount=row.amount,
            type="reimbursement",
            note=row.description,
            source="approved_request",
            request_id=row.id,
            added_by=reviewer_id,
        )
        row.status = "approved"
        row.reviewed_by = reviewer_id
        row.reviewed_at = datetime.now(timezone.utc)
        row.reviewer_note = reviewer_note
        row.adjustment_id = adj.id
        row.save()
        return row, adj

    def reject_reimbursement(
        self, request_id, reviewer_id: str, reviewer_note: str
    ) -> ReimbursementRequest | None:
        """Reject a pending request. Returns the row, or None if not found.

        The caller is responsible for verifying the request is ``pending``
        and that the reviewer has ``can_view_pay_for`` access to the owner.
        """
        row = ReimbursementRequest.query.get(request_id)
        if not row:
            return None
        row.status = "rejected"
        row.reviewed_by = reviewer_id
        row.reviewed_at = datetime.now(timezone.utc)
        row.reviewer_note = reviewer_note
        row.save()
        return row
