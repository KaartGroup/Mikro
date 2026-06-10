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
