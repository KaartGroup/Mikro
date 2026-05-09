#!/usr/bin/env python3
"""
User API endpoints for Mikro.

Handles user management operations.
"""

import requests
import secrets
import string
from datetime import datetime, timedelta
from flask.views import MethodView
from flask import g, request, current_app
from sqlalchemy import func

from ..utils import requires_admin, requires_team_admin_or_above
from ..utils.tz import parse_filter_datetime
from ..auth import (
    is_org_admin_or_above,
    managed_team_ids_for,
    team_admin_can_access_user,
    team_member_ids_for,
    redact_pay_fields,
)
from ..database import (
    User,
    UserNameAudit,
    Project,
    ProjectUser,
    Task,
    TimeEntry,
    UserTasks,
    UserChecklist,
    UserChecklistItem,
    TrainingCompleted,
    Country,
    Region,
    UserCountry,
    Team,
    Checklist,
    Training,
    PayRequests,
    Payments,
    CustomTopic,
    HourlyPayment,
    SyncJob,
    ElementAnalysisCache,
    Punk,
    Friend,
    WeeklyReport,
    CommunityEntry,
    MonitoredChannel,
    db,
)
from ..filters import resolve_filtered_user_ids
from ..stats import get_user_task_stats, get_batch_user_task_stats, get_user_payment_balances, get_batch_user_payment_balances, get_batch_user_task_stats_fast, get_batch_user_payment_balances_fast, _get_claimed_task_ids


def _auto_assign_country(user, country_text):
    """
    Auto-assign a user to a Country record based on free-text country name.
    Sets user.country_id, user.timezone (from country default), and creates UserCountry.
    """
    if not country_text:
        return

    # Try exact match first, then case-insensitive
    country_obj = Country.query.filter(
        db.func.lower(Country.name) == country_text.strip().lower()
    ).first()

    if not country_obj:
        # Try matching by ISO code
        upper = country_text.strip().upper()
        if len(upper) <= 3:
            country_obj = Country.query.filter_by(iso_code=upper).first()

    if not country_obj:
        return

    updates = {"country_id": country_obj.id}
    if country_obj.default_timezone and not user.timezone:
        updates["timezone"] = country_obj.default_timezone
    user.update(**updates)

    # Create UserCountry record if not exists
    existing = UserCountry.query.filter_by(
        user_id=user.id, country_id=country_obj.id
    ).first()
    if not existing:
        UserCountry.create(
            user_id=user.id, country_id=country_obj.id, is_primary=True
        )


def _format_user_name(user):
    first = (user.first_name or "").title()
    last = (user.last_name or "").title()
    return f"{first} {last}".strip() or user.email or "Unknown"


def record_name_change(
    user,
    new_first,
    new_last,
    source,
    changed_by=None,
    details=None,
):
    """
    Audit a change to user.first_name / user.last_name. No-op when the
    proposed values match the current values — avoids flooding the table
    on every /api/login page-sync request.

    Caller is responsible for performing the actual write; this function
    only records the audit row. Emits a structured log line as well so
    the event is visible in DO logs without DB access.

    Added 2026-04 to diagnose reports of admin-set names reverting to
    email addresses. Safe to drop once the regression is confirmed fixed.
    """
    old_first = user.first_name or ""
    old_last = user.last_name or ""
    nf = new_first or ""
    nl = new_last or ""
    if old_first == nf and old_last == nl:
        return None
    try:
        row = UserNameAudit.create(
            user_id=user.id,
            old_first_name=old_first or None,
            old_last_name=old_last or None,
            new_first_name=nf or None,
            new_last_name=nl or None,
            source=source,
            changed_by=changed_by,
            details=details,
        )
        current_app.logger.info(
            f"[NAME-AUDIT] user={user.id} source={source} "
            f"from='{old_first} {old_last}'.strip() "
            f"to='{nf} {nl}'.strip() by={changed_by or 'system'} "
            f"details={details or ''}"
        )
        return row
    except Exception as e:
        # Auditing must never block the actual write — this is a debug
        # tool, not a critical path.
        current_app.logger.warning(
            f"[NAME-AUDIT] Failed to record audit for user={user.id} "
            f"source={source}: {e}"
        )
        return None


def _resolve_country_region(country_id, country_cache, region_cache):
    if not country_id:
        return None, None
    if country_id not in country_cache:
        country_cache[country_id] = Country.query.get(country_id)
    c = country_cache[country_id]
    if not c:
        return None, None
    region_name = None
    if c.region_id:
        if c.region_id not in region_cache:
            region_cache[c.region_id] = Region.query.get(c.region_id)
        r = region_cache[c.region_id]
        region_name = r.name if r else None
    return c.name, region_name


class UserAPI(MethodView):
    """User management API endpoints."""

    def post(self, path: str):
        if path == "fetch_user_role":
            return self.fetch_user_role()
        if path == "fetch_user_details" or path == "fetch_user_profile":
            return self.fetch_user_details()
        if path == "update_user_details" or path == "update_profile":
            return self.update_user_details()
        elif path == "assign_user":
            return self.assign_user()
        elif path == "unassign_user":
            return self.unassign_user()
        elif path == "invite_user":
            return self.invite_user()
        elif path == "fetch_users":
            return self.do_fetch_users()
        elif path == "fetch_project_users":
            return self.fetch_project_users()
        elif path == "fetch_org_users_basic":
            return self.fetch_org_users_basic()
        elif path == "remove_users":
            return self.do_remove_users()
        elif path == "deactivate_user":
            return self.deactivate_user()
        elif path == "reactivate_user":
            return self.reactivate_user()
        elif path == "modify_users":
            return self.do_modify_users()
        elif path == "first_login_update":
            return self.first_login_update()
        elif path == "reset_test_user_stats":
            return self.reset_test_user_stats()
        elif path == "import_users":
            return self.import_users()
        elif path == "purge_all_users":
            return self.purge_all_users()
        elif path == "fetch_user_profile_by_id":
            return self.fetch_user_profile_by_id()
        elif path == "fetch_user_stats_by_date":
            return self.fetch_user_stats_by_date()
        elif path == "fetch_user_payment_summary":
            return self.fetch_user_payment_summary()
        elif path == "fetch_user_changesets":
            return self.fetch_user_changesets()
        elif path == "fetch_user_activity_chart":
            return self.fetch_user_activity_chart()
        elif path == "fetch_user_task_history":
            return self.fetch_user_task_history()
        elif path == "admin_update_user_profile":
            return self.admin_update_user_profile()
        elif path == "link_mapillary":
            return self.link_mapillary()
        elif path == "unlink_mapillary":
            return self.unlink_mapillary()
        elif path == "sync_org_ids":
            return self.sync_org_ids()
        return {
            "message": "Only /project/{fetch_users,fetch_user_projects} is permitted with GET",  # noqa: E501
        }, 405

    @requires_admin
    def import_users(self):
        """
        Bulk import users via Auth0 Management API.
        Expects JSON: { "users": [{ "email": "...", "name": "...", "role": "..." }, ...] }
        """
        VALID_ROLES = {"admin", "validator", "user"}

        users = request.json.get("users", [])
        if not users:
            return {"message": "No users provided", "status": 400}

        # Get Auth0 config
        domain = current_app.config.get("AUTH0_DOMAIN")
        client_id = current_app.config.get("AUTH0_M2M_CLIENT_ID")
        client_secret = current_app.config.get("AUTH0_M2M_CLIENT_SECRET")

        if not all([domain, client_id, client_secret]):
            return {
                "message": "Auth0 Management API not configured",
                "status": 500,
            }

        try:
            # Get Management API access token
            token_url = f"https://{domain}/oauth/token"
            token_payload = {
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "audience": f"https://{domain}/api/v2/",
            }
            token_response = requests.post(token_url, json=token_payload)
            if not token_response.ok:
                return {"message": "Failed to authenticate with Auth0", "status": 500}

            access_token = token_response.json().get("access_token")
            headers = {"Authorization": f"Bearer {access_token}"}

            results = {"success": [], "failed": []}

            for user_data in users:
                email = user_data.get("email", "").strip().lower()
                role = user_data.get("role", "user").strip().lower()
                osm_username = user_data.get("osm_username", "").strip() or None

                if not email:
                    results["failed"].append({"email": "unknown", "error": "No email provided"})
                    continue

                # Validate role
                if role not in VALID_ROLES:
                    results["failed"].append({
                        "email": email,
                        "error": f"Invalid role '{role}'. Must be one of: {', '.join(sorted(VALID_ROLES))}"
                    })
                    continue

                # Use explicit first_name/last_name if provided, else parse from name
                name = user_data.get("name", "")
                first_name = user_data.get("first_name", "").strip()
                last_name = user_data.get("last_name", "").strip()
                if not first_name:
                    name_parts = name.strip().split(" ", 1) if name else ["", ""]
                    first_name = name_parts[0] if name_parts else ""
                    last_name = name_parts[1] if len(name_parts) > 1 else ""
                if not name:
                    name = f"{first_name} {last_name}".strip()

                try:
                    # Generate cryptographically random temp password
                    alphabet = string.ascii_letters + string.digits + "!@#$%"
                    temp_password = "".join(secrets.choice(alphabet) for _ in range(24))

                    # Create user in Auth0
                    create_url = f"https://{domain}/api/v2/users"
                    user_payload = {
                        "email": email,
                        "connection": "Username-Password-Authentication",
                        "email_verified": True,
                        "password": temp_password,
                        "name": name or email.split("@")[0],
                        "given_name": first_name,
                        "family_name": last_name,
                    }
                    create_response = requests.post(create_url, json=user_payload, headers=headers)

                    auth0_created = True
                    auth0_user_id = None
                    if create_response.status_code == 409:
                        # User already exists in Auth0 — look up their ID
                        auth0_created = False
                        lookup_url = f"https://{domain}/api/v2/users-by-email"
                        lookup_resp = requests.get(
                            lookup_url,
                            params={"email": email},
                            headers=headers,
                        )
                        if lookup_resp.ok and lookup_resp.json():
                            auth0_user_id = lookup_resp.json()[0].get("user_id")
                    elif not create_response.ok:
                        error_detail = create_response.json().get("message", create_response.text[:100])
                        current_app.logger.error(f"Auth0 create user failed for {email}: {error_detail}")
                        results["failed"].append({"email": email, "error": f"Auth0: {error_detail}"})
                        continue
                    else:
                        # New user created — get their Auth0 ID
                        auth0_user_id = create_response.json().get("user_id")

                    if not auth0_user_id:
                        results["failed"].append({"email": email, "error": "Could not resolve Auth0 user ID"})
                        continue

                    # Trigger password set email for all imported users
                    reset_url = f"https://{domain}/dbconnections/change_password"
                    reset_payload = {
                        "client_id": client_id,
                        "email": email,
                        "connection": "Username-Password-Authentication",
                    }
                    requests.post(reset_url, json=reset_payload)

                    # Create/update user in local database
                    existing_user = User.query.filter_by(email=email).first()
                    if not existing_user:
                        existing_user = User.query.filter_by(id=auth0_user_id).first()

                    if existing_user:
                        # Updating an existing row. Apply the same guard as
                        # Login.py so CSV imports can't clobber admin-set
                        # names. Only write name fields if the existing
                        # values are empty OR still equal the email (i.e.
                        # the untouched initial state).
                        safe_updates = dict(
                            role=role,
                            org_id=g.user.org_id,
                            auth0_sub=auth0_user_id,
                        )
                        if osm_username:
                            safe_updates["osm_username"] = osm_username
                        write_first = (
                            not existing_user.first_name
                            or existing_user.first_name == existing_user.email
                        )
                        write_last = not existing_user.last_name
                        if write_first:
                            safe_updates["first_name"] = first_name
                        if write_last:
                            safe_updates["last_name"] = last_name
                        # Audit any name changes BEFORE the write
                        if write_first or write_last:
                            record_name_change(
                                existing_user,
                                safe_updates.get("first_name", existing_user.first_name),
                                safe_updates.get("last_name", existing_user.last_name),
                                source="import",
                                changed_by=g.user.id if getattr(g, "user", None) else None,
                                details=f"csv_first={first_name!r} csv_last={last_name!r}",
                            )
                        existing_user.update(**safe_updates)
                    else:
                        # New row — safe to set names from CSV.
                        create_fields = dict(
                            first_name=first_name,
                            last_name=last_name,
                            role=role,
                            org_id=g.user.org_id,
                            auth0_sub=auth0_user_id,
                        )
                        if osm_username:
                            create_fields["osm_username"] = osm_username
                        new_user = User.create(
                            id=auth0_user_id,
                            email=email,
                            **create_fields,
                        )
                        # Audit the creation so every user has a name-history
                        # starting point.
                        try:
                            UserNameAudit.create(
                                user_id=new_user.id,
                                old_first_name=None,
                                old_last_name=None,
                                new_first_name=first_name or None,
                                new_last_name=last_name or None,
                                source="import",
                                changed_by=g.user.id if getattr(g, "user", None) else None,
                                details=f"csv_first={first_name!r} csv_last={last_name!r}",
                            )
                        except Exception as e:
                            current_app.logger.warning(
                                f"[NAME-AUDIT] Failed audit for import (new user {email}): {e}"
                            )

                    suffix = " (already in Auth0, synced locally)" if not auth0_created else ""
                    results["success"].append(email + suffix)

                except Exception as e:
                    db.session.rollback()
                    current_app.logger.error(f"Error importing user {email}: {e}")
                    results["failed"].append({"email": email, "error": str(e)})

            return {
                "message": f"Imported {len(results['success'])} user(s)",
                "results": results,
                "status": 200,
            }

        except Exception as e:
            current_app.logger.error(f"Error in bulk import: {e}")
            return {"message": "Import failed", "status": 500}

    # FETCH USER ROLE ON LOGIN FOR UI RENDER
    def fetch_user_role(self):
        # initialize an empty dictionary to store the response
        response = {}
        # check if the user information is available in the global context
        if not g.user:
            # This endpoint is hit by the frontend's AuthGuard on every
            # authenticated page mount. A 304 here is NOT an error from
            # Flask's perspective, but the frontend treats anything !=
            # 200-with-a-valid-role as a session failure. Log so we can
            # correlate with the redirect loop when a user reports one.
            sub = None
            try:
                if hasattr(g, "current_user") and g.current_user:
                    sub = g.current_user.get("sub")
            except Exception:
                pass
            current_app.logger.warning(
                "[AUTH-TRACE] event=fetch_user_role_no_g_user "
                f"sub={sub!r}"
            )
            response["message"] = "User not found"
            response["status"] = 304
            return response
        else:
            # extract the role and name from the user information
            role = g.user.role
            current_app.logger.info(
                "[AUTH-TRACE] event=fetch_user_role_ok "
                f"user_id={g.user.id!r} role={role!r}"
            )
            # update the response dictionary with the extracted information
            response["role"] = role
            response["name"] = _format_user_name(g.user)
            response["first_name"] = g.user.first_name or ""
            response["last_name"] = g.user.last_name or ""
            response["status"] = 200
            return response

    def first_login_update(self):
        # Check if the user is already logged in
        if not g.user:
            # If user is not logged in, return appropriate error message and status code  # noqa: E501
            return {"message": "User not found", "status": 304}
        # Get required fields from the JSON request, returning appropriate error messages if missing  # noqa: E501
        osm_username = request.json.get("osm_username") or {
            "message": "osm_username required",
            "status": 400,
        }
        payment_email = request.json.get("payment_email") or {
            "message": "payment_email required",
            "status": 400,
        }
        terms_agreement = request.json.get("terms_agreement") or {
            "message": "terms_agreement required",
            "status": 400,
        }
        city = request.json.get("city") or {
            "message": "city required",
            "status": 400,
        }
        country = request.json.get("country") or {
            "message": "country required",
            "status": 400,
        }
        # If any required fields are missing, return the error message and status code  # noqa: E501
        if isinstance(osm_username, dict):
            return osm_username
        if isinstance(payment_email, dict):
            return payment_email
        if isinstance(terms_agreement, dict):
            return terms_agreement
        if isinstance(city, dict):
            return city
        if isinstance(country, dict):
            return country
        # Update the user's details
        g.user.update(
            osm_username=osm_username,
            payment_email=payment_email,
            city=city,
            country=country,
        )
        # Auto-assign country → country_id, timezone, UserCountry
        _auto_assign_country(g.user, country)
        # Return success message and status code
        return {"message": "User Updated", "status": 200}

    # FETCH USER DETAILS FOR ACCOUNT PAGE
    def fetch_user_details(self):
        # initialize an empty dictionary to store the response
        response = {}
        # check if the user information is available in the global context
        if not g or not g.user:
            response["message"] = "User not found"
            response["status"] = 304
            return response

        user = g.user
        # extract user information
        full_name = _format_user_name(user)

        # update the response dictionary with the extracted information
        response["id"] = user.id
        response["role"] = user.role
        response["first_name"] = (user.first_name or "").title()
        response["last_name"] = (user.last_name or "").title()
        response["name"] = full_name
        response["full_name"] = full_name
        response["email"] = user.email
        response["payment_email"] = user.payment_email
        response["city"] = user.city
        response["country"] = user.country
        response["timezone"] = user.timezone

        # OSM account linking fields
        response["osm_username"] = user.osm_username
        response["osm_id"] = user.osm_id
        response["osm_verified"] = user.osm_verified or False
        response["osm_verified_at"] = (
            user.osm_verified_at.isoformat() if user.osm_verified_at else None
        )

        # Mapillary account linking
        response["mapillary_username"] = user.mapillary_username

        # Payment visibility
        response["micropayments_visible"] = user.micropayments_visible or False
        response["hourly_rate"] = user.hourly_rate

        # Stats for display
        _stats = get_user_task_stats(user)
        response["total_tasks_mapped"] = _stats["total_tasks_mapped"]
        response["total_tasks_validated"] = _stats["total_tasks_validated"]
        response["total_payout"] = user.paid_total or 0

        response["status"] = 200
        return response

    @requires_team_admin_or_above
    def do_fetch_users(self):
        # Initialize an empty dictionary for returning the response
        return_obj = {}
        # Check if the user is not found in the context
        if not g:
            return_obj["message"] = "User not found"
            return_obj["status"] = 304
            return return_obj

        # Support universal filter system. The standalone filter
        # dropdowns on /admin/users write single-element values into
        # this body (filters.country = [id] etc.); resolve_filtered_user_ids
        # handles every dimension via the existing pipeline.
        filters = request.json.get("filters") if request.json else None
        filtered_ids = resolve_filtered_user_ids(filters, g.user.org_id) if filters else None

        # Get all the users from the database that belong to the same organization
        users_query = User.query.filter_by(org_id=g.user.org_id)
        if filtered_ids is not None:
            users_query = users_query.filter(User.id.in_(filtered_ids))

        # team_admin: narrow to managed-team members only.
        # Empty managed → return empty list (zero-team team_admin empty state).
        if g.user.role == "team_admin":
            managed = managed_team_ids_for(g.user)
            if not managed:
                return_obj["users"] = []
                return_obj["status"] = 200
                return return_obj
            member_ids = team_member_ids_for(managed)
            if not member_ids:
                return_obj["users"] = []
                return_obj["status"] = 200
                return return_obj
            users_query = users_query.filter(User.id.in_(member_ids))

        users_in_org = users_query.all()

        # Build country/region lookup caches
        country_cache = {}
        region_cache = {}

        # Batch-compute live task stats using SQL aggregation (fast path for list view)
        batch_stats = get_batch_user_task_stats_fast(users_in_org, g.user.org_id)
        batch_pay = get_batch_user_payment_balances_fast(users_in_org, g.user.org_id)

        # Initialize an empty list to store information about the users
        org_users = []
        # Loop over each user and extract relevant information
        for user in users_in_org:
            full_name = _format_user_name(user)
            if user.assigned_projects is not None:
                assigned_projects_count = len(user.assigned_projects)
            else:
                assigned_projects_count = 0

            # Resolve country and region names
            country_name, region_name = _resolve_country_region(
                user.country_id, country_cache, region_cache
            )

            _ustats = batch_stats.get(user.id, {})
            user_dict = {
                "id": user.id,
                "name": full_name,
                "first_name": user.first_name or "",
                "last_name": user.last_name or "",
                "email": user.email or "",
                "osm_username": user.osm_username or "",
                "role": user.role,
                "joined": user.create_time,
                "total_payout": user.paid_total,
                "awaiting_payment": user.requested_total,
                "validated_tasks_amounts": batch_pay.get(user.id, {}).get("mapping_payable_total", 0)
                + batch_pay.get(user.id, {}).get("validation_payable_total", 0),
                "total_tasks_mapped": _ustats.get("total_tasks_mapped", 0),
                "total_tasks_validated": _ustats.get("total_tasks_validated", 0),
                "total_tasks_invalidated": _ustats.get("total_tasks_invalidated", 0),
                "requesting_payment": user.requesting_payment,
                "assigned_projects": assigned_projects_count,
                "country_name": country_name,
                "region_name": region_name,
                "timezone": user.timezone,
                "is_tracked_only": user.is_tracked_only or False,
                "mapillary_username": user.mapillary_username,
                "micropayments_visible": user.micropayments_visible or False,
                "hourly_rate": user.hourly_rate,
                "is_active": bool(getattr(user, "is_active", True)),
            }
            # Per-user pay redaction (handles team_admin / cross-team members)
            user_dict = redact_pay_fields(user_dict, g.user, user)
            # Append the user information to the org_users list
            org_users.append(user_dict)
        # Add the list of users to the return_obj dictionary
        return_obj["users"] = org_users
        return_obj["status"] = 200
        # Return the final response
        return return_obj

    @requires_admin
    def fetch_project_users(self):
        # Initialize an empty dictionary for returning the response
        return_obj = {}
        # Check if the user is not found in the context
        if not g:
            return_obj["message"] = "User not found"
            return_obj["status"] = 304
            return return_obj
        project_id = (
            request.json["project_id"]
            if "project_id" in request.json
            else None
        )
        # Check if the email address is not provided or is an empty string
        if not project_id or project_id == "":
            return_obj["message"] = "project_id required"
            return_obj["status"] = 400
            return return_obj
        # Get all the users from the database that belong to the same organization as the current user  # noqa: E501
        users_in_org = User.query.filter_by(org_id=g.user.org_id).all()
        all_assigned_user_relations = ProjectUser.query.filter_by(
            project_id=project_id
        ).all()
        assigned_user_ids = [r.user_id for r in all_assigned_user_relations]
        assigned_users = [u for u in users_in_org if u.id in assigned_user_ids]
        unassigned_users = [
            u for u in users_in_org if u.id not in assigned_user_ids
        ]
        # Batch-compute live task stats for all users (avoids N+1 queries)
        batch_stats = get_batch_user_task_stats(users_in_org, g.user.org_id)

        # Initialize an empty list to store information about the users
        org_users = []
        # Loop over each user and extract relevant information
        for user in users_in_org:
            full_name = _format_user_name(user)
            if user in assigned_users:
                assigned = "Yes"
            if user in unassigned_users:
                assigned = "No"
            if user.assigned_projects is not None:
                assigned_projects_count = len(user.assigned_projects)
            else:
                assigned_projects_count = 0
            _ustats = batch_stats.get(user.id, {})
            # Append the user information to the org_users list
            org_users.append(
                {
                    "id": user.id,
                    "name": full_name,
                    "first_name": user.first_name or "",
                    "last_name": user.last_name or "",
                    "role": user.role,
                    "joined": user.create_time,
                    "total_payout": user.paid_total,
                    "awaiting_payment": user.requested_total,
                    "total_tasks_mapped": _ustats.get("total_tasks_mapped", 0),
                    "total_tasks_validated": _ustats.get("total_tasks_validated", 0),
                    "total_tasks_invalidated": _ustats.get("total_tasks_invalidated", 0),
                    "requesting_payment": user.requesting_payment,
                    "assigned_projects": assigned_projects_count,
                    "assigned": assigned,
                }
            )
        # Add the list of users to the return_obj dictionary
        return_obj["users"] = org_users
        return_obj["status"] = 200
        # Return the final response
        return return_obj

    @requires_team_admin_or_above
    def fetch_org_users_basic(self):
        """Return a minimal list of users in the current org.

        Used as the search-by-email picker data source for the
        "add member to my team" workflow (per Goose decision #3).
        Returns only basic identity fields — NO pay fields. Includes
        ALL users in `g.user.org_id` regardless of team membership so
        team_admins can find candidates to add to their managed teams.
        """
        if not g.user:
            return {"message": "User not found", "status": 304}

        users = User.query.filter_by(org_id=g.user.org_id).all()
        out = []
        for u in users:
            name = _format_user_name(u)
            out.append({
                "id": u.id,
                "name": name,
                "email": u.email or "",
                "osm_username": u.osm_username or "",
                "role": u.role,
            })

        return {"users": out, "status": 200}

    # UPDATE USER DETAILS FROM ACCOUNT PAGE
    def update_user_details(self):
        # initialize an empty dictionary to store the response
        response = {}
        # check if the user information is available in the global context
        if not g:
            response = {"message": "User not found", "status": 304}
            return response
        # Update user details based on provided fields
        fields = [
            "first_name",
            "last_name",
            "osm_username",
            "city",
            "country",
            "email",
            "payment_email",
            "timezone",
        ]
        country_changed = False
        # Snapshot pre-write name values so we can audit after the loop.
        pre_first = g.user.first_name
        pre_last = g.user.last_name
        for field in fields:
            value = request.json.get(field)
            if (
                value is not None
                and value != ""
                and value != getattr(g.user, field)
            ):
                if field == "country":
                    country_changed = True
                setattr(g.user, field, value)
                g.user.update()
        # Audit name change (helper no-ops if nothing changed).
        if (g.user.first_name or "") != (pre_first or "") or (g.user.last_name or "") != (pre_last or ""):
            # Construct a transient User-like object carrying the OLD values
            # so record_name_change compares correctly. Simpler: just write
            # a one-off audit row directly here.
            try:
                UserNameAudit.create(
                    user_id=g.user.id,
                    old_first_name=pre_first or None,
                    old_last_name=pre_last or None,
                    new_first_name=g.user.first_name or None,
                    new_last_name=g.user.last_name or None,
                    source="self_edit",
                    changed_by=g.user.id,
                )
                current_app.logger.info(
                    f"[NAME-AUDIT] user={g.user.id} source=self_edit "
                    f"from='{(pre_first or '')} {(pre_last or '')}'.strip() "
                    f"to='{g.user.first_name or ''} {g.user.last_name or ''}'.strip() "
                    f"by={g.user.id}"
                )
            except Exception as e:
                current_app.logger.warning(
                    f"[NAME-AUDIT] Failed audit for self_edit user={g.user.id}: {e}"
                )
        # Auto-assign country when country text changes
        if country_changed:
            _auto_assign_country(g.user, g.user.country)
        # Return success response
        response = {"message": "User details updated", "status": 200}
        return response

    @requires_admin
    def invite_user(self):
        """
        Invite a user via Auth0 Organization Invitations API.
        Handles both new users and existing users (e.g. from Viewer).
        Auth0 sends ONE branded email — the Organization Invitation template
        with branding controlled by AUTH0_APP_CLIENT_ID.

        team_admin viewers MUST supply `targetTeamId` and that team must
        be one they manage. Org Admin / super_admin may supply
        targetTeamId optionally; if present, the invitee will be auto-
        added to that team on first login (consumed via PendingInvite).
        """
        from ..auth import (
            is_org_admin_or_above,
            team_admin_can_access_team,
        )
        from ..database import PendingInvite, Team

        email = request.json.get("email")
        if not email:
            return {"message": "Email is required", "status": 400}

        target_team_id = request.json.get("targetTeamId")
        if target_team_id is not None:
            try:
                target_team_id = int(target_team_id)
            except (TypeError, ValueError):
                return {"message": "targetTeamId must be an integer", "status": 400}

        # Team_admin requires a managed-team target; org_admin can
        # invite without one.
        if g.user and g.user.role == "team_admin":
            if target_team_id is None:
                return {
                    "message": "Team Admin must specify targetTeamId",
                    "status": 400,
                }
            if not team_admin_can_access_team(g.user, target_team_id):
                return {
                    "message": "Not in your managed teams",
                    "status": 403,
                }

        # If a target team is given, validate it exists in the viewer's
        # org. Cross-org targeting is rejected for everyone (including
        # super_admin until cross-org invite flow ships).
        if target_team_id is not None:
            target_team = Team.query.filter_by(
                id=target_team_id, org_id=g.user.org_id
            ).first()
            if not target_team:
                return {
                    "message": f"Team {target_team_id} not found",
                    "status": 404,
                }
            # is_org_admin_or_above passes for admin and super_admin;
            # team_admin already filtered above.
            if not (
                is_org_admin_or_above(g.user)
                or team_admin_can_access_team(g.user, target_team_id)
            ):
                return {
                    "message": "Not authorized to target this team",
                    "status": 403,
                }

        domain = current_app.config.get("AUTH0_DOMAIN")
        client_id = current_app.config.get("AUTH0_M2M_CLIENT_ID")
        client_secret = current_app.config.get("AUTH0_M2M_CLIENT_SECRET")
        app_client_id = current_app.config.get("AUTH0_APP_CLIENT_ID")
        org_id = current_app.config.get("AUTH0_ORG_ID")
        user_role_id = current_app.config.get("AUTH0_USER_ROLE_ID")

        if not all([domain, client_id, client_secret, org_id]):
            return {"message": "Auth0 not fully configured (need DOMAIN, M2M creds, ORG_ID)", "status": 500}

        try:
            # Get Management API token
            token_resp = requests.post(
                f"https://{domain}/oauth/token",
                json={
                    "grant_type": "client_credentials",
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "audience": f"https://{domain}/api/v2/",
                },
            )
            if not token_resp.ok:
                return {"message": "Failed to get Auth0 token", "status": 500}

            access_token = token_resp.json().get("access_token")
            headers = {"Authorization": f"Bearer {access_token}"}

            # Fetch connection ID for Username-Password-Authentication
            conn_resp = requests.get(f"https://{domain}/api/v2/connections", headers=headers)
            if not conn_resp.ok:
                return {"message": "Failed to fetch Auth0 connections", "status": 500}

            connections = conn_resp.json()
            connection = next(
                (c for c in connections if c.get("name") == "Username-Password-Authentication"),
                None,
            )
            if not connection:
                return {"message": "Username-Password-Authentication connection not found", "status": 500}

            connection_id = connection["id"]

            # Build invitation payload
            inviter_name = "Mikro"
            if g.user:
                name_parts = [g.user.first_name, g.user.last_name]
                full_name = " ".join(p for p in name_parts if p)
                if full_name:
                    inviter_name = full_name

            invitation_payload = {
                "inviter": {"name": inviter_name},
                "invitee": {"email": email},
                "client_id": app_client_id or client_id,
                "connection_id": connection_id,
                "ttl_sec": 604800,  # 7 days
                "send_invitation_email": True,
            }
            if user_role_id:
                invitation_payload["roles"] = [user_role_id]

            # Send Organization Invitation
            invite_resp = requests.post(
                f"https://{domain}/api/v2/organizations/{org_id}/invitations",
                json=invitation_payload,
                headers=headers,
            )

            if invite_resp.ok:
                # Persist a PendingInvite row so first-login can auto-
                # join the new user to the target team. Skip when no
                # target team was specified (org-admin invite without
                # team context behaves as before).
                if target_team_id is not None:
                    try:
                        invitation_id = invite_resp.json().get("id")
                        PendingInvite.create(
                            email=email,
                            org_id=g.user.org_id,
                            target_team_id=target_team_id,
                            invited_by_user_id=g.user.id,
                            auth0_invitation_id=invitation_id,
                        )
                    except Exception as persist_e:
                        current_app.logger.warning(
                            f"PendingInvite write failed for {email!r}: {persist_e}"
                        )
                return {
                    "message": f"Invitation sent to {email}.",
                    "status": 200,
                }

            # Handle errors
            error_data = invite_resp.json()
            error_msg = error_data.get("message", "")

            # If user is already an org member, send a welcome email instead
            if invite_resp.status_code == 409 or "already a member" in error_msg.lower():
                # Send a password reset email as a "welcome to Mikro" nudge
                reset_url = f"https://{domain}/dbconnections/change_password"
                requests.post(reset_url, json={
                    "client_id": app_client_id or client_id,
                    "email": email,
                    "connection": "Username-Password-Authentication",
                })
                return {
                    "message": f"User is already in the org — welcome email sent to {email}.",
                    "status": 200,
                }

            current_app.logger.error(f"Auth0 org invitation failed: {invite_resp.text}")
            return {"message": f"Failed to send invitation: {error_msg}", "status": invite_resp.status_code}

        except Exception as e:
            current_app.logger.error(f"Error inviting user: {e}")
            return {"message": "Failed to invite user", "status": 500}

    @requires_admin
    def sync_org_ids(self):
        """
        Sync org_id for all users. Fetches org membership from Auth0,
        falls back to a default org_id derived from the Auth0 tenant.
        Also updates app_metadata in Auth0 for users missing it.
        """
        domain = current_app.config.get("AUTH0_DOMAIN")
        client_id = current_app.config.get("AUTH0_M2M_CLIENT_ID")
        client_secret = current_app.config.get("AUTH0_M2M_CLIENT_SECRET")

        if not all([domain, client_id, client_secret]):
            return {"message": "Auth0 Management API not configured", "status": 500}

        try:
            # Get Management API token
            token_resp = requests.post(
                f"https://{domain}/oauth/token",
                json={
                    "grant_type": "client_credentials",
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "audience": f"https://{domain}/api/v2/",
                },
            )
            if not token_resp.ok:
                return {"message": "Failed to get Auth0 token", "status": 500}

            access_token = token_resp.json().get("access_token")
            headers = {"Authorization": f"Bearer {access_token}"}

            # Use the real Auth0 Organization ID
            default_org_id = current_app.config.get("AUTH0_ORG_ID")
            if not default_org_id:
                return {"message": "AUTH0_ORG_ID env var not configured", "status": 500}

            # Get all Mikro users
            all_users = User.query.all()
            updated = 0
            auth0_updated = 0
            errors = 0

            for user in all_users:
                try:
                    # Set org_id in Mikro DB (replace old/wrong values too)
                    if user.org_id != default_org_id:
                        user.org_id = default_org_id
                        updated += 1

                    # Also patch Auth0 app_metadata if user has an auth0_sub
                    if user.auth0_sub and user.auth0_sub.startswith("auth0|"):
                        auth0_user_url = f"https://{domain}/api/v2/users/{user.auth0_sub}"
                        get_resp = requests.get(auth0_user_url, headers=headers)
                        if get_resp.ok:
                            auth0_data = get_resp.json()
                            app_meta = auth0_data.get("app_metadata", {})
                            needs_update = False

                            if not app_meta.get("roles"):
                                app_meta["roles"] = [user.role or "user"]
                                needs_update = True
                            if app_meta.get("org_id") != default_org_id:
                                app_meta["org_id"] = default_org_id
                                needs_update = True

                            if needs_update:
                                patch_resp = requests.patch(
                                    auth0_user_url,
                                    json={"app_metadata": app_meta},
                                    headers=headers,
                                )
                                if patch_resp.ok:
                                    auth0_updated += 1
                                else:
                                    current_app.logger.warning(
                                        f"Failed to patch Auth0 for {user.email}: {patch_resp.text}"
                                    )

                except Exception as e:
                    current_app.logger.error(f"Error syncing org_id for {user.email}: {e}")
                    errors += 1

            db.session.commit()

            # Update org_id on ALL tables — replace old values AND nulls
            all_models = [
                Project, Task, TimeEntry, Team, Checklist, Training,
                PayRequests, Payments, Region, Country, CustomTopic,
                HourlyPayment, SyncJob, ElementAnalysisCache, Punk,
                Friend, WeeklyReport, CommunityEntry, MonitoredChannel,
            ]
            for model in all_models:
                model.query.filter(model.org_id != default_org_id).update(
                    {"org_id": default_org_id}, synchronize_session=False
                )
            db.session.commit()

            return {
                "message": f"Synced org_id '{default_org_id}' — {updated} users updated in DB, "
                           f"{auth0_updated} users patched in Auth0, {errors} errors",
                "org_id": default_org_id,
                "status": 200,
            }

        except Exception as e:
            current_app.logger.error(f"Error in sync_org_ids: {e}")
            db.session.rollback()
            return {"message": f"Failed: {str(e)}", "status": 500}

    @requires_admin
    def deactivate_user(self):
        """Soft-disable a user without deleting their data.

        Sets is_active=False. The auth gate in `requires_auth` /
        `requires_admin` (decorators.py) blocks any further requests
        from this account until an admin reactivates them. All historical
        data (time entries, contributions, payment totals) stays intact.
        """
        user_id = request.json.get("user_id") if request.json else None
        if not user_id:
            return {"message": "user_id required", "status": 400}, 400

        target = User.query.filter_by(id=user_id).first()
        if not target:
            return {"message": "User not found", "status": 404}, 404

        if target.org_id != g.user.org_id:
            return {"message": "Cross-org operation rejected", "status": 403}, 403

        target.is_active = False
        target.save()

        return {
            "message": "User deactivated",
            "status": 200,
            "user_id": target.id,
            "is_active": False,
        }, 200

    @requires_admin
    def reactivate_user(self):
        """Reverse a deactivation."""
        user_id = request.json.get("user_id") if request.json else None
        if not user_id:
            return {"message": "user_id required", "status": 400}, 400

        target = User.query.filter_by(id=user_id).first()
        if not target:
            return {"message": "User not found", "status": 404}, 404

        if target.org_id != g.user.org_id:
            return {"message": "Cross-org operation rejected", "status": 403}, 403

        target.is_active = True
        target.save()

        return {
            "message": "User reactivated",
            "status": 200,
            "user_id": target.id,
            "is_active": True,
        }, 200

    @requires_admin
    def do_remove_users(self):
        # Check if user_id is present in the request
        user_id = request.json.get("user_id")
        if not user_id:
            return {"message": "User_id required", "status": 400}
        # Query the user and remove the org_id
        remove_user = User.query.filter_by(id=user_id).first()
        if remove_user:
            remove_user.delete(soft=False)
            return {"message": "User Removed", "status": 200}
        else:
            return {"message": "User entry not found", "status": 400}

    @requires_admin
    def do_modify_users(self):
        # Initialize the return object
        return_obj = {}
        # Get the user ID from the request JSON
        user_id = request.json.get("user_id")
        if not user_id:
            return_obj["message"] = "User_id required"
            return_obj["status"] = 400
            return return_obj

        # Query the database for the user
        user = User.query.filter_by(id=user_id).first()
        if not user:
            return {"message": "User Entry not found "}, 400

        updates = {}

        # Handle role update
        new_role = request.json.get("role")
        if new_role:
            updates["role"] = new_role

        # Handle name updates
        if "first_name" in request.json:
            updates["first_name"] = (request.json["first_name"] or "").strip()
        if "last_name" in request.json:
            updates["last_name"] = (request.json["last_name"] or "").strip()

        # Audit the admin name edit BEFORE the write so we capture the
        # old values. record_name_change no-ops if nothing changed.
        if "first_name" in request.json or "last_name" in request.json:
            record_name_change(
                user,
                updates.get("first_name", user.first_name),
                updates.get("last_name", user.last_name),
                source="admin_edit",
                changed_by=g.user.id if getattr(g, "user", None) else None,
            )

        # Handle additional profile fields
        if "osm_username" in request.json:
            updates["osm_username"] = (request.json["osm_username"] or "").strip() or None
        if "email" in request.json:
            new_email = (request.json["email"] or "").strip()
            if new_email and new_email != user.email:
                existing = User.query.filter(User.email == new_email, User.id != user_id).first()
                if existing:
                    return {"message": f"Email '{new_email}' is already in use by another user", "status": 400}
            updates["email"] = new_email
        if "timezone" in request.json:
            updates["timezone"] = (request.json["timezone"] or "").strip() or None
        if "mapillary_username" in request.json:
            updates["mapillary_username"] = (request.json["mapillary_username"] or "").strip() or None
        if "micropayments_visible" in request.json:
            updates["micropayments_visible"] = bool(request.json["micropayments_visible"])
        if "hourly_rate" in request.json:
            val = request.json["hourly_rate"]
            updates["hourly_rate"] = float(val) if val is not None else None

        # Handle country_id change (with auto-timezone from country)
        if "country_id" in request.json:
            new_cid = request.json["country_id"]
            if new_cid:
                country_obj = Country.query.get(new_cid)
                if country_obj:
                    updates["country_id"] = new_cid
                    updates["country"] = country_obj.name
                    if "timezone" not in request.json and country_obj.default_timezone:
                        updates["timezone"] = country_obj.default_timezone
                    existing_uc = UserCountry.query.filter_by(
                        user_id=user_id, country_id=new_cid
                    ).first()
                    if not existing_uc:
                        UserCountry.create(
                            user_id=user_id, country_id=new_cid, is_primary=True
                        )
            else:
                updates["country_id"] = None

        if not updates:
            return_obj["message"] = "No changes provided"
            return_obj["status"] = 400
            return return_obj

        user.update(**updates)
        return_obj["message"] = "User updated"
        return_obj["status"] = 200
        return return_obj

    # # ADMIN ONLY ROUTE - ASSIGN CURRENT SELECTED USER TO CURRENT SELECTED TEAM # noqa: E501
    @requires_admin
    def assign_user(self):
        # Initialize response dictionary
        response = {}
        # Extract project_id from request body
        project_id = request.json.get("project_id")
        if not project_id:
            # Return error response if project_id is not provided
            response["message"] = "project_id required"
            response["status"] = 400
            return response
        # Extract user_id from request body
        user_id = request.json.get("user_id")
        if not user_id:
            # Return error response if user_id is not provided
            response["message"] = "User_id required"
            response["status"] = 400
            return response
        # Check if relation between user and project already exists
        user_relation = ProjectUser.query.filter_by(
            project_id=project_id, user_id=user_id
        ).first()
        # If relation exists, update deleted field to False
        if user_relation:
            user_relation.delete(soft=False)
            response[
                "message"
            ] = f"User {user_id} unassigned from Project {project_id}"
        # If relation doesn't exist, create a new one
        else:
            ProjectUser.create(user_id=user_id, project_id=project_id)
            response[
                "message"
            ] = f"User {user_id} assigned to Project {project_id}"
        # Set status code for response
        response["status"] = 200
        return response

    def reset_test_user_stats(self):
        response = {}
        g.user.update(
            total_tasks_mapped=0,
            total_tasks_validated=0,
            total_tasks_invalidated=0,
            validator_tasks_validated=0,
            validator_tasks_invalidated=0,
            payable_total=0,
            validation_payable_total=0,
            mapping_payable_total=0,
        )

        response["message"] = "Stats reset"
        response["status"] = 200
        return response

    @requires_admin
    def purge_all_users(self):
        """DEV ONLY: Purge all users EXCEPT the initiating admin."""
        if not g.user:
            return {"message": "User not found", "status": 304}

        org_id = g.user.org_id
        admin_id = g.user.id  # Don't delete this user

        # Get all users except the admin
        users_to_delete = User.query.filter(
            User.org_id == org_id,
            User.id != admin_id
        ).all()

        users_deleted = 0
        for user in users_to_delete:
            user_id = user.id

            # Delete user's task relations
            user_tasks = UserTasks.query.filter_by(user_id=user_id).all()
            for ut in user_tasks:
                ut.delete(soft=False)

            # Delete user's project relations
            project_users = ProjectUser.query.filter_by(user_id=user_id).all()
            for pu in project_users:
                pu.delete(soft=False)

            # Delete user's checklist items
            user_checklist_items = UserChecklistItem.query.filter_by(user_id=user_id).all()
            for uci in user_checklist_items:
                uci.delete(soft=False)

            # Delete user's checklists
            user_checklists = UserChecklist.query.filter_by(user_id=user_id).all()
            for uc in user_checklists:
                uc.delete(soft=False)

            # Delete user's training completions
            training_completions = TrainingCompleted.query.filter_by(user_id=user_id).all()
            for tc in training_completions:
                tc.delete(soft=False)

            # Delete the user
            user.delete(soft=False)
            users_deleted += 1

        return {
            "message": f"Purged {users_deleted} users (admin preserved)",
            "users_deleted": users_deleted,
            "admin_preserved": admin_id,
            "status": 200,
        }

    # ─── User Profile ─────────────────────────────────────

    @staticmethod
    @staticmethod
    def _format_time_entry(entry, project_cache=None):
        """Format a TimeEntry for the profile response."""
        project = None
        if entry.project_id:
            if project_cache is not None:
                project = project_cache.get(entry.project_id)
            else:
                project = Project.query.get(entry.project_id)
        duration = None
        if entry.duration_seconds is not None:
            hours = entry.duration_seconds // 3600
            minutes = (entry.duration_seconds % 3600) // 60
            seconds = entry.duration_seconds % 60
            duration = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        return {
            "id": entry.id,
            "clockIn": entry.clock_in.isoformat() + "Z" if entry.clock_in else None,
            "clockOut": entry.clock_out.isoformat() + "Z" if entry.clock_out else None,
            "duration": duration,
            "durationSeconds": entry.duration_seconds,
            "category": entry.category.capitalize() if entry.category else "",
            "projectId": entry.project_id,
            "projectName": project.name if project else "No Project",
            "projectShortName": (project.short_name or "") if project else "",
            "status": entry.status,
            "notes": entry.notes,
        }

    @staticmethod
    def _get_assigned_projects(user):
        """
        Get all projects this user is assigned to (via ProjectUser table),
        enriched with per-project activity stats: hours logged (from
        time_entries), tasks touched (from tasks.mapped_by), and the most
        recent clock_out timestamp.

        All enrichment is done with two grouped aggregations (no N+1). Works
        cleanly on the existing time_entries.user_id and tasks.mapped_by
        indexes — no migration needed.
        """
        relations = ProjectUser.query.filter_by(user_id=user.id).all()
        if not relations:
            return []
        project_ids = [r.project_id for r in relations]
        projects = {
            p.id: p
            for p in Project.query.filter(Project.id.in_(project_ids)).all()
        }

        # Aggregation #1 — hours logged + last worked on, grouped by project
        time_rows = (
            db.session.query(
                TimeEntry.project_id,
                db.func.coalesce(db.func.sum(TimeEntry.duration_seconds), 0),
                db.func.max(TimeEntry.clock_out),
            )
            .filter(
                TimeEntry.user_id == user.id,
                TimeEntry.project_id.in_(project_ids),
                TimeEntry.status != "voided",
            )
            .group_by(TimeEntry.project_id)
            .all()
        )
        time_map = {
            pid: {
                "hours_logged": round(float(total_seconds or 0) / 3600.0, 2),
                "last_worked_on": (
                    last_clock_out.isoformat() + "Z" if last_clock_out else None
                ),
            }
            for pid, total_seconds, last_clock_out in time_rows
        }

        # Aggregation #2 — tasks touched by this user, grouped by project.
        # Only meaningful if we have an osm_username to match tasks against.
        task_map = {}
        if user.osm_username:
            task_rows = (
                db.session.query(Task.project_id, db.func.count(Task.id))
                .filter(
                    Task.mapped_by == user.osm_username,
                    Task.project_id.in_(project_ids),
                )
                .group_by(Task.project_id)
                .all()
            )
            task_map = {pid: count for pid, count in task_rows}

        result = []
        for pid in project_ids:
            p = projects.get(pid)
            if not p:
                continue
            t = time_map.get(pid, {"hours_logged": 0.0, "last_worked_on": None})
            result.append({
                "id": p.id,
                "name": p.name,
                "short_name": p.short_name,
                "source": p.source,
                "status": p.status,
                "hours_logged": t["hours_logged"],
                "last_worked_on": t["last_worked_on"],
                "task_count": task_map.get(pid, 0),
            })
        return result

    @requires_team_admin_or_above
    def fetch_user_profile_by_id(self):
        """Fetch comprehensive profile data for a specific user."""
        data = request.get_json() or {}
        user_id = data.get("userId")

        if not user_id:
            return {"message": "userId is required", "status": 400}

        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return {"message": "User not found in your organization", "status": 404}

        # team_admin: must be on a managed team (or self)
        if not is_org_admin_or_above(g.user):
            if g.user.id != user.id and not team_admin_can_access_user(g.user, user_id):
                return {"message": "Not in your managed teams", "status": 403}

        # Build per-project breakdown using SQL aggregation (not N+1 loops)
        projects_data = []
        osm_username = user.osm_username
        if osm_username:
            # Mapped tasks per project
            mapped_agg = (
                db.session.query(
                    Task.project_id,
                    db.func.count(Task.id),
                    db.func.coalesce(db.func.sum(Task.mapping_rate), 0),
                )
                .filter(
                    Task.mapped_by == osm_username,
                    Task.mapped == True,
                )
                .group_by(Task.project_id)
                .all()
            )
            # Validated tasks per project (as mapper)
            validated_agg = (
                db.session.query(
                    Task.project_id,
                    db.func.count(Task.id),
                )
                .filter(
                    Task.mapped_by == osm_username,
                    Task.validated == True,
                )
                .group_by(Task.project_id)
                .all()
            )
            # Invalidated tasks per project
            invalidated_agg = (
                db.session.query(
                    Task.project_id,
                    db.func.count(Task.id),
                )
                .filter(
                    Task.mapped_by == osm_username,
                    Task.invalidated == True,
                )
                .group_by(Task.project_id)
                .all()
            )
            # Validated as validator per project
            val_as_validator_agg = (
                db.session.query(
                    Task.project_id,
                    db.func.count(Task.id),
                    db.func.coalesce(db.func.sum(Task.validation_rate), 0),
                )
                .filter(
                    Task.validated_by == osm_username,
                    Task.validated == True,
                )
                .group_by(Task.project_id)
                .all()
            )

            # Merge into per-project dict
            proj_map = {}
            for pid, cnt, earn in mapped_agg:
                proj_map.setdefault(pid, {"mapped": 0, "validated": 0, "invalidated": 0, "map_earn": 0.0, "val_earn": 0.0})
                proj_map[pid]["mapped"] = cnt
                proj_map[pid]["map_earn"] = float(earn)
            for pid, cnt in validated_agg:
                proj_map.setdefault(pid, {"mapped": 0, "validated": 0, "invalidated": 0, "map_earn": 0.0, "val_earn": 0.0})
                proj_map[pid]["validated"] = cnt
            for pid, cnt in invalidated_agg:
                proj_map.setdefault(pid, {"mapped": 0, "validated": 0, "invalidated": 0, "map_earn": 0.0, "val_earn": 0.0})
                proj_map[pid]["invalidated"] = cnt
            for pid, cnt, earn in val_as_validator_agg:
                proj_map.setdefault(pid, {"mapped": 0, "validated": 0, "invalidated": 0, "map_earn": 0.0, "val_earn": 0.0})
                proj_map[pid]["val_earn"] = float(earn)

            # Bulk-load project names
            if proj_map:
                proj_objs = {p.id: p for p in Project.query.filter(Project.id.in_(proj_map.keys())).all()}
                for pid, stats in proj_map.items():
                    proj = proj_objs.get(pid)
                    projects_data.append({
                        "id": pid,
                        "name": proj.name if proj else f"Project {pid}",
                        "url": proj.url if proj else "",
                        "tasks_mapped": stats["mapped"],
                        "tasks_validated": stats["validated"],
                        "tasks_invalidated": stats["invalidated"],
                        "mapping_earnings": round(stats["map_earn"], 2),
                        "validation_earnings": round(stats["val_earn"], 2),
                    })

        # Get recent time entries (limited)
        time_entries = (
            TimeEntry.query
            .filter_by(user_id=user_id)
            .filter(TimeEntry.status.in_(["completed", "voided"]))
            .order_by(TimeEntry.clock_in.desc())
            .limit(50)
            .all()
        )

        # Bulk-load projects for time entries
        te_project_ids = {e.project_id for e in time_entries if e.project_id}
        te_project_cache = {}
        if te_project_ids:
            for p in Project.query.filter(Project.id.in_(te_project_ids)).all():
                te_project_cache[p.id] = p

        full_name = _format_user_name(user)

        # Resolve country/region names
        country_cache = {}
        region_cache = {}
        country_name, region_name = _resolve_country_region(
            user.country_id, country_cache, region_cache
        )

        _stats = get_user_task_stats(user)
        _pay = get_user_payment_balances(user)
        return {
            "status": 200,
            "user": {
                "id": user.id,
                "first_name": (user.first_name or "").title(),
                "last_name": (user.last_name or "").title(),
                "full_name": full_name,
                "email": user.email,
                "payment_email": user.payment_email,
                "osm_username": user.osm_username,
                "mapillary_username": user.mapillary_username,
                "role": user.role,
                "city": user.city,
                "country": user.country,
                "country_id": user.country_id,
                "country_name": country_name,
                "region_name": region_name,
                "timezone": user.timezone,
                "is_tracked_only": user.is_tracked_only or False,
                "micropayments_visible": user.micropayments_visible or False,
                "hourly_rate": user.hourly_rate,
                "is_active": bool(getattr(user, "is_active", True)),
                "joined": user.create_time.isoformat() if user.create_time else None,
                # Task stats
                "total_tasks_mapped": _stats["total_tasks_mapped"],
                "total_tasks_validated": _stats["total_tasks_validated"],
                "total_tasks_invalidated": _stats["total_tasks_invalidated"],
                "validator_tasks_validated": _stats["validator_tasks_validated"],
                "validator_tasks_invalidated": _stats["validator_tasks_invalidated"],
                # Payment stats
                "mapping_payable_total": _pay["mapping_payable_total"],
                "validation_payable_total": _pay["validation_payable_total"],
                "checklist_payable_total": round(user.checklist_payable_total or 0, 2),
                "payable_total": round(user.payable_total or 0, 2),
                "requested_total": round(user.requested_total or 0, 2),
                "paid_total": round(user.paid_total or 0, 2),
                # Other
                "total_checklists_completed": user.total_checklists_completed or 0,
                "validator_total_checklists_confirmed": user.validator_total_checklists_confirmed or 0,
                "mapper_level": user.mapper_level or 0,
                "mapper_points": user.mapper_points or 0,
                "validator_points": user.validator_points or 0,
                # Most recent name-change audit row, if any — exposes the
                # admin-facing "last edited" badge on the profile header
                # so we can see who touched the name and through which path.
                "name_last_change": self._get_last_name_change(user),
                # Nested
                "projects": projects_data,
                "assigned_projects": self._get_assigned_projects(user),
                "time_entries": [self._format_time_entry(e, te_project_cache) for e in time_entries],
            },
        }

    @staticmethod
    def _get_last_name_change(user):
        """
        Return the most recent UserNameAudit row for this user as a small
        dict, or None if there's no audit history. Used by the admin
        profile page's "name last changed" badge.
        """
        row = (
            UserNameAudit.query
            .filter_by(user_id=user.id)
            .order_by(UserNameAudit.changed_at.desc())
            .first()
        )
        if not row:
            return None

        # Resolve changed_by from an Auth0 id into a readable name. Raw
        # Auth0 ids are noise in the admin UI — show the actor's actual
        # name (or email as a fallback) instead. "system" passes through
        # unchanged for login_* audit rows.
        changed_by_name = None
        if row.changed_by and row.changed_by != "system":
            actor = User.query.filter_by(id=row.changed_by).first()
            if actor:
                changed_by_name = (
                    _format_user_name(actor)
                    if (actor.first_name or actor.last_name)
                    else actor.email
                )
        elif row.changed_by == "system":
            changed_by_name = "system"
        return {
            "changed_at": row.changed_at.isoformat() + "Z" if row.changed_at else None,
            "source": row.source,
            "changed_by": row.changed_by,           # raw id kept for debugging
            "changed_by_name": changed_by_name,     # friendly label for UI
            "old_first_name": row.old_first_name,
            "old_last_name": row.old_last_name,
            "new_first_name": row.new_first_name,
            "new_last_name": row.new_last_name,
        }

    @requires_team_admin_or_above
    def admin_update_user_profile(self):
        """Admin update of a user's country/timezone from profile page."""
        data = request.get_json() or {}
        user_id = data.get("userId")
        if not user_id:
            return {"message": "userId is required", "status": 400}

        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return {"message": "User not found in your organization", "status": 404}

        # team_admin: must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, user_id):
                return {"message": "Not in your managed teams", "status": 403}

        updates = {}

        # Handle country_id change
        new_country_id = data.get("countryId")
        if new_country_id is not None:
            if new_country_id:
                country_obj = Country.query.get(new_country_id)
                if not country_obj:
                    return {"message": "Country not found", "status": 404}
                updates["country_id"] = new_country_id
                # Auto-set timezone from country default if not explicitly provided
                if "timezone" not in data and country_obj.default_timezone:
                    updates["timezone"] = country_obj.default_timezone
                # Also update free-text country field
                updates["country"] = country_obj.name
                # Manage UserCountry record
                existing_uc = UserCountry.query.filter_by(
                    user_id=user_id, country_id=new_country_id
                ).first()
                if not existing_uc:
                    UserCountry.create(
                        user_id=user_id,
                        country_id=new_country_id,
                        is_primary=True,
                    )
            else:
                updates["country_id"] = None

        # Handle explicit timezone
        if "timezone" in data:
            updates["timezone"] = data["timezone"] or None

        # Handle mapillary_username
        if "mapillary_username" in data:
            updates["mapillary_username"] = (data["mapillary_username"] or "").strip() or None

        if updates:
            user.update(**updates)

        return {"status": 200, "message": "User profile updated"}

    @requires_team_admin_or_above
    def fetch_user_stats_by_date(self):
        """Fetch date-filtered time tracking stats for a user."""
        data = request.get_json() or {}
        user_id = data.get("userId")
        start_date_str = data.get("startDate")
        end_date_str = data.get("endDate")

        if not user_id or not start_date_str or not end_date_str:
            return {"message": "userId, startDate, and endDate are required", "status": 400}

        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return {"message": "User not found in your organization", "status": 404}

        # team_admin: must be on a managed team (or self)
        if not is_org_admin_or_above(g.user):
            if g.user.id != user.id and not team_admin_can_access_user(g.user, user_id):
                return {"message": "Not in your managed teams", "status": 403}

        # Accept ISO UTC instants (preferred — frontend aligns them to the
        # viewer-admin's local midnights) or legacy date-only strings.
        start_date, _ = parse_filter_datetime(start_date_str)
        end_date, end_was_date_only = parse_filter_datetime(end_date_str)
        if start_date is None or end_date is None:
            return {"message": "Invalid date format. Use ISO 8601.", "status": 400}
        if end_was_date_only:
            end_date = end_date + timedelta(days=1)

        # Query time entries in date range
        entries = (
            TimeEntry.query
            .filter(
                TimeEntry.user_id == user_id,
                TimeEntry.status == "completed",
                TimeEntry.clock_in >= start_date,
                TimeEntry.clock_in < end_date,
            )
            .order_by(TimeEntry.clock_in.desc())
            .all()
        )

        total_seconds = sum(e.duration_seconds or 0 for e in entries)
        total_hours = round(total_seconds / 3600, 1)

        # Bulk-load all referenced projects in one query
        project_ids = {e.project_id for e in entries if e.project_id}
        project_cache = {}
        if project_ids:
            for p in Project.query.filter(Project.id.in_(project_ids)).all():
                project_cache[p.id] = p

        # Per-project breakdown (using cache, no N+1)
        project_hours = {}
        for e in entries:
            pid = e.project_id or 0
            if pid not in project_hours:
                proj = project_cache.get(pid)
                project_hours[pid] = {
                    "id": pid,
                    "name": proj.name if proj else "No Project",
                    "total_seconds": 0,
                    "entries_count": 0,
                }
            project_hours[pid]["total_seconds"] += (e.duration_seconds or 0)
            project_hours[pid]["entries_count"] += 1

        projects_list = [
            {
                "id": v["id"],
                "name": v["name"],
                "total_hours": round(v["total_seconds"] / 3600, 1),
                "entries_count": v["entries_count"],
            }
            for v in sorted(project_hours.values(), key=lambda x: x["total_seconds"], reverse=True)
        ]

        # Date-filtered task stats — use SQL aggregation instead of loading all rows
        osm_username = user.osm_username
        tasks_mapped_in_range = 0
        tasks_validated_in_range = 0
        tasks_invalidated_in_range = 0
        validator_validated_in_range = 0
        mapping_earnings_in_range = 0.0
        validation_earnings_in_range = 0.0

        if osm_username:
            tasks_mapped_in_range = Task.query.filter(
                Task.mapped_by == osm_username,
                Task.mapped == True,
                Task.date_mapped >= start_date,
                Task.date_mapped < end_date,
            ).count()

            mapping_earnings_row = db.session.query(
                db.func.coalesce(db.func.sum(Task.mapping_rate), 0)
            ).filter(
                Task.mapped_by == osm_username,
                Task.mapped == True,
                Task.validated == True,
                Task.date_mapped >= start_date,
                Task.date_mapped < end_date,
            ).scalar()
            mapping_earnings_in_range = float(mapping_earnings_row or 0)

            tasks_validated_in_range = Task.query.filter(
                Task.mapped_by == osm_username,
                Task.validated == True,
                Task.date_validated >= start_date,
                Task.date_validated < end_date,
            ).count()

            tasks_invalidated_in_range = Task.query.filter(
                Task.mapped_by == osm_username,
                Task.invalidated == True,
                Task.date_validated >= start_date,
                Task.date_validated < end_date,
            ).count()

            validator_validated_in_range = Task.query.filter(
                Task.validated_by == osm_username,
                Task.validated == True,
                Task.date_validated >= start_date,
                Task.date_validated < end_date,
            ).count()

            validation_earnings_row = db.session.query(
                db.func.coalesce(db.func.sum(Task.validation_rate), 0)
            ).filter(
                Task.validated_by == osm_username,
                Task.validated == True,
                Task.date_validated >= start_date,
                Task.date_validated < end_date,
            ).scalar()
            validation_earnings_in_range = float(validation_earnings_row or 0)

        # Paginate time entries — return max 100, with total count
        page_size = 100
        paginated_entries = entries[:page_size]

        return {
            "status": 200,
            "stats": {
                "startDate": start_date_str,
                "endDate": end_date_str,
                "total_hours": total_hours,
                "entries_count": len(entries),
                "time_entries": [self._format_time_entry(e, project_cache) for e in paginated_entries],
                "has_more_entries": len(entries) > page_size,
                "projects": projects_list,
                "tasks_mapped": tasks_mapped_in_range,
                "tasks_validated": tasks_validated_in_range,
                "tasks_invalidated": tasks_invalidated_in_range,
                "validator_validated": validator_validated_in_range,
                "mapping_earnings": round(mapping_earnings_in_range, 2),
                "validation_earnings": round(validation_earnings_in_range, 2),
            },
        }

    @requires_team_admin_or_above
    def fetch_user_payment_summary(self):
        """Read-only payment summary for the admin user-profile Payment tab.

        Returns one bundle covering: lifetime paid, pending balance,
        open requested total, last payment, hourly rate, recent payments
        (last 25) with resolved project names, all open pay requests,
        and an anomaly count for validated tasks > 30 days old that are
        not yet attached to any PayRequest or Payment.
        """
        data = request.get_json() or {}
        user_id = data.get("userId") or data.get("user_id")
        if not user_id:
            return {"message": "userId is required", "status": 400}

        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return {"message": "User not found in your organization", "status": 404}

        # team_admin: must be on a managed team (or self)
        if not is_org_admin_or_above(g.user):
            if g.user.id != user.id and not team_admin_can_access_user(g.user, user_id):
                return {"message": "Not in your managed teams", "status": 403}

        # Lifetime paid + recent payments
        all_payments = (
            Payments.query
            .filter_by(org_id=g.user.org_id, user_id=user_id)
            .order_by(Payments.date_paid.desc())
            .all()
        )
        lifetime_paid = round(sum((p.amount_paid or 0) for p in all_payments), 2)
        recent_raw = all_payments[:25]

        # Open pay requests (anything outstanding for this user)
        open_requests_raw = (
            PayRequests.query
            .filter_by(org_id=g.user.org_id, user_id=user_id)
            .order_by(PayRequests.date_requested.desc())
            .all()
        )
        open_request_total = round(
            sum((r.amount_requested or 0) for r in open_requests_raw), 2
        )

        # Resolve project names for recent payments in one batched query.
        # Each payment.task_ids is an array; collect the union, look up
        # Task → Project once, then for each payment derive a deduped
        # list of project names.
        all_recent_task_ids = set()
        for p in recent_raw:
            if p.task_ids:
                all_recent_task_ids.update(p.task_ids)
        task_to_project = {}
        project_id_to_name = {}
        if all_recent_task_ids:
            for t in (
                Task.query
                .filter(Task.id.in_(all_recent_task_ids))
                .with_entities(Task.id, Task.project_id)
                .all()
            ):
                task_to_project[t.id] = t.project_id
            project_ids = {pid for pid in task_to_project.values() if pid}
            if project_ids:
                for proj in (
                    Project.query
                    .filter(Project.id.in_(project_ids))
                    .with_entities(Project.id, Project.name)
                    .all()
                ):
                    project_id_to_name[proj.id] = proj.name

        def _project_names_for(task_ids):
            if not task_ids:
                return []
            seen = []
            for tid in task_ids:
                pid = task_to_project.get(tid)
                if not pid:
                    continue
                name = project_id_to_name.get(pid)
                if name and name not in seen:
                    seen.append(name)
            return seen

        recent_payments = [
            {
                "id": p.id,
                "date": p.date_paid.isoformat() if p.date_paid else None,
                "amount": p.amount_paid,
                "projects": _project_names_for(p.task_ids),
                "task_count": len(p.task_ids) if p.task_ids else 0,
                "notes": p.notes or "",
            }
            for p in recent_raw
        ]

        last_payment_obj = recent_raw[0] if recent_raw else None
        last_payment = None
        if last_payment_obj:
            last_payment = {
                "date": (
                    last_payment_obj.date_paid.isoformat()
                    if last_payment_obj.date_paid
                    else None
                ),
                "amount": last_payment_obj.amount_paid,
                "payment_email": last_payment_obj.payment_email or "",
                "notes": last_payment_obj.notes or "",
            }

        open_requests = [
            {
                "id": r.id,
                "date_requested": (
                    r.date_requested.isoformat() if r.date_requested else None
                ),
                "amount_requested": r.amount_requested,
                "task_count": len(r.task_ids) if r.task_ids else 0,
                "notes": r.notes or "",
            }
            for r in open_requests_raw
        ]

        # Live pending balance — same computation /transaction/fetch_user_payable
        # uses, so the number matches what the user sees on their own page.
        balances = get_user_payment_balances(user)
        pending_balance = round(
            (balances.get("mapping_payable_total") or 0)
            + (balances.get("validation_payable_total") or 0)
            + (user.checklist_payable_total or 0),
            2,
        )

        # Anomalies: validated tasks > 30 days old, mapped or validated by
        # this user, not yet attached to any PayRequest/Payment.
        cutoff = datetime.utcnow() - timedelta(days=30)
        claimed = _get_claimed_task_ids(user.id)
        osm_un = user.osm_username

        # User's mapped tasks
        user_task_ids = set(
            ut.task_id
            for ut in UserTasks.query.filter_by(user_id=user.id).all()
        )

        anomaly_tasks = []
        anomaly_amount = 0.0
        if osm_un and (user_task_ids or True):
            # Mapping side: validated tasks the user mapped, > 30d ago
            mapped_anom = (
                Task.query
                .filter(
                    Task.org_id == g.user.org_id,
                    Task.validated == True,  # noqa: E712
                    Task.date_validated <= cutoff,
                )
                .all()
            )
            for t in mapped_anom:
                if t.id in claimed:
                    continue
                if getattr(t, "self_validated", False):
                    continue
                # Mapper-side claim: user owns this task via UserTasks
                if t.id in user_task_ids and t.mapping_rate:
                    anomaly_tasks.append({
                        "task_id": t.id,
                        "project_id": t.project_id,
                        "date_validated": (
                            t.date_validated.isoformat()
                            if t.date_validated
                            else None
                        ),
                        "rate": t.mapping_rate,
                        "type": "mapping",
                    })
                    anomaly_amount += t.mapping_rate
                # Validator-side claim: user validated this task
                if t.validated_by == osm_un and t.validation_rate:
                    anomaly_tasks.append({
                        "task_id": t.id,
                        "project_id": t.project_id,
                        "date_validated": (
                            t.date_validated.isoformat()
                            if t.date_validated
                            else None
                        ),
                        "rate": t.validation_rate,
                        "type": "validation",
                    })
                    anomaly_amount += t.validation_rate

        # Resolve project names for the anomaly task list (capped at 50 in response)
        anom_project_ids = {a["project_id"] for a in anomaly_tasks if a["project_id"]}
        anom_project_names = {}
        if anom_project_ids:
            for proj in (
                Project.query
                .filter(Project.id.in_(anom_project_ids))
                .with_entities(Project.id, Project.name)
                .all()
            ):
                anom_project_names[proj.id] = proj.name
        anomaly_list = [
            {**a, "project": anom_project_names.get(a["project_id"]) or "—"}
            for a in anomaly_tasks[:50]
        ]

        return {
            "status": 200,
            "summary": {
                "lifetime_paid": lifetime_paid,
                "pending_balance": pending_balance,
                "open_request_total": open_request_total,
                "last_payment": last_payment,
                "hourly_rate": user.hourly_rate,
                "recent_payments": recent_payments,
                "open_requests": open_requests,
                "anomalies": {
                    "unpaid_over_30d_count": len(anomaly_tasks),
                    "unpaid_over_30d_amount": round(anomaly_amount, 2),
                    "tasks": anomaly_list,
                },
            },
        }

    @requires_team_admin_or_above
    def fetch_user_changesets(self):
        """Fetch OSM changesets for a user within a date range."""
        import xml.etree.ElementTree as ET
        from concurrent.futures import ThreadPoolExecutor, as_completed

        data = request.get_json() or {}
        user_id = data.get("userId")
        start_date_str = data.get("startDate")
        end_date_str = data.get("endDate")

        if not user_id or not start_date_str or not end_date_str:
            return {"message": "userId, startDate, and endDate are required", "status": 400}

        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return {"message": "User not found in your organization", "status": 404}

        # team_admin: must be on a managed team (or self)
        if not is_org_admin_or_above(g.user):
            if g.user.id != user.id and not team_admin_can_access_user(g.user, user_id):
                return {"message": "Not in your managed teams", "status": 403}

        osm_username = user.osm_username
        if not osm_username:
            return {
                "status": 200,
                "changesets": [],
                "summary": {
                    "totalChangesets": 0, "totalChanges": 0,
                    "totalAdded": 0, "totalModified": 0, "totalDeleted": 0,
                },
                "hashtagSummary": {},
                "message": "No OSM username set for this user",
            }

        # Fetch changesets from OSM API
        osm_url = "https://api.openstreetmap.org/api/0.6/changesets"
        params = {
            "display_name": osm_username,
            "time": f"{start_date_str},{end_date_str}",
            "closed": "true",
        }

        try:
            resp = requests.get(osm_url, params=params, timeout=30)
            if not resp.ok:
                current_app.logger.error(f"OSM API error: {resp.status_code} - {resp.text[:200]}")
                return {"message": "Could not reach OSM API", "status": 502}
        except requests.RequestException as e:
            current_app.logger.error(f"OSM API request failed: {e}")
            return {"message": f"OSM API error: {str(e)}", "status": 502}

        # Parse changeset list XML
        try:
            root = ET.fromstring(resp.text)
        except ET.ParseError as e:
            current_app.logger.error(f"Failed to parse OSM XML: {e}")
            return {"message": "Failed to parse OSM API response", "status": 502}

        changeset_metas = []
        for cs in root.findall("changeset"):
            tags = {}
            for tag in cs.findall("tag"):
                tags[tag.get("k", "")] = tag.get("v", "")

            # Extract hashtags from comment
            comment = tags.get("comment", "")
            hashtags_from_comment = [
                word for word in comment.split() if word.startswith("#")
            ]
            # Also check the hashtag tag
            hashtag_tag = tags.get("hashtag", "")
            if hashtag_tag:
                for h in hashtag_tag.split(";"):
                    h = h.strip()
                    if h and not h.startswith("#"):
                        h = "#" + h
                    if h and h not in hashtags_from_comment:
                        hashtags_from_comment.append(h)

            # Extract bbox centroid for heatmap
            min_lat = cs.get("min_lat")
            max_lat = cs.get("max_lat")
            min_lon = cs.get("min_lon")
            max_lon = cs.get("max_lon")
            centroid = None
            if min_lat and max_lat and min_lon and max_lon:
                centroid = {
                    "lat": (float(min_lat) + float(max_lat)) / 2,
                    "lon": (float(min_lon) + float(max_lon)) / 2,
                }

            changeset_metas.append({
                "id": int(cs.get("id", 0)),
                "createdAt": cs.get("created_at", ""),
                "closedAt": cs.get("closed_at", ""),
                "changesCount": int(cs.get("changes_count", 0)),
                "comment": comment,
                "hashtags": hashtags_from_comment,
                "source": tags.get("source", ""),
                "imageryUsed": tags.get("imagery_used", tags.get("source", "")),
                "added": None,
                "modified": None,
                "deleted": None,
                "elements": None,
                "centroid": centroid,
            })

        # Fetch detail counts for each changeset concurrently
        def fetch_changeset_details(cs_id):
            """Fetch OsmChange XML and count create/modify/delete elements plus element types."""
            try:
                detail_url = f"https://api.openstreetmap.org/api/0.6/changeset/{cs_id}/download"
                detail_resp = requests.get(detail_url, timeout=30)
                if not detail_resp.ok:
                    return cs_id, None, None, None, None

                detail_root = ET.fromstring(detail_resp.text)
                added = 0
                modified = 0
                deleted = 0
                nodes = 0
                ways = 0
                relations = 0

                for child in detail_root:
                    tag_name = child.tag.lower()
                    for elem in child:
                        elem_type = elem.tag.lower()
                        if elem_type == "node":
                            nodes += 1
                        elif elem_type == "way":
                            ways += 1
                        elif elem_type == "relation":
                            relations += 1

                        if tag_name == "create":
                            added += 1
                        elif tag_name == "modify":
                            modified += 1
                        elif tag_name == "delete":
                            deleted += 1

                return cs_id, added, modified, deleted, {"nodes": nodes, "ways": ways, "relations": relations}
            except Exception:
                return cs_id, None, None, None, None

        # Only fetch per-changeset details if explicitly requested
        # (each one is an HTTP call to OSM API — very slow for many changesets)
        include_details = data.get("includeDetails", False)
        detail_map = {}
        if include_details and changeset_metas:
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {
                    executor.submit(fetch_changeset_details, cs["id"]): cs["id"]
                    for cs in changeset_metas
                }
                for future in as_completed(futures):
                    result = future.result()
                    cs_id = result[0]
                    detail_map[cs_id] = result[1:]

            # Merge details into changeset metadata
            for cs in changeset_metas:
                details = detail_map.get(cs["id"])
                if details:
                    cs["added"], cs["modified"], cs["deleted"], cs["elements"] = details

        # Compute summary
        total_changesets = len(changeset_metas)
        total_changes = sum(cs["changesCount"] for cs in changeset_metas)
        total_added = sum(cs["added"] or 0 for cs in changeset_metas)
        total_modified = sum(cs["modified"] or 0 for cs in changeset_metas)
        total_deleted = sum(cs["deleted"] or 0 for cs in changeset_metas)
        total_nodes = sum((cs.get("elements") or {}).get("nodes", 0) for cs in changeset_metas)
        total_ways = sum((cs.get("elements") or {}).get("ways", 0) for cs in changeset_metas)
        total_relations = sum((cs.get("elements") or {}).get("relations", 0) for cs in changeset_metas)

        # Build heatmap points from centroids
        heatmap_points = [
            [cs["centroid"]["lat"], cs["centroid"]["lon"], cs["changesCount"]]
            for cs in changeset_metas if cs.get("centroid")
        ]

        # Aggregate hashtags
        hashtag_summary = {}
        for cs in changeset_metas:
            for h in cs["hashtags"]:
                hashtag_summary[h] = hashtag_summary.get(h, 0) + 1

        # Sort changesets by creation date (newest first)
        changeset_metas.sort(key=lambda x: x["createdAt"], reverse=True)

        return {
            "status": 200,
            "changesets": changeset_metas,
            "summary": {
                "totalChangesets": total_changesets,
                "totalChanges": total_changes,
                "totalAdded": total_added,
                "totalModified": total_modified,
                "totalDeleted": total_deleted,
                "totalNodes": total_nodes,
                "totalWays": total_ways,
                "totalRelations": total_relations,
            },
            "hashtagSummary": hashtag_summary,
            "heatmapPoints": heatmap_points,
        }

    @requires_team_admin_or_above
    def fetch_user_activity_chart(self):
        """Aggregate daily activity data for charting."""
        data = request.get_json() or {}
        user_id = data.get("userId")
        start_date_str = data.get("startDate")
        end_date_str = data.get("endDate")

        if not user_id or not start_date_str or not end_date_str:
            return {"message": "userId, startDate, and endDate required", "status": 400}

        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return {"message": "User not found", "status": 404}

        # team_admin: must be on a managed team (or self)
        if not is_org_admin_or_above(g.user):
            if g.user.id != user.id and not team_admin_can_access_user(g.user, user_id):
                return {"message": "Not in your managed teams", "status": 403}

        # Parse dates
        try:
            try:
                start_date = datetime.strptime(start_date_str, "%Y-%m-%dT%H:%M:%S")
            except ValueError:
                start_date = datetime.strptime(start_date_str, "%Y-%m-%d")
            try:
                end_date = datetime.strptime(end_date_str, "%Y-%m-%dT%H:%M:%S")
            except ValueError:
                end_date = datetime.strptime(end_date_str, "%Y-%m-%d") + timedelta(days=1)
        except ValueError:
            return {"message": "Invalid date format", "status": 400}

        osm_username = user.osm_username

        # Generate day-by-day buckets
        days = {}
        current = start_date.date() if hasattr(start_date, "date") else start_date
        end = end_date.date() if hasattr(end_date, "date") else end_date
        while current <= end:
            days[current.isoformat()] = {
                "date": current.isoformat(),
                "tasksMapped": 0,
                "tasksValidated": 0,
                "hoursWorked": 0.0,
            }
            current += timedelta(days=1)

        # Fill task data
        if osm_username:
            mapped = Task.query.filter(
                Task.mapped_by == osm_username,
                Task.mapped == True,
                Task.date_mapped >= start_date,
                Task.date_mapped < end_date,
            ).all()
            for t in mapped:
                day_key = t.date_mapped.date().isoformat()
                if day_key in days:
                    days[day_key]["tasksMapped"] += 1

            validated = Task.query.filter(
                Task.validated_by == osm_username,
                Task.validated == True,
                Task.date_validated >= start_date,
                Task.date_validated < end_date,
            ).all()
            for t in validated:
                day_key = t.date_validated.date().isoformat()
                if day_key in days:
                    days[day_key]["tasksValidated"] += 1

        # Fill time tracking data
        entries = TimeEntry.query.filter(
            TimeEntry.user_id == user_id,
            TimeEntry.status == "completed",
            TimeEntry.clock_in >= start_date,
            TimeEntry.clock_in < end_date,
        ).all()
        for e in entries:
            day_key = e.clock_in.date().isoformat()
            if day_key in days:
                days[day_key]["hoursWorked"] += round((e.duration_seconds or 0) / 3600, 1)

        # Filter out days with no activity
        activity = [
            v for v in sorted(days.values(), key=lambda x: x["date"])
            if v["tasksMapped"] or v["tasksValidated"] or v["hoursWorked"]
        ]

        return {"status": 200, "activity": activity}

    @requires_team_admin_or_above
    def fetch_user_task_history(self):
        """Fetch task-level history for a user in date range."""
        data = request.get_json() or {}
        user_id = data.get("userId")
        start_date_str = data.get("startDate")
        end_date_str = data.get("endDate")

        if not user_id or not start_date_str or not end_date_str:
            return {"message": "userId, startDate, and endDate required", "status": 400}

        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return {"message": "User not found", "status": 404}

        # team_admin: must be on a managed team (or self)
        if not is_org_admin_or_above(g.user):
            if g.user.id != user.id and not team_admin_can_access_user(g.user, user_id):
                return {"message": "Not in your managed teams", "status": 403}

        # Parse dates
        try:
            try:
                start_date = datetime.strptime(start_date_str, "%Y-%m-%dT%H:%M:%S")
            except ValueError:
                start_date = datetime.strptime(start_date_str, "%Y-%m-%d")
            try:
                end_date = datetime.strptime(end_date_str, "%Y-%m-%dT%H:%M:%S")
            except ValueError:
                end_date = datetime.strptime(end_date_str, "%Y-%m-%d") + timedelta(days=1)
        except ValueError:
            return {"message": "Invalid date format", "status": 400}

        osm_username = user.osm_username
        if not osm_username:
            return {"status": 200, "tasks": []}

        history = []

        # Tasks mapped by this user
        mapped = Task.query.filter(
            Task.mapped_by == osm_username,
            Task.date_mapped >= start_date,
            Task.date_mapped < end_date,
        ).all()
        for t in mapped:
            proj = Project.query.get(t.project_id)
            history.append({
                "taskId": t.task_id,
                "projectId": t.project_id,
                "projectName": proj.name if proj else f"Project {t.project_id}",
                "projectShortName": (proj.short_name or "") if proj else "",
                "action": "mapped",
                "date": t.date_mapped.isoformat() if t.date_mapped else None,
                "status": "validated" if t.validated else ("invalidated" if t.invalidated else "pending"),
                "validatedBy": t.validated_by,
                "mappingRate": t.mapping_rate,
            })

        # Tasks validated/invalidated by this user
        val_tasks = Task.query.filter(
            Task.validated_by == osm_username,
            Task.date_validated >= start_date,
            Task.date_validated < end_date,
        ).all()
        for t in val_tasks:
            proj = Project.query.get(t.project_id)
            action = "validated" if t.validated else "invalidated"
            history.append({
                "taskId": t.task_id,
                "projectId": t.project_id,
                "projectName": proj.name if proj else f"Project {t.project_id}",
                "projectShortName": (proj.short_name or "") if proj else "",
                "action": action,
                "date": t.date_validated.isoformat() if t.date_validated else None,
                "status": action,
                "mappedBy": t.mapped_by,
                "validationRate": t.validation_rate,
            })

        # Sort by date descending
        history.sort(key=lambda x: x["date"] or "", reverse=True)

        return {"status": 200, "tasks": history}

    def link_mapillary(self):
        """Link a Mapillary account by username, verifying it exists via API."""
        if not g.user:
            return {"message": "User not found", "status": 304}

        data = request.get_json() or {}
        username = (data.get("mapillary_username") or "").strip()
        if not username:
            return {"message": "Mapillary username is required", "status": 400}

        # Check if this username is already linked to another user in the org
        existing = User.query.filter(
            User.mapillary_username == username,
            User.id != g.user.id,
        ).first()
        if existing:
            return {
                "message": "This Mapillary username is already linked to another user",
                "status": 409,
            }

        # Verify the username exists on Mapillary by searching for images
        token = current_app.config.get("MAPILLARY_ACCESS_TOKEN")
        if token:
            try:
                resp = requests.get(
                    "https://graph.mapillary.com/images",
                    params={
                        "access_token": token,
                        "creator_username": username,
                        "fields": "id",
                        "limit": 1,
                    },
                    timeout=10,
                )
                if resp.status_code == 200:
                    data_resp = resp.json()
                    if not data_resp.get("data"):
                        return {
                            "message": f"No Mapillary account found for username '{username}'. Please check the spelling.",
                            "status": 404,
                        }
                elif resp.status_code in (400, 404):
                    return {
                        "message": f"Mapillary username '{username}' could not be verified. Please check the spelling.",
                        "status": 404,
                    }
            except Exception as e:
                current_app.logger.warning(f"Mapillary verification failed: {e}")
                # If API is down, still allow linking (best effort)

        g.user.update(mapillary_username=username)
        return {
            "message": f"Mapillary account '{username}' linked successfully",
            "mapillary_username": username,
            "status": 200,
        }

    def unlink_mapillary(self):
        """Unlink the current user's Mapillary account."""
        if not g.user:
            return {"message": "User not found", "status": 304}

        if not g.user.mapillary_username:
            return {"message": "No Mapillary account linked", "status": 400}

        g.user.update(mapillary_username=None)
        return {"message": "Mapillary account unlinked successfully", "status": 200}
