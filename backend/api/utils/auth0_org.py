"""
Single source of truth for getting a user into an Auth0 Organization.

Auth0's invitation email always routes to a SIGN-UP page, so a user who already
exists in the tenant (e.g. from Viewer) hits "User already exists" and can never
accept. So the rule is: if the invitee already has an Auth0 account, add them
straight to the org as a member (+ role) and send a login email; otherwise send
a standard org invitation.

This helper is the canonical implementation. External-org provisioning
(`api/views/Organizations.py`) uses it today. The older inline copy inside
`api/views/Users.py::invite_user` is scheduled to converge onto this helper in
Phase B of `external-org-management-plan.md` (when invites become org-aware and
its tests are updated in the same change) — until then, do NOT add a third copy:
extend THIS function.
"""

import requests
from flask import current_app


def get_db_connection_id(domain, headers):
    """Auth0 connection id for ``Username-Password-Authentication``, or None.

    Shared single source of truth for the DB-connection lookup (used both here
    and by org provisioning).
    """
    resp = requests.get(f"https://{domain}/api/v2/connections", headers=headers)
    if not resp.ok:
        return None
    for c in resp.json():
        if c.get("name") == "Username-Password-Authentication":
            return c.get("id")
    return None


def _choose_tenant_identity(matches, email):
    """Pick ONE Auth0 identity for ``email``, deterministically.

    The tenant is shared across Mikro, Maprizon and the Tasking Manager, so one
    email can carry several identities (database, Google, SAML). ``matches[0]``
    is whatever order Auth0 happened to return — granting the org to the wrong
    identity leaves the person locked out of the org they were just invited to,
    and it can flip between calls. So prefer the
    ``Username-Password-Authentication`` / ``auth0|`` database identity, which
    is the connection invitations are issued against, and fall back to the
    first match only when none qualifies.

    Mirrors ``findTenantUserByEmail`` in the Maprizon client, which solved the
    same ambiguity on the same tenant.
    """
    if not matches:
        return None

    def _is_db_identity(user):
        identities = user.get("identities") or []
        if any(
            i.get("connection") == "Username-Password-Authentication"
            for i in identities
        ):
            return True
        return str(user.get("user_id") or "").startswith("auth0|")

    chosen = next((u for u in matches if _is_db_identity(u)), None) or matches[0]

    if len(matches) > 1:
        current_app.logger.warning(
            f"users-by-email returned {len(matches)} identities for {email!r}; "
            f"chose {chosen.get('user_id')!r} from "
            f"{[u.get('user_id') for u in matches]}"
        )

    return chosen.get("user_id")


def _sync_app_metadata_org(domain, headers, user_id, org_id):
    """Best-effort write of ``app_metadata.org_id`` for ``user_id``.

    Org membership and the ``mikro/org_id`` claim are two different mechanisms:
    membership is the Auth0 Organizations record, while the claim is derived by
    the post-login Action from ``app_metadata.org_id``. Granting membership
    without writing the metadata leaves the two silently divergent — the user
    is a member, but their tokens carry no org. GETs the user first and merges
    so unrelated app_metadata keys (roles, flags) survive.

    Never fails the invite: a missed metadata write is recoverable (the
    login-time org resolution chain falls back to the Mikro users row), a
    failed invite is not. Returns True on success.
    """
    url = f"https://{domain}/api/v2/users/{user_id}"
    try:
        get_resp = requests.get(url, headers=headers)
        if not get_resp.ok:
            current_app.logger.warning(
                f"app_metadata read failed for {user_id!r}: {get_resp.text}"
            )
            return False

        app_meta = (get_resp.json() or {}).get("app_metadata") or {}
        if app_meta.get("org_id") == org_id:
            return True

        app_meta["org_id"] = org_id
        patch_resp = requests.patch(
            url, json={"app_metadata": app_meta}, headers=headers
        )
        if not patch_resp.ok:
            current_app.logger.warning(
                f"app_metadata org_id write failed for {user_id!r}: "
                f"{patch_resp.text}"
            )
            return False

        current_app.logger.info(
            f"app_metadata org_id={org_id!r} written for {user_id!r}"
        )
        return True
    except Exception as e:
        current_app.logger.warning(
            f"app_metadata org_id write errored for {user_id!r}: {e}"
        )
        return False


def add_or_invite_user_to_org(
    *,
    domain,
    headers,
    org_id,
    email,
    role_id=None,
    app_client_id=None,
    client_id=None,
    inviter_name="Mikro",
):
    """Get ``email`` into Auth0 organization ``org_id``.

    Existing tenant user  -> add as member (+ role), send a login email.
    Brand-new user        -> send an org invitation (with the role).

    Returns a dict:
      {
        "ok": bool,              # did the user end up with access?
        "status": int,           # suggested HTTP status for the caller
        "message": str,          # human-facing summary
        "mode": "member" | "invitation" | None,
        "already_member": bool,  # user was already in this org
        "invitation_id": str | None,  # Auth0 invitation id (invitation mode)
      }
    """
    email_l = (email or "").lower()

    # 1) Does the user already exist in the tenant?
    existing_user_id = None
    try:
        lookup = requests.get(
            f"https://{domain}/api/v2/users-by-email",
            params={"email": email_l},
            headers=headers,
        )
        if lookup.ok:
            matches = lookup.json() or []
            existing_user_id = _choose_tenant_identity(matches, email_l)
    except Exception as e:
        current_app.logger.warning(f"users-by-email lookup failed for {email!r}: {e}")

    # 2a) Existing user -> add as member (+ role) and send a login email.
    if existing_user_id:
        member_resp = requests.post(
            f"https://{domain}/api/v2/organizations/{org_id}/members",
            json={"members": [existing_user_id]},
            headers=headers,
        )
        already_member = member_resp.status_code == 409
        if not member_resp.ok and not already_member:
            current_app.logger.error(
                f"Add-member failed for {email!r}: {member_resp.text}"
            )
            return {
                "ok": False,
                "status": member_resp.status_code,
                "message": f"Failed to add {email} to the organization.",
                "mode": "member",
                "already_member": False,
                "invitation_id": None,
            }

        if role_id:
            role_resp = requests.post(
                f"https://{domain}/api/v2/organizations/{org_id}"
                f"/members/{existing_user_id}/roles",
                json={"roles": [role_id]},
                headers=headers,
            )
            if not role_resp.ok:
                current_app.logger.warning(
                    f"Role assign failed for {email!r}: {role_resp.text}"
                )

        # Membership alone does not produce a `mikro/org_id` claim — the
        # post-login Action reads it off app_metadata. Write it here so the
        # two mechanisms cannot diverge. Best-effort by design.
        _sync_app_metadata_org(domain, headers, existing_user_id, org_id)

        _send_login_email(domain, email, app_client_id, client_id)
        return {
            "ok": True,
            "status": 200,
            "message": f"{email} now has access to Mikro.",
            "mode": "member",
            "already_member": already_member,
            "invitation_id": None,
        }

    # 2b) Brand-new user -> standard org invitation.
    connection_id = get_db_connection_id(domain, headers)
    if not connection_id:
        return {
            "ok": False,
            "status": 500,
            "message": "Username-Password-Authentication connection not found",
            "mode": "invitation",
            "already_member": False,
            "invitation_id": None,
        }

    payload = {
        "inviter": {"name": inviter_name},
        "invitee": {"email": email},
        "client_id": app_client_id or client_id,
        "connection_id": connection_id,
        "ttl_sec": 604800,  # 7 days
        "send_invitation_email": True,
    }
    if role_id:
        payload["roles"] = [role_id]

    invite_resp = requests.post(
        f"https://{domain}/api/v2/organizations/{org_id}/invitations",
        json=payload,
        headers=headers,
    )
    if invite_resp.ok:
        invitation_id = None
        try:
            invitation_id = invite_resp.json().get("id")
        except Exception:
            pass
        return {
            "ok": True,
            "status": 200,
            "message": f"Invitation sent to {email}.",
            "mode": "invitation",
            "already_member": False,
            "invitation_id": invitation_id,
        }

    # Invitation failed. A 409 / "already a member" is benign — nudge instead.
    try:
        error_msg = invite_resp.json().get("message", "")
    except Exception:
        error_msg = ""
    if invite_resp.status_code == 409 or "already a member" in error_msg.lower():
        _send_login_email(domain, email, app_client_id, client_id)
        return {
            "ok": True,
            "status": 200,
            "message": (f"User is already in the org — welcome email sent to {email}."),
            "mode": "invitation",
            "already_member": True,
            "invitation_id": None,
        }

    current_app.logger.error(f"Auth0 org invitation failed: {invite_resp.text}")
    return {
        "ok": False,
        "status": invite_resp.status_code,
        "message": f"Failed to send invitation: {error_msg}",
        "mode": "invitation",
        "already_member": False,
        "invitation_id": None,
    }


def _send_login_email(domain, email, app_client_id, client_id):
    """Send the change-password email as a branded "you've got access" nudge.

    Adding a member sends nothing on its own, so this is how an existing user
    learns they now have access (works for both set and reset).
    """
    try:
        requests.post(
            f"https://{domain}/dbconnections/change_password",
            json={
                "client_id": app_client_id or client_id,
                "email": email,
                "connection": "Username-Password-Authentication",
            },
        )
    except Exception as e:
        current_app.logger.warning(f"Welcome email failed for {email!r}: {e}")
