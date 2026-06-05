"""
Email-campaign audience format — single source of truth.

Audience identifiers are strings stored verbatim on EmailCampaign.audience:

  "all_org"       → everyone in the sender's org (comms resolves this itself
                    from Identity.org_id)
  "team:<id>"     → members of that team (the CALLING app resolves the
                    recipient subs; comms stays ignorant of any app's teams)
  "region:<id>"   → users in that region (likewise app-resolved)
  "custom"        → an explicit recipient list supplied by the caller

Keep in sync with frontend/mikro-next/src/lib/emailAudience.ts.
"""

from typing import Optional

AUDIENCE_ALL_ORG = "all_org"
AUDIENCE_CUSTOM = "custom"
AUDIENCE_TEAM_PREFIX = "team:"
AUDIENCE_REGION_PREFIX = "region:"


def parse_audience(audience: str) -> tuple[str, Optional[int]]:
    """Parse a stored audience string into (kind, target_id).

    Returns:
      ("all_org", None)
      ("custom", None)
      ("team", <int>)
      ("region", <int>)
      ("unknown", None) — malformed or unknown
    """
    if audience == AUDIENCE_ALL_ORG:
        return "all_org", None
    if audience == AUDIENCE_CUSTOM:
        return "custom", None
    if audience.startswith(AUDIENCE_TEAM_PREFIX):
        try:
            return "team", int(audience[len(AUDIENCE_TEAM_PREFIX) :])
        except (ValueError, IndexError):
            return "unknown", None
    if audience.startswith(AUDIENCE_REGION_PREFIX):
        try:
            return "region", int(audience[len(AUDIENCE_REGION_PREFIX) :])
        except (ValueError, IndexError):
            return "unknown", None
    return "unknown", None


def format_team_audience(team_id: int) -> str:
    return f"{AUDIENCE_TEAM_PREFIX}{team_id}"


def format_region_audience(region_id: int) -> str:
    return f"{AUDIENCE_REGION_PREFIX}{region_id}"
