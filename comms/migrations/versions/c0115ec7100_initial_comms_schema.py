"""initial comms schema

Creates the three comms tables — identities, notifications, email_campaigns —
and the two composite notification indexes. This is the ROOT of comms' own
migration chain (down_revision = None), independent of Mikro's backend chain.

Deliberately NO foreign keys: the service is app-agnostic and keyed solely on
the Auth0 `sub`.

Revision ID: c0115ec7100
Revises:
Create Date: 2026-06-04

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "c0115ec7100"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # ── identities ────────────────────────────────────────────────
    op.create_table(
        "identities",
        sa.Column("sub", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("org_id", sa.String(length=255), nullable=True),
        sa.Column(
            "role",
            sa.String(length=50),
            server_default="user",
            nullable=False,
        ),
        sa.Column("last_seen_app", sa.String(length=50), nullable=True),
        sa.Column(
            "notify_entry_adjusted",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "notify_entry_force_closed",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "notify_adjustment_requested",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "notify_assigned_to_project",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "notify_payment_sent",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "notify_bank_info_changed",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "notify_announcement",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "notify_message_received",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("sub"),
    )
    op.create_index(op.f("ix_identities_email"), "identities", ["email"], unique=False)
    op.create_index(
        op.f("ix_identities_org_id"), "identities", ["org_id"], unique=False
    )

    # ── notifications ─────────────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("user_id", sa.String(length=255), nullable=False),
        sa.Column("org_id", sa.String(length=255), nullable=False),
        sa.Column("actor_id", sa.String(length=255), nullable=True),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("link", sa.String(length=255), nullable=True),
        sa.Column("entity_type", sa.String(length=50), nullable=True),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column(
            "is_read",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_notifications_user_id"),
        "notifications",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_notifications_org_id"),
        "notifications",
        ["org_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_notifications_type"), "notifications", ["type"], unique=False
    )
    op.create_index(
        op.f("ix_notifications_created_at"),
        "notifications",
        ["created_at"],
        unique=False,
    )
    # Composite indexes from Notification.__table_args__.
    op.create_index(
        "ix_notifications_user_unread",
        "notifications",
        ["user_id", "is_read"],
        unique=False,
    )
    op.create_index(
        "ix_notifications_user_created",
        "notifications",
        ["user_id", "created_at"],
        unique=False,
    )

    # ── email_campaigns ───────────────────────────────────────────
    op.create_table(
        "email_campaigns",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("org_id", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("body_html", sa.Text(), nullable=False),
        sa.Column("sent_by", sa.String(length=255), nullable=False),
        sa.Column("audience", sa.String(length=50), nullable=False),
        sa.Column(
            "is_forced",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("recipient_count", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_email_campaigns_org_id"),
        "email_campaigns",
        ["org_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(op.f("ix_email_campaigns_org_id"), table_name="email_campaigns")
    op.drop_table("email_campaigns")

    op.drop_index("ix_notifications_user_created", table_name="notifications")
    op.drop_index("ix_notifications_user_unread", table_name="notifications")
    op.drop_index(op.f("ix_notifications_created_at"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_type"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_org_id"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_user_id"), table_name="notifications")
    op.drop_table("notifications")

    op.drop_index(op.f("ix_identities_org_id"), table_name="identities")
    op.drop_index(op.f("ix_identities_email"), table_name="identities")
    op.drop_table("identities")
