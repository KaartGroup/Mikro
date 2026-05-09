"""
Pay-field visibility policy — single source of truth.

Who can see a user's hourly_rate, payment_email, or running-balance
fields (payable_total, paid_total, etc.) on any API response?

Three-tier admin model (in effect 2026-05):
  - The target user themselves — always.
  - role == "super_admin" — always (cross-org reserved for future).
  - role == "admin" (Org Admin) — always for users in the same org.
  - role == "team_admin" — only when the target is a member of any
    team this viewer leads. Cross-team peers still hidden.
  - role == "validator" / "user" — never.

`can_view_pay_for` is the ONLY place the rule changes when roles or
scoping evolve. Endpoints don't need updating — they call
`redact_pay_fields(dict, viewer, target)` and the policy is enforced
centrally.
"""

from typing import Iterable

from .team_scoping import team_admin_can_access_user


# Any response field whose presence exposes pay/contact-for-pay data.
# Adding a new column to User that carries money/PII? Add it here AND
# check that every existing endpoint returning User data either uses
# redact_pay_fields or is explicitly admin/self-gated.
PAY_FIELDS: frozenset[str] = frozenset({
    "hourly_rate",
    "hourlyRate",               # camelCase variant used by a few serializers
    "payment_email",
    "paymentEmail",
    "payable_total",
    "mapping_payable_total",
    "validation_payable_total",
    "checklist_payable_total",
    "requested_total",
    "paid_total",
    "total_payout",             # alias used in fetch_user_details response
    "awaiting_payment",         # alias for requested_total in fetch_users
    "validated_tasks_amounts",  # computed earnings-like field
    "mapping_earnings",
    "validation_earnings",
    "checklist_earnings",
    "earnings",
    "amount_due",
    "amount_paid",
    "amount_requested",
})


def can_view_pay_for(viewer, target) -> bool:
    """True if `viewer` is authorized to see `target`'s pay fields.

    `viewer` and `target` are `User` records (or anything with `id`,
    `role`, `org_id` attributes). Either being None returns False —
    fail closed.
    """
    if viewer is None or target is None:
        return False
    # Self is always allowed — a contractor can see their own rate.
    viewer_id = getattr(viewer, "id", None)
    target_id = getattr(target, "id", None)
    if viewer_id is not None and viewer_id == target_id:
        return True
    viewer_role = getattr(viewer, "role", None)
    # Org Admin and Super Admin: full visibility within shared org_id.
    if viewer_role in {"admin", "super_admin"}:
        # Cross-org leakage rail: viewer must share org with target.
        # Today every admin's org matches every target's org because
        # the data model is single-tenant under the hood (see F4).
        # When external orgs land, this still does the right thing.
        viewer_org = getattr(viewer, "org_id", None)
        target_org = getattr(target, "org_id", None)
        if viewer_role == "super_admin":
            # Super admin will eventually see across orgs; today the
            # backend filters by g.user.org_id everywhere so this
            # branch only matters if/when cross-org reads land.
            return True
        return viewer_org is not None and viewer_org == target_org
    # Team Admin: visible if target is a member of any team viewer leads.
    if viewer_role == "team_admin":
        return team_admin_can_access_user(viewer, target_id)
    return False


def redact_pay_fields(data: dict, viewer, target, *, fields: Iterable[str] = PAY_FIELDS) -> dict:
    """Strip pay fields from `data` unless `viewer` may see `target`'s pay.

    Mutates and returns `data`. Unauthorized callers get a dict with the
    same shape minus the sensitive keys — no None placeholders, so the
    absence is loud to anyone inspecting the response.

    Endpoints already gated by `@requires_admin` with no non-admin code
    path don't need this helper (admins always pass the check). It's
    meant for mixed-audience endpoints: anything that serves both a user
    viewing their own record and an admin viewing someone else's.
    """
    if can_view_pay_for(viewer, target):
        return data
    for field in fields:
        data.pop(field, None)
    return data
