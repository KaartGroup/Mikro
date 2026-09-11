#!/usr/bin/env python3
"""
Reconcile Auth0 Organization membership against Mikro's ``users.org_id``.

WHY THIS EXISTS
---------------
Mikro grew two independent, unreconciled notions of "this user belongs to this
organization":

  A. **Auth0 Organization membership** — granted by
     ``api/utils/auth0_org.py::add_or_invite_user_to_org`` via the Management
     API. This is what lets an org-scoped login succeed and what makes Auth0
     emit the native ``org_id`` claim.

  B. **``users.org_id`` in Mikro's own database** — what every scoping query in
     the backend actually filters on (``UserScope``, ``team_scoping``, reports,
     payments, time tracking — ~20 modules).

Nothing ever compared them. A user could hold B without A, which is precisely
the 2026-09-10 report: a confirmed member (per Mikro's database) picked "Kaart"
in the Auth0 organization picker and was shown "No Organization Found", because
Auth0 had no membership to scope the login to. The reverse drift — A without B
— is equally silent: the person can authenticate but has no Mikro row, so they
are invisible to their admins.

This module answers "where do the two disagree?" It is **read-only**. It never
writes to Auth0 or the database; remediation is a deliberate, separate act.

USAGE
-----
As a library::

    from ..services.org_reconcile import reconcile_org

    report = reconcile_org("org_XXXXXXXX")

As a script, from ``backend/`` with the venv active::

    python -m api.services.org_reconcile org_XXXXXXXX
"""

from flask import current_app
import requests

from ..auth import get_auth0_management_api_token
from ..database import Organization, User

# Auth0 caps organization member pages at 100.
_PAGE_SIZE = 100
# Refuse to walk forever if the API keeps handing back pages.
_MAX_PAGES = 100


def _log(level, msg, *args):
    """Log through Flask when in an app context, else print (script mode)."""
    try:
        getattr(current_app.logger, level)(msg, *args)
    except Exception:
        print(msg % args if args else msg)


def fetch_auth0_org_members(org_id, token=None):
    """
    Every member of Auth0 organization ``org_id``.

    Returns ``(members, error)`` where ``members`` is a list of dicts with
    ``user_id``/``email`` and ``error`` is None on success. On failure returns
    ``([], "reason")`` — callers must distinguish "no members" from "could not
    ask", because treating an API failure as an empty membership list would
    make every user look like drift.
    """
    domain = current_app.config.get("AUTH0_DOMAIN") if current_app else None
    if not domain:
        return [], "AUTH0_DOMAIN not configured"

    token = token or get_auth0_management_api_token()
    if not token:
        return [], "could not obtain Auth0 Management API token"

    headers = {"Authorization": f"Bearer {token}"}
    url = f"https://{domain}/api/v2/organizations/{org_id}/members"

    members = []
    page = 0
    while page < _MAX_PAGES:
        try:
            resp = requests.get(
                url,
                params={"page": page, "per_page": _PAGE_SIZE},
                headers=headers,
                timeout=30,
            )
        except requests.RequestException as e:
            return [], f"request failed on page {page}: {e}"

        if resp.status_code == 404:
            return [], f"organization {org_id!r} not found in Auth0"
        if not resp.ok:
            return [], f"Auth0 returned {resp.status_code} on page {page}"

        try:
            batch = resp.json() or []
        except ValueError:
            return [], f"non-JSON response on page {page}"

        if not isinstance(batch, list):
            return [], f"unexpected response shape on page {page}"

        members.extend(batch)
        if len(batch) < _PAGE_SIZE:
            return members, None
        page += 1

    return members, f"stopped after {_MAX_PAGES} pages (possible pagination loop)"


def reconcile_org(org_id):
    """
    Compare Auth0 membership with ``users.org_id`` for one organization.

    Returns a dict::

        {
          "org_id": str,
          "org_status": "active" | "disabled" | None,   # None = no local row
          "error": str | None,        # set => the comparison did NOT run
          "auth0_member_count": int,
          "mikro_user_count": int,
          "in_mikro_not_auth0": [ {id, email} ],  # can't use the org picker
          "in_auth0_not_mikro": [ {user_id, email} ],  # invisible to admins
          "aligned_count": int,
        }

    ``in_mikro_not_auth0`` is the drift class that produced the 2026-09-10
    lockout: the database says they are a member, Auth0 does not, so an
    org-scoped login cannot be established for them.
    """
    report = {
        "org_id": org_id,
        "org_status": None,
        "error": None,
        "auth0_member_count": 0,
        "mikro_user_count": 0,
        "in_mikro_not_auth0": [],
        "in_auth0_not_mikro": [],
        "aligned_count": 0,
    }

    org_row = Organization.query.filter_by(id=org_id).first()
    report["org_status"] = getattr(org_row, "status", None)

    members, error = fetch_auth0_org_members(org_id)
    if error:
        # Bail out rather than report every user as drift.
        report["error"] = error
        _log("warning", "[ORG-RECONCILE] org=%s aborted: %s", org_id, error)
        return report

    # Mikro side: real, loginable accounts only.
    #
    # `is_tracked_only` users have no Auth0 account BY DESIGN — they exist so a
    # non-Mikro mapper's OSM activity can be tracked. They are not drift, and
    # without this filter every one of them would be reported as "missing from
    # Auth0" forever. The column is `nullable=False, default=False`, so a plain
    # is_(False) is sufficient — NULL cannot occur.
    #
    # `User.query` already excludes soft-deleted rows (QueryWithSoftDelete in
    # api/database/common.py); the explicit deleted_date filter is kept as
    # documentation of intent and to survive a future change to that default.
    mikro_users = User.query.filter(
        User.org_id == org_id,
        User.deleted_date.is_(None),
        User.is_tracked_only.is_(False),
    ).all()

    auth0_subs = {m.get("user_id") for m in members if m.get("user_id")}
    mikro_subs = {u.auth0_sub for u in mikro_users if u.auth0_sub}

    report["auth0_member_count"] = len(auth0_subs)
    report["mikro_user_count"] = len(mikro_users)

    for u in mikro_users:
        # A user with no auth0_sub has never authenticated; not drift.
        if u.auth0_sub and u.auth0_sub not in auth0_subs:
            report["in_mikro_not_auth0"].append({"id": u.id, "email": u.email})

    for m in members:
        sub = m.get("user_id")
        if sub and sub not in mikro_subs:
            report["in_auth0_not_mikro"].append(
                {"user_id": sub, "email": m.get("email")}
            )

    report["aligned_count"] = len(auth0_subs & mikro_subs)

    _log(
        "warning",
        "[ORG-RECONCILE] org=%s status=%s auth0=%d mikro=%d aligned=%d "
        "mikro_only=%d auth0_only=%d",
        org_id,
        report["org_status"],
        report["auth0_member_count"],
        report["mikro_user_count"],
        report["aligned_count"],
        len(report["in_mikro_not_auth0"]),
        len(report["in_auth0_not_mikro"]),
    )
    return report


def reconcile_all_active_orgs():
    """Run :func:`reconcile_org` for every active organization."""
    orgs = Organization.query.filter_by(status="active").all()
    return [reconcile_org(o.id) for o in orgs]


def _print_report(report):
    print(f"\n=== {report['org_id']} (local status: {report['org_status']}) ===")
    if report["error"]:
        print(f"  ERROR: {report['error']}")
        return
    print(
        f"  Auth0 members: {report['auth0_member_count']}   "
        f"Mikro users: {report['mikro_user_count']}   "
        f"aligned: {report['aligned_count']}"
    )

    mikro_only = report["in_mikro_not_auth0"]
    print(f"\n  In Mikro but NOT an Auth0 org member ({len(mikro_only)}):")
    print("    -> these CANNOT complete an org-scoped login (the 'No Organization")
    print("       Found' failure). Add them to the Auth0 organization.")
    for row in mikro_only:
        print(f"      {row['id']}  {row['email']}")
    if not mikro_only:
        print("      (none)")

    auth0_only = report["in_auth0_not_mikro"]
    print(f"\n  Auth0 org member but NOT in Mikro ({len(auth0_only)}):")
    print("    -> these can authenticate but have no Mikro row until first login;")
    print("       invisible to their admins in the meantime.")
    for row in auth0_only:
        print(f"      {row['user_id']}  {row['email']}")
    if not auth0_only:
        print("      (none)")


def main():
    import sys

    from app import create_app  # noqa: E402  (script entry point)

    args = [a for a in sys.argv[1:] if a]
    app = create_app()
    with app.app_context():
        if args:
            reports = [reconcile_org(a) for a in args]
        else:
            reports = reconcile_all_active_orgs()
        for r in reports:
            _print_report(r)

    drift = any(
        r["in_mikro_not_auth0"] or r["in_auth0_not_mikro"] or r["error"]
        for r in reports
    )
    return 1 if drift else 0


if __name__ == "__main__":
    raise SystemExit(main())
