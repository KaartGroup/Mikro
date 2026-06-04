"""Organization table — SSOT for provisioned tenant orgs (super_admin mgmt).

Revision ID: f8e1d2c3b4a5
Revises: f7d5e6c7a8b9
Create Date: 2026-06-04

Phase A of `external-org-management-plan.md`. Adds the ``organizations`` table:
the single source of truth for which Auth0 Organizations exist in Mikro and
whether they may log in. The PK is the Auth0 org id (mirrors ``User.org_id``).

"Delete" is a soft state (``status='disabled'``), never a row removal, so a
super_admin can restore a disabled org and the data/audit trail survives.

Additive only — no changes to existing tables; fully reversible.

Seeds one row for the existing Kaart org from ``AUTH0_ORG_ID`` when that env
var is present (skipped on local/dev where it isn't set), so production carries
a consistent record from day one. The seed is idempotent (ON CONFLICT DO
NOTHING) and the org id is format-validated before interpolation.
"""

import os
import re

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "f8e1d2c3b4a5"
down_revision = "f7d5e6c7a8b9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "organizations",
        sa.Column("id", sa.String(length=255), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False, unique=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        # active | disabled. 'disabled' blocks login but retains all data.
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="active",
        ),
        sa.Column("created_by_user_id", sa.String(length=255), nullable=True),
        sa.Column("contact_name", sa.String(length=255), nullable=True),
        sa.Column("contact_email", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        # Reserved for future per-org branding (JSON blob as text).
        sa.Column("branding", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=True,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=True,
            server_default=sa.func.now(),
        ),
        sa.Column("disabled_at", sa.DateTime(), nullable=True),
    )
    # Admin list + the future login-validation lookup both filter on status.
    op.create_index("ix_organizations_status", "organizations", ["status"])

    # Seed the existing Kaart org so prod has a record from day one.
    kaart_org_id = os.environ.get("AUTH0_ORG_ID")
    if kaart_org_id and re.fullmatch(r"[A-Za-z0-9_-]+", kaart_org_id):
        op.execute(f"""
            INSERT INTO organizations (id, name, display_name, status)
            VALUES ('{kaart_org_id}', 'kaart', 'Kaart', 'active')
            ON CONFLICT (id) DO NOTHING
            """)
    elif kaart_org_id:
        print(
            "[f8e1d2c3b4a5] AUTH0_ORG_ID has an unexpected format; "
            "skipping Kaart-org seed."
        )
    else:
        print("[f8e1d2c3b4a5] AUTH0_ORG_ID not set; skipping Kaart-org seed.")


def downgrade():
    op.drop_index("ix_organizations_status", table_name="organizations")
    op.drop_table("organizations")
