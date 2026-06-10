"""
Role-tier mapping tests.

The critical contract: Mikro's org-admin role string is "admin" (NOT
"org_admin"), and its JWT carries mikro/roles like ["admin"] / ["super_admin"].
comms must recognize "admin" as the org-admin tier, or every Mikro org admin is
treated as a plain user and gets 403 on admin-gated endpoints (campaigns, org
broadcasts, conversation delete).
"""

from comms.database import Identity, ROLE_PRIORITY
from comms.auth.jwt import _highest_role


def test_mikro_admin_is_org_admin_tier():
    assert ROLE_PRIORITY.get("admin") == ROLE_PRIORITY.get("org_admin")
    assert Identity(sub="x", role="admin").is_admin is True


def test_super_admin_is_admin_tier():
    assert Identity(sub="x", role="super_admin").is_admin is True


def test_auth0_org_owner_is_admin_tier():
    # The JWT carries the Auth0 Organizations role: an org owner sends
    # mikro/roles ["owner"], which must grant the org-admin tier.
    assert _highest_role(["owner"]) == "owner"
    assert Identity(sub="x", role="owner").is_admin is True
    # A plain org member is a regular user.
    assert _highest_role(["member"]) == "member"
    assert Identity(sub="x", role="member").is_admin is False


def test_team_admin_and_below_are_not_org_admin():
    for role in ("user", "validator", "team_admin"):
        assert Identity(sub="x", role=role).is_admin is False


def test_highest_role_maps_mikro_admin_list():
    # The token claim is a list of Mikro DB role strings.
    assert _highest_role(["admin"]) == "admin"
    assert _highest_role(["super_admin"]) == "super_admin"
    assert _highest_role(["team_admin"]) == "team_admin"
    # Unknown strings fall back to "user".
    assert _highest_role(["nonsense"]) == "user"
    # Highest wins when multiple are present.
    assert _highest_role(["user", "admin"]) == "admin"


def test_highest_role_normalizes_case_space_hyphen():
    # The IdP may emit role display names in any casing/format — they must
    # still resolve to the canonical org-admin tier.
    assert _highest_role(["Admin"]) == "admin"
    assert _highest_role(["ADMIN"]) == "admin"
    assert _highest_role(["Super Admin"]) == "super_admin"
    assert _highest_role(["super-admin"]) == "super_admin"
    assert _highest_role(["Org Admin"]) == "org_admin"
    assert _highest_role(["Team Admin"]) == "team_admin"
    assert Identity(sub="x", role=_highest_role(["Super Admin"])).is_admin is True
