#!/usr/bin/env python3
"""
ProjectProposalService — database operations for the project proposal
provisioning-queue workflow.

The Flask view delegates to this class; the view retains HTTP request
parsing, auth decorators, permission checks, and response building.
"""

from datetime import datetime, timezone

from ..database import ProjectProposal


class ProjectProposalService:
    """Database operations for the project proposal workflow.

    Construct with the current viewer's ``org_id``; all instance methods
    are org-scoped by construction.
    """

    def __init__(self, org_id: str):
        self.org_id = org_id

    def get_user_proposals(self, user_id: str, status_filter: str = None) -> list:
        """Return a user's own proposals, newest-first."""
        q = ProjectProposal.query.filter(ProjectProposal.user_id == user_id)
        if status_filter:
            q = q.filter(ProjectProposal.status == status_filter)
        return q.order_by(ProjectProposal.submitted_at.desc()).all()

    def get_queue(self, status_filter: str = "pending") -> list:
        """Return proposals for the org, newest-first.

        Pass ``status_filter="all"`` to skip the status clause.
        """
        q = ProjectProposal.query.filter(ProjectProposal.org_id == self.org_id)
        if status_filter != "all":
            q = q.filter(ProjectProposal.status == status_filter)
        return q.order_by(ProjectProposal.submitted_at.desc()).all()

    def submit(
        self,
        user_id: str,
        url: str = None,
        source: str = None,
        proposed_name: str = None,
        short_name: str = None,
        area_description: str = None,
        mapping_rate: float = None,
        validation_rate: float = None,
        visibility: bool = True,
        community: bool = False,
        payments_enabled: bool = False,
        priority: str = "Medium",
    ) -> ProjectProposal:
        """Create and return a new pending ProjectProposal."""
        return ProjectProposal.create(
            user_id=user_id,
            org_id=self.org_id,
            url=url,
            source=source,
            proposed_name=proposed_name,
            short_name=short_name,
            area_description=area_description,
            mapping_rate=mapping_rate,
            validation_rate=validation_rate,
            visibility=visibility,
            community=community,
            payments_enabled=payments_enabled,
            priority=priority,
            status="pending",
        )

    def edit(self, proposal_id, user_id: str, **fields) -> "ProjectProposal | None":
        """Update editable fields on a proposal.

        Validates ownership and that the proposal is in ``changes_requested``
        status. Returns the updated row, or None if not found / not owned / wrong
        status.
        """
        row = ProjectProposal.query.get(proposal_id)
        if not row or row.user_id != user_id:
            return None
        if row.status != "changes_requested":
            return None

        editable = {
            "url", "source", "proposed_name", "short_name", "area_description",
            "mapping_rate", "validation_rate", "visibility", "community",
            "payments_enabled", "priority",
        }
        for key, value in fields.items():
            if key in editable:
                setattr(row, key, value)
        row.save()
        return row

    def resubmit(self, proposal_id, user_id: str) -> "ProjectProposal | None":
        """Set a changes_requested proposal back to pending (requester resubmits).

        Ownership is expected to have already been checked via :meth:`edit`.
        """
        row = ProjectProposal.query.get(proposal_id)
        if not row or row.user_id != user_id:
            return None
        row.status = "pending"
        row.save()
        return row

    def withdraw(self, proposal_id, user_id: str) -> "ProjectProposal | None":
        """Set a pending proposal to withdrawn (requester cancels).

        Returns the updated row, or None if not found / not owned.
        """
        row = ProjectProposal.query.get(proposal_id)
        if not row or row.user_id != user_id:
            return None
        row.status = "withdrawn"
        row.save()
        return row

    def set_status(
        self,
        proposal_id,
        reviewer_id: str,
        new_status: str,
        reviewer_note: str = None,
    ) -> "ProjectProposal | None":
        """Set the status on a proposal and record reviewer info.

        Returns the updated row, or None if not found.
        """
        row = ProjectProposal.query.get(proposal_id)
        if not row:
            return None
        row.status = new_status
        row.reviewed_by = reviewer_id
        row.reviewed_at = datetime.now(timezone.utc)
        if reviewer_note is not None:
            row.reviewer_note = reviewer_note
        row.save()
        return row

    def provision(
        self,
        proposal_id,
        reviewer_id: str,
        url: str,
        source: str,
        proposed_name: str = None,
        short_name: str = None,
        mapping_rate: float = 0.0,
        validation_rate: float = 0.0,
        visibility: bool = True,
        community: bool = False,
        payments_enabled: bool = False,
        priority: str = "Medium",
    ) -> tuple:
        """Provision a project from an approved proposal.

        Calls :meth:`ProjectService.create_tm4_project` or
        :meth:`ProjectService.create_mr_project` based on ``source``.
        Sets ``created_project_id`` and ``provisioned`` status on success.

        Returns ``(proposal, create_result_dict)`` where ``create_result_dict``
        is the plain dict returned by ProjectService (with a ``status`` key).
        """
        from ..services.project_service import ProjectService

        row = ProjectProposal.query.get(proposal_id)
        if not row:
            return None, {"message": "Proposal not found", "status": 404}

        svc = ProjectService()

        if source == "mr":
            result = svc.create_mr_project(
                url=url,
                rate_type=False,
                mapping_rate=float(mapping_rate or 0),
                validation_rate=float(validation_rate or 0),
                visibility=visibility,
                payments_enabled=payments_enabled,
                community=community,
                priority=priority,
                org_id=self.org_id,
                created_by=reviewer_id,
            )
        else:
            result = svc.create_tm4_project(
                url=url,
                rate_type=False,
                mapping_rate=float(mapping_rate or 0),
                validation_rate=float(validation_rate or 0),
                visibility=visibility,
                short_name_input=short_name or "",
                payments_enabled=payments_enabled,
                community=community,
                priority=priority,
                org_id=self.org_id,
                created_by=reviewer_id,
            )

        if result.get("status") != 200:
            return row, result

        # Success: record provisioned state
        row.created_project_id = result.get("project_id")
        row.status = "provisioned"
        row.reviewed_by = reviewer_id
        row.reviewed_at = datetime.now(timezone.utc)
        row.save()
        return row, result
