"""
Unit tests for the reimbursement-flow helpers in
``api/views/Payments.py``.

Scope: the pure module-level helpers and the static formatters on
``PaymentsAPI``. The endpoint methods themselves rely on Flask's
``g`` and ``request`` globals plus SQLAlchemy session writes, so
they're covered by manual smoke + future integration tests. The
helpers tested here are the validation primitives + formatter
contracts that the endpoint methods stitch together.

DB-free + Flask-free; matches the style of test_subcategories.py
and test_payments_compute.py.
"""

from decimal import Decimal

from api.views.Payments import (
    PaymentsAPI,
    _RECEIPT_ALLOWED_CONTENT_TYPES,
    _RECEIPT_MAX_BYTES,
    _receipt_object_key,
    _safe_filename,
)


# ─── _safe_filename ──────────────────────────────────────────────


def test_safe_filename_keeps_simple_names_intact():
    assert _safe_filename("receipt.jpg") == "receipt.jpg"
    assert _safe_filename("2026-04-15-coffee.png") == "2026-04-15-coffee.png"


def test_safe_filename_replaces_unsafe_characters_with_underscore():
    """Anything outside [a-zA-Z0-9._-] becomes an underscore. Spaces
    and quotes shouldn't survive — they corrupt some S3 client URL
    encoders + show ugly in audit logs."""
    assert _safe_filename("my receipt.jpg") == "my_receipt.jpg"
    assert _safe_filename("Andy's hotel bill.pdf") == "Andy_s_hotel_bill.pdf"


def test_safe_filename_strips_leading_and_trailing_separators():
    """Leading/trailing dots/underscores/hyphens are stripped so we
    don't end up with hidden-file-like keys like ``.receipt`` that
    behave oddly in some object listings."""
    assert _safe_filename("...receipt.jpg") == "receipt.jpg"
    assert _safe_filename("__weird__.pdf") == "weird__.pdf"


def test_safe_filename_caps_long_names_to_a_safe_tail():
    """An 80-char tail is plenty for any reasonable receipt name and
    keeps the Spaces object key under length limits (whole key path
    has a budget)."""
    too_long = "x" * 200 + ".jpg"
    out = _safe_filename(too_long)
    assert len(out) <= 80
    assert out.endswith(".jpg")


def test_safe_filename_handles_missing_or_empty_input():
    """Editor with no file (shouldn't reach the sanitizer, but defensive)
    OR a file whose name sanitizes away to nothing both fall back to a
    fixed name so the key is never empty."""
    assert _safe_filename("") == "receipt"
    assert _safe_filename(None) == "receipt"
    # An all-special-character name sanitizes to empty -> fallback.
    assert _safe_filename("!!!@@@") == "receipt"


# ─── _receipt_object_key ─────────────────────────────────────────


def test_receipt_object_key_uses_expected_prefix_and_shape():
    """Key shape is ``reimbursements/<user_id>/<uuid>/<safe-filename>``.
    The UUID segment guarantees uniqueness even if the same editor
    uploads two receipts named the same thing in the same minute."""
    key = _receipt_object_key("auth0|abc123", "lunch.png")
    parts = key.split("/")
    assert parts[0] == "reimbursements"
    assert parts[1] == "auth0|abc123"
    assert len(parts) == 4
    # UUID4 string is 36 chars (8-4-4-4-12 + hyphens).
    assert len(parts[2]) == 36
    assert parts[3] == "lunch.png"


def test_receipt_object_key_sanitizes_the_filename_segment():
    key = _receipt_object_key("u1", "my big receipt.pdf")
    assert key.endswith("my_big_receipt.pdf")


def test_receipt_object_key_uniqueness_across_calls_for_same_user_and_name():
    """The UUID prefix means two calls with identical inputs always
    produce distinct keys. Without this, simultaneous uploads from a
    single editor could overwrite each other on Spaces."""
    a = _receipt_object_key("u1", "receipt.jpg")
    b = _receipt_object_key("u1", "receipt.jpg")
    assert a != b


# ─── Constants surface ───────────────────────────────────────────


def test_receipt_content_type_whitelist_matches_frontend():
    """Backend whitelist must match the frontend's ALLOWED_RECEIPT_TYPES
    in ReimbursementsSection.tsx. If you add a type to one, add it to
    both."""
    assert _RECEIPT_ALLOWED_CONTENT_TYPES == {
        "image/jpeg",
        "image/png",
        "image/heic",
        "application/pdf",
    }


def test_receipt_max_bytes_is_10_megabytes():
    """10 MB is the documented limit in the frontend file-picker
    helper text — keep both sides in sync."""
    assert _RECEIPT_MAX_BYTES == 10 * 1024 * 1024


# ─── _format_reimbursement (static method on PaymentsAPI) ────────


class _FakeReimbursement:
    def __init__(
        self,
        *,
        id=1,
        user_id="auth0|abc",
        org_id="kaart-org",
        amount=Decimal("42.50"),
        description="taxi to airport",
        attachment_url=None,
        status="pending",
        submitted_at=None,
        reviewed_by=None,
        reviewed_at=None,
        reviewer_note=None,
        adjustment_id=None,
    ):
        self.id = id
        self.user_id = user_id
        self.org_id = org_id
        self.amount = amount
        self.description = description
        self.attachment_url = attachment_url
        self.status = status
        self.submitted_at = submitted_at
        self.reviewed_by = reviewed_by
        self.reviewed_at = reviewed_at
        self.reviewer_note = reviewer_note
        self.adjustment_id = adjustment_id


class _FakeUser:
    def __init__(self, id, first_name="", last_name="", email="", osm_username=""):
        self.id = id
        self.first_name = first_name
        self.last_name = last_name
        self.email = email
        self.osm_username = osm_username


def test_format_reimbursement_returns_expected_shape():
    """Pin the JSON keys the frontend depends on. If anything renames
    here, the type in types/index.ts has to follow."""
    row = _FakeReimbursement()
    out = PaymentsAPI._format_reimbursement(row)
    # Required keys present.
    for key in (
        "id", "user_id", "org_id", "amount", "description",
        "attachment_url", "has_attachment", "status",
        "submitted_at", "reviewed_by", "reviewed_at",
        "reviewer_note", "adjustment_id",
    ):
        assert key in out, f"missing key: {key}"


def test_format_reimbursement_coerces_decimal_amount_to_float():
    """Decimal serializes to JSON quirky in some stacks; cast to float
    at format time so the frontend's `amount: number` type holds."""
    row = _FakeReimbursement(amount=Decimal("123.45"))
    out = PaymentsAPI._format_reimbursement(row)
    assert isinstance(out["amount"], float)
    assert out["amount"] == 123.45


def test_format_reimbursement_has_attachment_reflects_attachment_url_truthiness():
    no_attach = _FakeReimbursement(attachment_url=None)
    with_attach = _FakeReimbursement(attachment_url="reimbursements/abc/uuid/r.jpg")
    assert PaymentsAPI._format_reimbursement(no_attach)["has_attachment"] is False
    assert PaymentsAPI._format_reimbursement(with_attach)["has_attachment"] is True


def test_format_reimbursement_emits_iso_z_timestamps_when_present_and_none_when_not():
    from datetime import datetime
    row = _FakeReimbursement(
        submitted_at=datetime(2026, 5, 21, 14, 30, 0),
        reviewed_at=None,
    )
    out = PaymentsAPI._format_reimbursement(row)
    assert out["submitted_at"].startswith("2026-05-21T14:30:00")
    assert out["submitted_at"].endswith("Z")
    assert out["reviewed_at"] is None


def test_format_reimbursement_with_user_adds_user_name_and_osm_username():
    """The admin queue table needs the editor's display name + OSM
    handle inline so it can render without a second round-trip."""
    row = _FakeReimbursement(user_id="u1")
    user = _FakeUser("u1", first_name="Logan", last_name="Foo", osm_username="logan_osm")
    out = PaymentsAPI._format_reimbursement_with_user(row, user)
    assert out["user_name"] == "Logan Foo"
    assert out["user_osm_username"] == "logan_osm"


def test_format_reimbursement_with_user_handles_missing_user_gracefully():
    """If the owner lookup returned None (deleted user race), the
    formatter still produces a valid row — admin sees the request
    but with no user-display fields. Never crash."""
    row = _FakeReimbursement(user_id="u1")
    out = PaymentsAPI._format_reimbursement_with_user(row, None)
    # Required keys still present.
    assert out["id"] == row.id
    # User-display keys are absent.
    assert "user_name" not in out
    assert "user_osm_username" not in out


def test_format_reimbursement_with_user_handles_user_with_no_name_falls_back_to_email_or_id():
    """_user_display_name(user) handles its own fallback chain (full
    name -> email -> id). This test pins that the admin queue uses
    whichever fallback _user_display_name decides on."""
    row = _FakeReimbursement(user_id="u1")
    user_email_only = _FakeUser("u1", email="logan@kaart.com")
    out = PaymentsAPI._format_reimbursement_with_user(row, user_email_only)
    assert out["user_name"] == "logan@kaart.com"

    user_id_only = _FakeUser("u1")
    out2 = PaymentsAPI._format_reimbursement_with_user(row, user_id_only)
    assert out2["user_name"] == "u1"
