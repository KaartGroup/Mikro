#!/usr/bin/env python3
"""
ProjectProposals API — mapper + admin endpoints for the project proposal
provisioning-queue workflow.

Routes mounted under ``/api/project-proposals/`` in ``app.py``.

Workflow rules:
  - Any authenticated user can submit a proposal.
  - Submitter can view their own proposals (``my``), resubmit after changes
    requested, or withdraw a pending proposal.
  - Team admins and above can view the org queue and act on proposals
    (approve, provision, request_changes, defer, deny).

Two approval paths:
  - With URL: approve → auto-provision → ``provisioned``.
  - Without URL: approve → ``approved`` (awaiting TM4/MR setup), then
    admin calls ``provision`` with the new URL → ``provisioned``.
"""

from flask import g, request
from flask.views import MethodView

from .. import comms_client, users_repo
from ..comms_client import NotificationType
from ..database import ProjectProposal
from ..services.project_proposals import ProjectProposalService
from ..services.project_service import ProjectService
from ..targeting import org_admins_incl_team_admins
from ..utils import requires_auth, requires_team_admin_or_above


class ProjectProposalsAPI(MethodView):
    """Project proposal provisioning-queue endpoints."""

    def post(self, path: str):
        if path == "submit":
            return self.submit()
        elif path == "my":
            return self.my()
        elif path == "resubmit":
            return self.resubmit()
        elif path == "withdraw":
            return self.withdraw()
        elif path == "queue":
            return self.queue()
        elif path == "approve":
            return self.approve()
        elif path == "provision":
            return self.provision()
        elif path == "request_changes":
            return self.request_changes()
        elif path == "defer":
            return self.defer()
        elif path == "deny":
            return self.deny()
        return {"message": f"Unknown project-proposals path: {path}", "status": 404}, 404

    # ── Serialiser ────────────────────────────────────────────────────

    @staticmethod
    def _format_proposal(p, include_user: bool = False) -> dict:
        out = {
            "id": p.id,
            "user_id": p.user_id,
            "org_id": p.org_id,
            "url": p.url,
            "source": p.source,
            "proposed_name": p.proposed_name,
            "short_name": p.short_name,
            "area_description": p.area_description,
            "mapping_rate": p.mapping_rate,
            "validation_rate": p.validation_rate,
            "visibility": p.visibility,
            "community": p.community,
            "payments_enabled": p.payments_enabled,
            "priority": p.priority,
            "status": p.status,
            "submitted_at": (
                p.submitted_at.isoformat() + "Z" if p.submitted_at else None
            ),
            "reviewed_by": p.reviewed_by,
            "reviewed_at": (
                p.reviewed_at.isoformat() + "Z" if p.reviewed_at else None
            ),
            "reviewer_note": p.reviewer_note,
            "created_project_id": p.created_project_id,
        }
        if include_user:
            from ..services.payment_cycle import PaymentCycleService

            user = p.user
            if user is not None:
                out["user_name"] = PaymentCycleService.display_name(user)
        return out

    # ── Authenticated user endpoints ──────────────────────────────────

    @requires_auth
    def submit(self):
        """Any authenticated user submits a new proposal."""
        if not g.user:
            return {"message": "Missing user info", "status": 401}, 401

        body = request.json or {}

        url = (body.get("url") or "").strip() or None
        area_description = (body.get("area_description") or "").strip() or None

        # Validation: if no url, area_description is required.
        if not url and not area_description:
            return {
                "message": "area_description is required when no url is provided",
                "status": 400,
            }

        source = None
        if url:
            source = ProjectService.detect_source(url)

        proposed_name = (body.get("proposed_name") or "").strip() or None
        short_name = (body.get("short_name") or "").strip() or None
        mapping_rate = body.get("mapping_rate")
        validation_rate = body.get("validation_rate")
        visibility = body.get("visibility", True)
        community = bool(body.get("community", False))
        payments_enabled = bool(body.get("payments_enabled", False))
        priority = (body.get("priority") or "Medium").strip()

        svc = ProjectProposalService(g.user.org_id)
        proposal = svc.submit(
            user_id=g.user.id,
            url=url,
            source=source,
            proposed_name=proposed_name,
            short_name=short_name,
            area_description=area_description,
            mapping_rate=float(mapping_rate) if mapping_rate is not None else None,
            validation_rate=float(validation_rate) if validation_rate is not None else None,
            visibility=bool(visibility),
            community=community,
            payments_enabled=payments_enabled,
            priority=priority,
        )

        # Notify all team-admin-or-above users in the org (exclude submitter).
        admins = org_admins_incl_team_admins(g.user.org_id, exclude_user_id=g.user.id)
        if admins:
            comms_client.emit_batch(
                user_ids=[u.id for u in admins],
                org_id=g.user.org_id,
                type=NotificationType.PROJECT_PROPOSAL_SUBMITTED,
                message="A new project proposal has been submitted for review.",
                send_email=False,
            )

        return {
            "proposal": self._format_proposal(proposal),
            "message": "Proposal submitted",
            "status": 200,
        }

    @requires_auth
    def my(self):
        """List the current user's own proposals."""
        if not g.user:
            return {"message": "Missing user info", "status": 401}, 401

        body = request.json or {}
        status_filter = (body.get("status") or "").strip().lower() or None

        svc = ProjectProposalService(g.user.org_id)
        rows = svc.get_user_proposals(g.user.id, status_filter=status_filter)
        return {
            "proposals": [self._format_proposal(p) for p in rows],
            "status": 200,
        }

    @requires_auth
    def resubmit(self):
        """Requester edits and resubmits a changes_requested proposal."""
        if not g.user:
            return {"message": "Missing user info", "status": 401}, 401

        body = request.json or {}
        proposal_id = body.get("proposal_id")
        if not proposal_id:
            return {"message": "proposal_id required", "status": 400}

        existing = ProjectProposal.query.get(proposal_id)
        if not existing or existing.user_id != g.user.id:
            return {"message": "Proposal not found", "status": 404}
        if existing.status != "changes_requested":
            return {
                "message": (
                    f"Cannot resubmit a proposal in '{existing.status}' state"
                ),
                "status": 409,
            }

        # Collect any editable fields from the body.
        editable_fields = {}
        for field in (
            "url", "proposed_name", "short_name", "area_description",
            "mapping_rate", "validation_rate", "visibility", "community",
            "payments_enabled", "priority",
        ):
            if field in body:
                editable_fields[field] = body[field]

        # Re-derive source if url changed.
        if "url" in editable_fields:
            new_url = (editable_fields["url"] or "").strip() or None
            editable_fields["url"] = new_url
            editable_fields["source"] = (
                ProjectService.detect_source(new_url) if new_url else None
            )

        svc = ProjectProposalService(g.user.org_id)
        if editable_fields:
            updated = svc.edit(proposal_id, user_id=g.user.id, **editable_fields)
            if updated is None:
                return {"message": "Edit failed; proposal not found or wrong status", "status": 409}

        row = svc.resubmit(proposal_id, user_id=g.user.id)
        if row is None:
            return {"message": "Proposal not found", "status": 404}

        try:
            comms_client.send_email(
                to=g.user.email,
                subject="Your project proposal has been resubmitted",
                body_html=(
                    "<p>Your project proposal has been resubmitted for review. "
                    "You will be notified once an admin has reviewed it.</p>"
                ),
            )
        except comms_client.CommsError:
            pass

        return {
            "proposal": self._format_proposal(row),
            "message": "Proposal resubmitted",
            "status": 200,
        }

    @requires_auth
    def withdraw(self):
        """Requester withdraws their own pending proposal."""
        if not g.user:
            return {"message": "Missing user info", "status": 401}, 401

        body = request.json or {}
        proposal_id = body.get("proposal_id")
        if not proposal_id:
            return {"message": "proposal_id required", "status": 400}

        existing = ProjectProposal.query.get(proposal_id)
        if not existing or existing.user_id != g.user.id:
            return {"message": "Proposal not found", "status": 404}
        if existing.status != "pending":
            return {
                "message": (
                    f"Cannot withdraw a proposal in '{existing.status}' state"
                ),
                "status": 409,
            }

        svc = ProjectProposalService(g.user.org_id)
        row = svc.withdraw(proposal_id, user_id=g.user.id)
        if row is None:
            return {"message": "Proposal not found", "status": 404}

        return {
            "proposal": self._format_proposal(row),
            "message": "Proposal withdrawn",
            "status": 200,
        }

    # ── Admin endpoints ───────────────────────────────────────────────

    @requires_team_admin_or_above
    def queue(self):
        """List the org's proposal queue (admin view)."""
        body = request.json or {}
        status_filter = (body.get("status") or "pending").strip().lower()

        svc = ProjectProposalService(g.user.org_id)
        rows = svc.get_queue(status_filter=status_filter)
        proposals = [self._format_proposal(p, include_user=True) for p in rows]
        return {
            "proposals": proposals,
            "count": len(proposals),
            "status": 200,
        }

    @requires_team_admin_or_above
    def approve(self):
        """Approve a proposal, provisioning immediately if a URL is available."""
        body = request.json or {}
        proposal_id = body.get("proposal_id")
        if not proposal_id:
            return {"message": "proposal_id required", "status": 400}

        existing = ProjectProposal.query.get(proposal_id)
        if not existing:
            return {"message": "Proposal not found", "status": 404}
        if existing.org_id != g.user.org_id:
            return {"message": "Cross-org request denied", "status": 403}
        if existing.status != "pending":
            return {
                "message": f"Cannot approve a proposal in '{existing.status}' state",
                "status": 409,
            }

        # Determine the effective URL (body may override the proposal's url).
        effective_url = (body.get("url") or "").strip() or existing.url
        effective_source = (
            ProjectService.detect_source(effective_url) if effective_url else existing.source
        )

        svc = ProjectProposalService(g.user.org_id)

        if effective_url:
            # Provision immediately.
            mapping_rate = body.get("mapping_rate", existing.mapping_rate) or 0
            validation_rate = body.get("validation_rate", existing.validation_rate) or 0
            visibility = body.get("visibility", existing.visibility)
            if visibility is None:
                visibility = True
            community = bool(body.get("community", existing.community))
            payments_enabled = bool(body.get("payments_enabled", existing.payments_enabled))
            priority = (body.get("priority") or existing.priority or "Medium").strip()
            short_name = (
                (body.get("short_name") or existing.short_name or "").strip()
            )
            proposed_name = (
                (body.get("proposed_name") or existing.proposed_name or "").strip() or None
            )

            row, result = svc.provision(
                proposal_id=proposal_id,
                reviewer_id=g.user.id,
                url=effective_url,
                source=effective_source,
                proposed_name=proposed_name,
                short_name=short_name,
                mapping_rate=float(mapping_rate),
                validation_rate=float(validation_rate),
                visibility=bool(visibility),
                community=community,
                payments_enabled=payments_enabled,
                priority=priority,
            )

            # Pass through non-200 errors from ProjectService.
            if result.get("status") != 200:
                return result, result.get("status", 400)

            requester = users_repo.by_id(existing.user_id)
            if requester and requester.email:
                try:
                    comms_client.send_email(
                        to=requester.email,
                        subject="Your project proposal has been approved and provisioned",
                        body_html=(
                            "<p>Your project proposal has been approved and the project "
                            "has been created in Mikro. You can find it in the Projects list.</p>"
                        ),
                    )
                except comms_client.CommsError:
                    pass

            return {
                "proposal": self._format_proposal(row),
                "message": "Proposal approved and project provisioned",
                "status": 200,
            }

        else:
            # No URL — set to approved only; admin will provision later.
            reviewer_note = (body.get("reviewer_note") or "").strip() or None
            row = svc.set_status(
                proposal_id=proposal_id,
                reviewer_id=g.user.id,
                new_status="approved",
                reviewer_note=reviewer_note,
            )

            requester = users_repo.by_id(existing.user_id)
            if requester and requester.email:
                try:
                    comms_client.send_email(
                        to=requester.email,
                        subject="Your project proposal has been approved",
                        body_html=(
                            "<p>Your project proposal has been approved. "
                            "An admin will set up the project shortly.</p>"
                        ),
                    )
                except comms_client.CommsError:
                    pass

            return {
                "proposal": self._format_proposal(row),
                "message": "Proposal approved",
                "status": 200,
            }

    @requires_team_admin_or_above
    def provision(self):
        """Provision a project for an already-approved (no-link-path) proposal."""
        body = request.json or {}
        proposal_id = body.get("proposal_id")
        url = (body.get("url") or "").strip()

        if not proposal_id:
            return {"message": "proposal_id required", "status": 400}
        if not url:
            return {"message": "url is required for provisioning", "status": 400}

        existing = ProjectProposal.query.get(proposal_id)
        if not existing:
            return {"message": "Proposal not found", "status": 404}
        if existing.org_id != g.user.org_id:
            return {"message": "Cross-org request denied", "status": 403}
        if existing.status != "approved":
            return {
                "message": (
                    f"Can only provision a proposal in 'approved' status; "
                    f"current status is '{existing.status}'"
                ),
                "status": 409,
            }

        source = ProjectService.detect_source(url)
        mapping_rate = body.get("mapping_rate", existing.mapping_rate) or 0
        validation_rate = body.get("validation_rate", existing.validation_rate) or 0
        visibility = body.get("visibility", existing.visibility)
        if visibility is None:
            visibility = True
        community = bool(body.get("community", existing.community))
        payments_enabled = bool(body.get("payments_enabled", existing.payments_enabled))
        priority = (body.get("priority") or existing.priority or "Medium").strip()
        short_name = (body.get("short_name") or existing.short_name or "").strip()
        proposed_name = (body.get("proposed_name") or existing.proposed_name or "").strip() or None

        svc = ProjectProposalService(g.user.org_id)
        row, result = svc.provision(
            proposal_id=proposal_id,
            reviewer_id=g.user.id,
            url=url,
            source=source,
            proposed_name=proposed_name,
            short_name=short_name,
            mapping_rate=float(mapping_rate),
            validation_rate=float(validation_rate),
            visibility=bool(visibility),
            community=community,
            payments_enabled=payments_enabled,
            priority=priority,
        )

        if result.get("status") != 200:
            return result, result.get("status", 400)

        requester = users_repo.by_id(existing.user_id)
        if requester and requester.email:
            try:
                comms_client.send_email(
                    to=requester.email,
                    subject="Your project proposal has been provisioned",
                    body_html=(
                        "<p>Your approved project proposal has been provisioned and the "
                        "project is now available in Mikro.</p>"
                    ),
                )
            except comms_client.CommsError:
                pass

        return {
            "proposal": self._format_proposal(row),
            "message": "Project provisioned",
            "status": 200,
        }

    @requires_team_admin_or_above
    def request_changes(self):
        """Request changes on a pending proposal."""
        body = request.json or {}
        proposal_id = body.get("proposal_id")
        reviewer_note = (body.get("reviewer_note") or "").strip()

        if not proposal_id:
            return {"message": "proposal_id required", "status": 400}
        if not reviewer_note:
            return {"message": "reviewer_note is required when requesting changes", "status": 400}

        existing = ProjectProposal.query.get(proposal_id)
        if not existing:
            return {"message": "Proposal not found", "status": 404}
        if existing.org_id != g.user.org_id:
            return {"message": "Cross-org request denied", "status": 403}
        if existing.status != "pending":
            return {
                "message": f"Cannot request changes on a proposal in '{existing.status}' state",
                "status": 409,
            }

        svc = ProjectProposalService(g.user.org_id)
        row = svc.set_status(
            proposal_id=proposal_id,
            reviewer_id=g.user.id,
            new_status="changes_requested",
            reviewer_note=reviewer_note,
        )

        requester = users_repo.by_id(existing.user_id)
        if requester and requester.email:
            try:
                comms_client.send_email(
                    to=requester.email,
                    subject="Changes requested on your project proposal",
                    body_html=(
                        f"<p>An admin has requested changes to your project proposal.</p>"
                        f"<p><strong>Note from reviewer:</strong> {reviewer_note}</p>"
                        f"<p>Please update your proposal and resubmit.</p>"
                    ),
                )
            except comms_client.CommsError:
                pass

        return {
            "proposal": self._format_proposal(row),
            "message": "Changes requested",
            "status": 200,
        }

    @requires_team_admin_or_above
    def defer(self):
        """Defer a pending proposal for later review."""
        body = request.json or {}
        proposal_id = body.get("proposal_id")
        reviewer_note = (body.get("reviewer_note") or "").strip() or None

        if not proposal_id:
            return {"message": "proposal_id required", "status": 400}

        existing = ProjectProposal.query.get(proposal_id)
        if not existing:
            return {"message": "Proposal not found", "status": 404}
        if existing.org_id != g.user.org_id:
            return {"message": "Cross-org request denied", "status": 403}
        if existing.status != "pending":
            return {
                "message": f"Cannot defer a proposal in '{existing.status}' state",
                "status": 409,
            }

        svc = ProjectProposalService(g.user.org_id)
        row = svc.set_status(
            proposal_id=proposal_id,
            reviewer_id=g.user.id,
            new_status="deferred",
            reviewer_note=reviewer_note,
        )

        return {
            "proposal": self._format_proposal(row),
            "message": "Proposal deferred",
            "status": 200,
        }

    @requires_team_admin_or_above
    def deny(self):
        """Deny a pending proposal with a required reviewer note."""
        body = request.json or {}
        proposal_id = body.get("proposal_id")
        reviewer_note = (body.get("reviewer_note") or "").strip()

        if not proposal_id:
            return {"message": "proposal_id required", "status": 400}
        if not reviewer_note:
            return {"message": "reviewer_note is required when denying a proposal", "status": 400}

        existing = ProjectProposal.query.get(proposal_id)
        if not existing:
            return {"message": "Proposal not found", "status": 404}
        if existing.org_id != g.user.org_id:
            return {"message": "Cross-org request denied", "status": 403}
        if existing.status != "pending":
            return {
                "message": f"Cannot deny a proposal in '{existing.status}' state",
                "status": 409,
            }

        svc = ProjectProposalService(g.user.org_id)
        row = svc.set_status(
            proposal_id=proposal_id,
            reviewer_id=g.user.id,
            new_status="denied",
            reviewer_note=reviewer_note,
        )

        requester = users_repo.by_id(existing.user_id)
        if requester and requester.email:
            try:
                comms_client.send_email(
                    to=requester.email,
                    subject="Your project proposal has been denied",
                    body_html=(
                        f"<p>Your project proposal has been denied by a reviewer.</p>"
                        f"<p><strong>Reason:</strong> {reviewer_note}</p>"
                    ),
                )
            except comms_client.CommsError:
                pass

        return {
            "proposal": self._format_proposal(row),
            "message": "Proposal denied",
            "status": 200,
        }
