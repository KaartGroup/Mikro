"""
Tests for the project proposal & provisioning-queue feature.

Two sections:
  1. DB-free formatter + serialiser tests (``ProjectProposalsAPI._format_proposal``).
     No Flask or DB context needed — fakes stand in for ORM rows.
  2. DB-backed service tests (``ProjectProposalService``).
     Uses the shared ``db_session`` fixture (real PostgreSQL, rolled back per test).
     Covers submit, query, withdraw, set_status, edit, and resubmit.
"""

from datetime import datetime, timezone

import pytest
from flask import g

from api.views.ProjectProposals import ProjectProposalsAPI
from api.services.project_proposals import ProjectProposalService
from api.database import User

from tests.conftest import USER_ID, OTHER_USER_ID, ORG


# ── Fake ORM objects for DB-free tests ───────────────────────────────────────


class _FakeProposal:
    def __init__(
        self,
        *,
        id=1,
        user_id="auth0|abc",
        org_id="kaart-org",
        url=None,
        source=None,
        proposed_name=None,
        short_name=None,
        area_description="Map the high desert plateau",
        mapping_rate=None,
        validation_rate=None,
        visibility=True,
        community=False,
        payments_enabled=False,
        priority="Medium",
        status="pending",
        submitted_at=None,
        reviewed_by=None,
        reviewed_at=None,
        reviewer_note=None,
        created_project_id=None,
        user=None,
    ):
        self.id = id
        self.user_id = user_id
        self.org_id = org_id
        self.url = url
        self.source = source
        self.proposed_name = proposed_name
        self.short_name = short_name
        self.area_description = area_description
        self.mapping_rate = mapping_rate
        self.validation_rate = validation_rate
        self.visibility = visibility
        self.community = community
        self.payments_enabled = payments_enabled
        self.priority = priority
        self.status = status
        self.submitted_at = submitted_at
        self.reviewed_by = reviewed_by
        self.reviewed_at = reviewed_at
        self.reviewer_note = reviewer_note
        self.created_project_id = created_project_id
        self.user = user


class _FakeUser:
    def __init__(self, id, first_name="", last_name="", email=""):
        self.id = id
        self.first_name = first_name
        self.last_name = last_name
        self.email = email


# ── Formatter / serialiser tests (DB-free) ───────────────────────────────────


def test_format_proposal_returns_all_required_keys():
    """Pin the JSON shape the frontend's ProjectProposal type depends on.
    If a key is removed or renamed here, the TS type must follow."""
    row = _FakeProposal()
    out = ProjectProposalsAPI._format_proposal(row)
    for key in (
        "id", "user_id", "org_id", "url", "source",
        "proposed_name", "short_name", "area_description",
        "mapping_rate", "validation_rate",
        "visibility", "community", "payments_enabled",
        "priority", "status",
        "submitted_at", "reviewed_by", "reviewed_at",
        "reviewer_note", "created_project_id",
    ):
        assert key in out, f"missing key: {key!r}"


def test_format_proposal_emits_iso_z_timestamps_when_present():
    row = _FakeProposal(
        submitted_at=datetime(2026, 6, 23, 9, 0, 0),
        reviewed_at=datetime(2026, 6, 24, 12, 0, 0),
    )
    out = ProjectProposalsAPI._format_proposal(row)
    assert out["submitted_at"].startswith("2026-06-23T09:00:00")
    assert out["submitted_at"].endswith("Z")
    assert out["reviewed_at"].startswith("2026-06-24T12:00:00")
    assert out["reviewed_at"].endswith("Z")


def test_format_proposal_timestamps_are_none_when_not_set():
    row = _FakeProposal(submitted_at=None, reviewed_at=None)
    out = ProjectProposalsAPI._format_proposal(row)
    assert out["submitted_at"] is None
    assert out["reviewed_at"] is None


def test_format_proposal_url_and_source_nullable():
    """url and source are both optional (no-link proposals).
    Serialiser must not coerce None to a string."""
    row = _FakeProposal(url=None, source=None)
    out = ProjectProposalsAPI._format_proposal(row)
    assert out["url"] is None
    assert out["source"] is None


def test_format_proposal_with_url_passes_through():
    row = _FakeProposal(
        url="https://tasks.kaart.com/projects/42",
        source="tm4",
    )
    out = ProjectProposalsAPI._format_proposal(row)
    assert out["url"] == "https://tasks.kaart.com/projects/42"
    assert out["source"] == "tm4"


def test_format_proposal_include_user_adds_user_name():
    """Admin queue responses attach user_name when include_user=True."""
    fake_user = _FakeUser("u1", first_name="Logan", last_name="Archer")
    row = _FakeProposal(user=fake_user)
    out = ProjectProposalsAPI._format_proposal(row, include_user=True)
    assert "user_name" in out
    assert out["user_name"] == "Logan Archer"


def test_format_proposal_include_user_false_omits_user_name():
    fake_user = _FakeUser("u1", first_name="Logan", last_name="Archer")
    row = _FakeProposal(user=fake_user)
    out = ProjectProposalsAPI._format_proposal(row, include_user=False)
    assert "user_name" not in out


def test_format_proposal_include_user_no_user_omits_user_name_gracefully():
    """If the relationship resolved to None (deleted user), the serialiser
    must not raise — just omit user_name."""
    row = _FakeProposal(user=None)
    out = ProjectProposalsAPI._format_proposal(row, include_user=True)
    assert "user_name" not in out


def test_format_proposal_boolean_fields_are_preserved():
    row = _FakeProposal(visibility=False, community=True, payments_enabled=True)
    out = ProjectProposalsAPI._format_proposal(row)
    assert out["visibility"] is False
    assert out["community"] is True
    assert out["payments_enabled"] is True


def test_format_proposal_created_project_id_nullable():
    row = _FakeProposal(created_project_id=None)
    assert ProjectProposalsAPI._format_proposal(row)["created_project_id"] is None

    row2 = _FakeProposal(created_project_id=7)
    assert ProjectProposalsAPI._format_proposal(row2)["created_project_id"] == 7


# ── DB-backed service tests ───────────────────────────────────────────────────
#
# The ``db_session`` fixture from conftest.py seeds two users (USER_ID,
# OTHER_USER_ID) and rolls back after each test.  We add org_id to them
# here so the service's org-scoped queries work correctly.


@pytest.fixture
def proposal_users(db_session):
    """Patch org_id onto the pre-seeded test users."""
    u1 = db_session.get(User, USER_ID)
    u2 = db_session.get(User, OTHER_USER_ID)
    u1.org_id = ORG
    u2.org_id = ORG
    db_session.flush()
    return u1, u2


def test_service_submit_creates_pending_proposal(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    p = svc.submit(
        user_id=USER_ID,
        area_description="Map the valley floor",
    )
    assert p.id is not None
    assert p.status == "pending"
    assert p.user_id == USER_ID
    assert p.org_id == ORG
    assert p.url is None
    assert p.source is None


def test_service_submit_with_url_stores_source(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    p = svc.submit(
        user_id=USER_ID,
        url="https://tasks.kaart.com/projects/99",
        source="tm4",
    )
    assert p.url == "https://tasks.kaart.com/projects/99"
    assert p.source == "tm4"


def test_service_get_user_proposals_returns_only_own(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    svc.submit(user_id=USER_ID, area_description="mine")
    svc.submit(user_id=OTHER_USER_ID, area_description="theirs")

    mine = svc.get_user_proposals(USER_ID)
    assert all(p.user_id == USER_ID for p in mine)
    assert len(mine) == 1


def test_service_get_user_proposals_newest_first(db_session, proposal_users):
    from datetime import timedelta

    svc = ProjectProposalService(ORG)
    p1 = svc.submit(user_id=USER_ID, area_description="older")
    p2 = svc.submit(user_id=USER_ID, area_description="newer")
    # Force deterministic ordering by stamping submitted_at explicitly.
    p1.submitted_at = datetime(2026, 6, 1, tzinfo=timezone.utc)
    p2.submitted_at = datetime(2026, 6, 23, tzinfo=timezone.utc)
    db_session.flush()

    rows = svc.get_user_proposals(USER_ID)
    assert rows[0].id == p2.id
    assert rows[1].id == p1.id


def test_service_get_user_proposals_status_filter(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    p = svc.submit(user_id=USER_ID, area_description="x")
    # Manually set to deferred so we can filter for it.
    p.status = "deferred"
    db_session.flush()

    # Filter matches.
    deferred = svc.get_user_proposals(USER_ID, status_filter="deferred")
    assert len(deferred) == 1

    # Filter excludes.
    pending = svc.get_user_proposals(USER_ID, status_filter="pending")
    assert len(pending) == 0


def test_service_get_queue_is_org_scoped(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    svc.submit(user_id=USER_ID, area_description="in-org")

    # Proposal for a different org — should not appear.
    other_org_proposal = ProjectProposalService("other-org").submit(
        user_id=USER_ID, area_description="out-of-org"
    )
    # Force its org_id to differ.
    other_org_proposal.org_id = "other-org"
    db_session.flush()

    queue = svc.get_queue()
    assert all(p.org_id == ORG for p in queue)
    assert len(queue) == 1


def test_service_get_queue_all_skips_status_filter(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    p1 = svc.submit(user_id=USER_ID, area_description="a")
    p2 = svc.submit(user_id=USER_ID, area_description="b")
    p2.status = "denied"
    db_session.flush()

    all_rows = svc.get_queue(status_filter="all")
    statuses = {r.status for r in all_rows}
    assert "pending" in statuses
    assert "denied" in statuses


def test_service_withdraw_sets_withdrawn(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    p = svc.submit(user_id=USER_ID, area_description="withdraw me")
    updated = svc.withdraw(p.id, USER_ID)
    assert updated is not None
    assert updated.status == "withdrawn"


def test_service_withdraw_returns_none_for_wrong_user(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    p = svc.submit(user_id=USER_ID, area_description="mine only")
    result = svc.withdraw(p.id, OTHER_USER_ID)
    assert result is None


def test_service_withdraw_returns_none_for_nonexistent_proposal(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    assert svc.withdraw(99999, USER_ID) is None


def test_service_set_status_stamps_reviewer_fields(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    p = svc.submit(user_id=USER_ID, area_description="review me")
    updated = svc.set_status(
        p.id,
        reviewer_id=OTHER_USER_ID,
        new_status="deferred",
        reviewer_note="Revisit next quarter",
    )
    assert updated.status == "deferred"
    assert updated.reviewed_by == OTHER_USER_ID
    assert updated.reviewed_at is not None
    assert updated.reviewer_note == "Revisit next quarter"


def test_service_set_status_none_note_does_not_overwrite_existing(db_session, proposal_users):
    """Passing reviewer_note=None must not wipe a previously stored note."""
    svc = ProjectProposalService(ORG)
    p = svc.submit(user_id=USER_ID, area_description="x")
    svc.set_status(p.id, OTHER_USER_ID, "changes_requested", reviewer_note="Fix this")
    svc.set_status(p.id, OTHER_USER_ID, "pending", reviewer_note=None)
    refreshed = svc.set_status(p.id, OTHER_USER_ID, "pending")
    # reviewer_note was set to "Fix this" and None was NOT passed (so no overwrite).
    assert refreshed.reviewer_note == "Fix this"


def test_service_edit_updates_allowed_fields(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    p = svc.submit(user_id=USER_ID, area_description="original")
    # Force to changes_requested so edit is allowed.
    p.status = "changes_requested"
    db_session.flush()

    updated = svc.edit(
        p.id,
        user_id=USER_ID,
        area_description="revised description",
        mapping_rate=0.5,
    )
    assert updated is not None
    assert updated.area_description == "revised description"
    assert updated.mapping_rate == 0.5


def test_service_edit_rejects_wrong_owner(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    p = svc.submit(user_id=USER_ID, area_description="x")
    p.status = "changes_requested"
    db_session.flush()
    assert svc.edit(p.id, user_id=OTHER_USER_ID, area_description="hack") is None


def test_service_edit_rejects_wrong_status(db_session, proposal_users):
    """edit() only works when status is ``changes_requested``.
    A pending proposal must not be editable (requester can only withdraw it)."""
    svc = ProjectProposalService(ORG)
    p = svc.submit(user_id=USER_ID, area_description="x")
    assert p.status == "pending"
    assert svc.edit(p.id, user_id=USER_ID, area_description="sneaky update") is None


def test_service_resubmit_sets_pending(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    p = svc.submit(user_id=USER_ID, area_description="x")
    p.status = "changes_requested"
    db_session.flush()

    svc.edit(p.id, user_id=USER_ID, area_description="improved")
    result = svc.resubmit(p.id, USER_ID)
    assert result is not None
    assert result.status == "pending"


def test_service_resubmit_returns_none_for_wrong_user(db_session, proposal_users):
    svc = ProjectProposalService(ORG)
    p = svc.submit(user_id=USER_ID, area_description="x")
    p.status = "changes_requested"
    db_session.flush()
    assert svc.resubmit(p.id, OTHER_USER_ID) is None
