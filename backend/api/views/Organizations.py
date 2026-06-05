"""
Organization management API — super_admin only.

Provisions and manages tenant Auth0 Organizations end-to-end from the Mikro UI
so a Kaart super_admin never has to touch the Auth0 dashboard. The
``organizations`` table is the single source of truth; every Auth0 mutation is
mirrored into it.

SECURITY: every handler is gated by ``@requires_super_admin``. Only Kaart
super_admins may add / edit / disable / restore organizations.

Phase A of ``.claude/external-org-management-plan.md``. (Login-side org
validation and the /wrong-org gate relaxation are Phase B — until then a newly
provisioned org is recorded and invitable but the gate still limits logins.)
"""

import re
from datetime import datetime

import requests
from flask import current_app, g, request
from flask.views import MethodView

from ..auth.auth import get_auth0_management_api_token
from ..database import Organization
from ..utils import requires_super_admin
from ..utils.auth0_org import add_or_invite_user_to_org, get_db_connection_id


class OrganizationAPI(MethodView):
    """super_admin-only CRUD + provisioning for tenant Organizations."""

    def post(self, path):
        if path == "list":
            return self.list_organizations()
        elif path == "create":
            return self.create_organization()
        elif path == "update":
            return self.update_organization()
        elif path == "disable":
            return self.disable_organization()
        elif path == "restore":
            return self.restore_organization()
        return {"message": "Unknown path", "status": 404}

    # ───────────────────────────── helpers ─────────────────────────────

    def _mgmt(self):
        """Return ``(domain, headers)`` for Management API calls.

        Returns ``(None, None)`` if Auth0 is unconfigured or the token fetch
        fails — callers translate that into a 500.
        """
        domain = current_app.config.get("AUTH0_DOMAIN")
        token = get_auth0_management_api_token()
        if not domain or not token:
            return None, None
        return domain, {"Authorization": f"Bearer {token}"}

    @staticmethod
    def _serialize(o):
        return {
            "id": o.id,
            "name": o.name,
            "display_name": o.display_name,
            "status": o.status,
            "contact_name": o.contact_name,
            "contact_email": o.contact_email,
            "notes": o.notes,
            "created_by_user_id": o.created_by_user_id,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "disabled_at": o.disabled_at.isoformat() if o.disabled_at else None,
        }

    # ───────────────────────────── handlers ────────────────────────────

    @requires_super_admin
    def list_organizations(self):
        """List every org (active + disabled) with remaining capacity."""
        orgs = Organization.query.order_by(Organization.created_at.asc()).all()
        limit = current_app.config.get("AUTH0_ORG_LIMIT", 10)
        active = sum(1 for o in orgs if o.status == "active")
        return {
            "organizations": [self._serialize(o) for o in orgs],
            "limit": limit,
            "active_count": active,
            "remaining": max(0, limit - active),
            "status": 200,
        }

    @requires_super_admin
    def create_organization(self):
        """Provision a new org: Auth0 org + DB connection + DB row + 1st admin."""
        body = request.json or {}
        name = (body.get("name") or "").strip().lower()
        display_name = (body.get("displayName") or body.get("name") or "").strip()
        admin_email = (body.get("adminEmail") or "").strip()
        contact_name = (body.get("contactName") or "").strip() or None
        contact_email = (body.get("contactEmail") or "").strip() or None
        notes = (body.get("notes") or "").strip() or None

        # Auth0 org `name`: 1-50 chars, slug-ish (lowercase letters/digits/-/_).
        if not name:
            return {"message": "Organization name is required", "status": 400}
        if not re.fullmatch(r"[a-z0-9_-]{1,50}", name):
            return {
                "message": (
                    "Name must be 1-50 chars: lowercase letters, digits, " "'-' or '_'."
                ),
                "status": 400,
            }

        # Capacity guard (B2C cap). Count active orgs in our SSOT table.
        limit = current_app.config.get("AUTH0_ORG_LIMIT", 10)
        active = Organization.query.filter_by(status="active").count()
        if active >= limit:
            return {
                "message": (
                    f"Organization limit reached ({active}/{limit}). Upgrade the "
                    "Auth0 plan to B2B for unlimited organizations."
                ),
                "status": 409,
            }

        domain, headers = self._mgmt()
        if not domain:
            return {
                "message": "Auth0 Management API not configured/reachable",
                "status": 500,
            }

        connection_id = get_db_connection_id(domain, headers)
        if not connection_id:
            return {
                "message": "Username-Password-Authentication connection not found",
                "status": 500,
            }

        # 1) Create the Auth0 Organization with ONLY the DB connection enabled.
        #    Security: no auto-membership-on-login, no open signup.
        create_payload = {
            "name": name,
            "display_name": display_name or name,
            "enabled_connections": [
                {
                    "connection_id": connection_id,
                    "assign_membership_on_login": False,
                }
            ],
        }
        create_resp = requests.post(
            f"https://{domain}/api/v2/organizations",
            json=create_payload,
            headers=headers,
        )
        if not create_resp.ok:
            try:
                err = create_resp.json().get("message", create_resp.text)
            except Exception:
                err = create_resp.text
            current_app.logger.error(f"Auth0 org create failed: {create_resp.text}")
            return {
                "message": f"Failed to create organization: {err}",
                "status": create_resp.status_code,
            }

        new_org_id = (create_resp.json() or {}).get("id")
        if not new_org_id:
            return {
                "message": "Auth0 did not return an organization id",
                "status": 502,
            }

        # 2) Mirror into our SSOT table.
        try:
            Organization.create(
                id=new_org_id,
                name=name,
                display_name=display_name or name,
                status="active",
                created_by_user_id=getattr(g.user, "id", None),
                contact_name=contact_name,
                contact_email=contact_email,
                notes=notes,
            )
        except Exception as e:
            current_app.logger.error(
                f"Org {new_org_id} created in Auth0 but DB mirror failed: {e}"
            )
            return {
                "message": (
                    "Organization created in Auth0 but failed to record "
                    "locally. Contact a developer to reconcile."
                ),
                "status": 500,
            }

        # 3) Invite the first admin into the NEW org (best-effort — the org
        #    exists regardless; it can be re-invited from the org list).
        admin_result = None
        if admin_email:
            admin_result = add_or_invite_user_to_org(
                domain=domain,
                headers=headers,
                org_id=new_org_id,
                email=admin_email,
                role_id=current_app.config.get("AUTH0_ADMIN_ROLE_ID"),
                app_client_id=current_app.config.get("AUTH0_APP_CLIENT_ID"),
                client_id=current_app.config.get("AUTH0_M2M_CLIENT_ID"),
                inviter_name="Kaart",
            )

        created = Organization.query.get(new_org_id)
        return {
            "message": f"Organization '{display_name or name}' created.",
            "organization": self._serialize(created) if created else None,
            "admin_invite": admin_result,
            "status": 200,
        }

    @requires_super_admin
    def update_organization(self):
        """Edit display name / notes / contact on an org (and push the display
        name to Auth0 so the two stay in sync)."""
        body = request.json or {}
        org_id = body.get("orgId")
        if not org_id:
            return {"message": "orgId required", "status": 400}
        org = Organization.query.get(org_id)
        if not org:
            return {"message": "Organization not found", "status": 404}

        updates = {}
        if "displayName" in body:
            updates["display_name"] = (body.get("displayName") or "").strip() or None
        if "notes" in body:
            updates["notes"] = (body.get("notes") or "").strip() or None
        if "contactName" in body:
            updates["contact_name"] = (body.get("contactName") or "").strip() or None
        if "contactEmail" in body:
            updates["contact_email"] = (body.get("contactEmail") or "").strip() or None

        # Keep Auth0's display_name in sync (it must be non-empty).
        if "display_name" in updates:
            domain, headers = self._mgmt()
            if domain:
                requests.patch(
                    f"https://{domain}/api/v2/organizations/{org_id}",
                    json={"display_name": updates["display_name"] or org.name},
                    headers=headers,
                )

        org.update(**updates)
        return {"organization": self._serialize(org), "status": 200}

    @requires_super_admin
    def disable_organization(self):
        """Soft-disable an org: blocks future login (Phase B), retains data."""
        body = request.json or {}
        org_id = body.get("orgId")
        if not org_id:
            return {"message": "orgId required", "status": 400}
        org = Organization.query.get(org_id)
        if not org:
            return {"message": "Organization not found", "status": 404}

        kaart_org_id = current_app.config.get("AUTH0_ORG_ID")
        if kaart_org_id and org_id == kaart_org_id:
            return {
                "message": "The Kaart organization cannot be disabled.",
                "status": 400,
            }

        org.update(status="disabled", disabled_at=datetime.utcnow())
        return {"organization": self._serialize(org), "status": 200}

    @requires_super_admin
    def restore_organization(self):
        """Re-enable a disabled org (subject to the capacity cap)."""
        body = request.json or {}
        org_id = body.get("orgId")
        if not org_id:
            return {"message": "orgId required", "status": 400}
        org = Organization.query.get(org_id)
        if not org:
            return {"message": "Organization not found", "status": 404}

        if org.status != "active":
            limit = current_app.config.get("AUTH0_ORG_LIMIT", 10)
            active = Organization.query.filter_by(status="active").count()
            if active >= limit:
                return {
                    "message": (
                        f"Cannot restore: organization limit reached "
                        f"({active}/{limit})."
                    ),
                    "status": 409,
                }

        org.update(status="active", disabled_at=None)
        return {"organization": self._serialize(org), "status": 200}
