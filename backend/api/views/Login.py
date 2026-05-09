#!/usr/bin/env python3
"""
Login API endpoint for Mikro.

Handles user authentication via Auth0 JWT tokens.
Creates or retrieves user records based on Auth0 claims.
"""

from flask.views import MethodView
from flask import g, jsonify, current_app, request

from ..database import User, UserNameAudit


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
                # Seed the audit trail so every user has a name-history
                # starting point. Captures what Auth0 sent on day one.
                try:
                    UserNameAudit.create(
                        user_id=user.id,
                        old_first_name=None,
                        old_last_name=None,
                        new_first_name=first_name or None,
                        new_last_name=last_name or None,
                        source="login_create",
                        changed_by=None,
                        details=f"auth0_name={(name or '')!r} email={(email or '')!r}",
                    )
                    current_app.logger.info(
                        f"[NAME-AUDIT] user={user.id} source=login_create "
                        f"to='{first_name} {last_name}'.strip() "
                        f"auth0_name={name!r} email={email!r}"
                    )
                except Exception as audit_e:
                    current_app.logger.warning(
                        f"[NAME-AUDIT] Failed audit for login_create {auth0_sub}: {audit_e}"
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
            # Update user info from Auth0 on each login
            # Don't overwrite role from token if user already has a higher role in DB
            current_app.logger.info(f"Updating user {auth0_sub}")
            try:
                # Only update role if token has a more privileged role than DB
                # or if DB role is default "user". Three-tier admin split:
                # team_admin sits between validator and admin; super_admin
                # tops the ladder for cross-org operations.
                role_priority = {
                    "user": 0,
                    "validator": 1,
                    "team_admin": 2,
                    "admin": 3,
                    "super_admin": 4,
                }
                token_priority = role_priority.get(role, 0)
                db_priority = role_priority.get(user.role, 0)
                new_role = role if token_priority > db_priority else user.role

                updates = {
                    "email": email,
                    "role": new_role,
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

                # Audit any name change BEFORE the write so we capture the
                # old values. This is the diagnostic that will prove or
                # disprove the revert theory.
                if write_first or write_last:
                    try:
                        old_first = user.first_name or None
                        old_last = user.last_name or None
                        new_first = updates.get("first_name", user.first_name) or None
                        new_last = updates.get("last_name", user.last_name) or None
                        if (old_first or "") != (new_first or "") or (old_last or "") != (new_last or ""):
                            UserNameAudit.create(
                                user_id=user.id,
                                old_first_name=old_first,
                                old_last_name=old_last,
                                new_first_name=new_first,
                                new_last_name=new_last,
                                source="login_guard",
                                changed_by=None,
                                details=(
                                    f"auth0_name={(name or '')!r} "
                                    f"matched_email={user.first_name == user.email} "
                                    f"empty_first={not user.first_name} "
                                    f"empty_last={not user.last_name}"
                                ),
                            )
                            current_app.logger.info(
                                f"[NAME-AUDIT] user={user.id} source=login_guard "
                                f"from='{old_first or ''} {old_last or ''}'.strip() "
                                f"to='{new_first or ''} {new_last or ''}'.strip() "
                                f"auth0_name={name!r}"
                            )
                    except Exception as audit_e:
                        current_app.logger.warning(
                            f"[NAME-AUDIT] Failed audit for login_guard {auth0_sub}: {audit_e}"
                        )

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
