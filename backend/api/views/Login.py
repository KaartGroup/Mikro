#!/usr/bin/env python3
"""
Login API endpoint for Mikro.

Handles user authentication via Auth0 JWT tokens.
Creates or retrieves user records based on Auth0 claims.
"""

from flask.views import MethodView
from flask import g, jsonify, current_app, request

from ..database import User


class LoginAPI(MethodView):
    """
    Login endpoint for Auth0 authentication.

    The JWT is validated by the before_request hook in app.py.
    This endpoint creates or retrieves the user record and returns user info.
    """

    def post(self):
        """
        Handle login request.

        The JWT has already been validated by the before_request hook.
        This endpoint:
        1. Gets user info from the validated JWT payload
        2. Creates a new user or retrieves existing user
        3. Returns user information to the frontend

        Returns:
            JSON response with user information or error
        """
        try:
            return self._do_login()
        except Exception as e:
            current_app.logger.error(f"Login error: {e}")
            return jsonify({"message": "Login failed", "status": 500}), 500

    def _do_login(self):
        """
        Perform the login logic.

        Returns:
            dict: User information or error response
        """
        # Check if JWT was validated (set by before_request hook)
        if not hasattr(g, "current_user") or not g.current_user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        auth0_payload = g.current_user
        auth0_sub = auth0_payload.get("sub")

        if not auth0_sub:
            current_app.logger.error("No 'sub' claim in JWT")
            return jsonify({"message": "Invalid token", "status": 401}), 401

        # Get the namespace from config
        namespace = current_app.config.get("AUTH0_NAMESPACE", "mikro")

        # Extract user info from request body (sent by frontend from Auth0 session)
        # Fall back to token claims if not in body
        body = request.get_json(silent=True) or {}
        email = body.get("email") or auth0_payload.get("email")
        name = body.get("name") or auth0_payload.get("name", "")
        name_parts = name.split(" ", 1) if name else []
        first_name = name_parts[0] if name_parts else ""
        last_name = name_parts[1] if len(name_parts) > 1 else ""

        # Get role from custom claim (mikro/roles)
        roles = auth0_payload.get(f"{namespace}/roles", ["user"])
        role = roles[0] if roles else "user"

        # Get org_id from custom claim (mikro/org_id)
        org_id = auth0_payload.get(f"{namespace}/org_id")

        # ── Org gating (Phase B): the Organization table is the single source
        # of truth for which orgs may log in — replacing the old frontend
        # AUTH0_ORG_ID-only /wrong-org gate. The Kaart home org is always
        # allowed (it may predate the organizations table / its seed); any
        # OTHER org must exist and be 'active'. Disabled or unknown orgs are
        # rejected here, BEFORE a user row is created, with a distinct
        # reason the frontend routes to /wrong-org. A None org_id is left to
        # the frontend /no-org handling.
        kaart_org_id = current_app.config.get("AUTH0_ORG_ID")
        if org_id and org_id != kaart_org_id:
            from ..database import Organization

            org_row = Organization.query.filter_by(id=org_id).first()
            if not org_row or org_row.status != "active":
                current_app.logger.warning(
                    "[AUTH-TRACE] event=login_org_rejected "
                    f"sub={auth0_sub!r} org_id={org_id!r} "
                    f"found={org_row is not None}"
                )
                return (
                    jsonify(
                        {
                            "message": "Your organization isn't active in Mikro.",
                            "status": 403,
                            "reason": "org_not_active",
                        }
                    ),
                    403,
                )

        # Try to get existing user
        user = User.query.filter_by(auth0_sub=auth0_sub).first()

        # Log every /api/login request — this is THE most-hit endpoint for
        # auth debugging. Captures whether this was a new user, what sub/email/org
        # came from the JWT, and (a few lines down) what role is returned.
        current_app.logger.warning(
            "[AUTH-TRACE] event=login_start "
            f"sub={auth0_sub!r} email={email!r} org_id={org_id!r} "
            f"roles_from_token={roles!r} existing_user={user is not None}"
        )

        if not user:
            # Create new user
            current_app.logger.info(f"Creating new user for {auth0_sub}")
            try:
                user = User.create(
                    id=auth0_sub,
                    auth0_sub=auth0_sub,
                    email=email,
                    first_name=first_name,
                    last_name=last_name,
                    role=role,
                    org_id=org_id,
                )
                # Consume any pending team-targeted invite for this email.
                # When a team_admin invited this user, we wrote a
                # PendingInvite row; on first login auto-join them to
                # the target team. Idempotent — only the first matching
                # un-consumed row is consumed.
                try:
                    from datetime import datetime
                    from ..database import PendingInvite, TeamUser
                    invites = (
                        PendingInvite.query.filter_by(
                            email=email,
                            org_id=org_id,
                            consumed_at=None,
                        )
                        .order_by(PendingInvite.created_at.asc())
                        .all()
                    )
                    for invite in invites:
                        existing = TeamUser.query.filter_by(
                            user_id=user.id, team_id=invite.target_team_id
                        ).first()
                        if not existing:
                            TeamUser.create(
                                user_id=user.id,
                                team_id=invite.target_team_id,
                            )
                        invite.update(consumed_at=datetime.utcnow())
                        current_app.logger.info(
                            f"[INVITE-CONSUMED] user={user.id} "
                            f"team_id={invite.target_team_id} "
                            f"invited_by={invite.invited_by_user_id}"
                        )
                except Exception as invite_e:
                    current_app.logger.warning(
                        f"[INVITE-CONSUMED] Failed for {auth0_sub!r}: {invite_e}"
                    )
            except Exception as e:
                current_app.logger.error(f"Error creating user: {e}")
                return jsonify({"message": "Failed to create user", "status": 500}), 500
        else:
            # Update user info from Auth0 on each login.
            # Role is NOT touched here — the admin UI is canonical for role
            # changes. Auto-bumping from the token claim caused demotions
            # to silently revert because Auth0 metadata kept the old role
            # and the priority logic would keep re-promoting on every login.
            # If you need to change a user's role via Auth0, also change it
            # via /admin/users.
            current_app.logger.info(f"Updating user {auth0_sub}")
            try:
                updates = {
                    "email": email,
                }

                # Only set first/last name from Auth0 if the user doesn't
                # already have them set — prevents overwriting admin edits
                # with Auth0's default (which is often just the email address)
                write_first = (
                    not user.first_name or user.first_name == user.email
                )
                write_last = not user.last_name
                if write_first:
                    updates["first_name"] = first_name
                if write_last:
                    updates["last_name"] = last_name

                user.update(**updates)
            except Exception as e:
                current_app.logger.warning(f"Error updating user: {e}")

        # Store user in g for use by other endpoints
        g.user = user

        # Check if user needs onboarding (missing required fields)
        # Only require payment_email if payments are visible for this user
        needs_onboarding = not user.osm_username or (
            user.micropayments_visible and not user.payment_email
        )

        current_app.logger.warning(
            "[AUTH-TRACE] event=login_success "
            f"sub={auth0_sub!r} user_id={user.id!r} role={user.role!r} "
            f"org_id={user.org_id!r} osm_username={user.osm_username!r} "
            f"needs_onboarding={needs_onboarding}"
        )

        # Build response
        return jsonify(
            {
                "id": user.id,
                "name": user.full_name,
                "email": user.email,
                "role": user.role,
                "osm_username": user.osm_username,
                "payment_email": user.payment_email,
                "city": user.city,
                "country": user.country,
                "needs_onboarding": needs_onboarding,
                "micropayments_visible": user.micropayments_visible,
                "status": 200,
            }
        )
