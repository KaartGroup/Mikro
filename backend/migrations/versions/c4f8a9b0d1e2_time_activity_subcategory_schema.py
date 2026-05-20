"""Time-tracking activity / subcategory schema.

Revision ID: c4f8a9b0d1e2
Revises: 2966333a6cfa
Create Date: 2026-05-19

NOTE on chain ordering — REBASE GATE:
This migration is being developed in parallel with the payments-page-v1
branch (head b3d7e2f4a1c8). `down_revision` was set to the current master
head (2966333a6cfa) so this branch could be developed off `master`. At
merge time, if the payments chain has already landed on master, re-root
`down_revision` -> the then-current master head (likely b3d7e2f4a1c8)
before running `flask db upgrade` on prod. Re-run the rule #12 chain
check after that change.

This migration is ADDITIVE / SCHEMA-only. The companion seed migration
d5a0b1c2e3f4 sits behind it.

Two-tier model
==============

- **Activity (tier 1)**: the existing `time_entries.category` column,
  renamed to `time_entries.activity`. The set of activity slugs stays a
  hardcoded app-side enum (pan-org primitives — Editing, Validating, QC
  / Review, Meeting, Training, Community, Documentation, Imagery
  Capture, Project Creation, Other).

- **Subcategory (tier 2)**: rows in the new `activity_subcategories`
  table, scoped global / org / team via `(org_id, team_id)`. Time entries
  snapshot the chosen subcategory's display name at write time
  (`subcategory_name`) so renames/soft-deletes never fragment historical
  reports.

Plus two integer columns on `time_entries` for event-attendance counts
(`retained_participants`, `new_participants`), exposed in the UI only
when the chosen subcategory has `allow_event_fields=true`.

Legacy rows (NULL subcategory_id) remain valid and are displayed as
"—" in tables and aggregated under an "Unspecified" bucket in reports.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c4f8a9b0d1e2"
# Re-rooted after master rebase: payments-v2 (b3d7e2f4a1c8) landed on
# master first, so this migration's parent moves from 2966333a6cfa
# (the prior master head) to b3d7e2f4a1c8 (the new one). Single linear
# alembic chain after this change — verify with rule #12 check below.
down_revision = "b3d7e2f4a1c8"
branch_labels = None
depends_on = None


def upgrade():
    # ── activity_subcategories table ─────────────────────────────
    op.create_table(
        "activity_subcategories",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        # Parent activity slug. Matches the hardcoded app-side enum.
        sa.Column("activity", sa.String(length=50), nullable=False),
        # Display label shown in dropdowns and snapshotted onto time_entries.
        sa.Column("name", sa.String(length=100), nullable=False),
        # Stable internal slug; derived from name on create, never edited.
        sa.Column("slug", sa.String(length=100), nullable=False),
        # NULL -> visible to every org (global).
        sa.Column("org_id", sa.String(length=255), nullable=True),
        # NULL -> not team-scoped. When set, the row is visible only to
        # members of that team plus org_admin+ in the same org.
        sa.Column("team_id", sa.Integer(), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "requires_project",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "allow_event_fields",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("created_by", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # team_id implies org_id (a team always belongs to an org).
        sa.CheckConstraint(
            "team_id IS NULL OR org_id IS NOT NULL",
            name="ck_activity_subcategories_team_requires_org",
        ),
        # Same (activity, slug) can exist at different scopes.
        sa.UniqueConstraint(
            "activity", "slug", "org_id", "team_id",
            name="uq_activity_subcategories_scope",
        ),
        # FK to teams; on team delete, NULL the link (we soft-disable subs
        # via is_active rather than hard-deleting, so this should rarely
        # actually fire — but the column is FK-safe either way).
        sa.ForeignKeyConstraint(
            ["team_id"], ["teams.id"], ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_activity_subcategories_dropdown",
        "activity_subcategories",
        ["activity", "is_active"],
    )
    op.create_index(
        "ix_activity_subcategories_org",
        "activity_subcategories",
        ["org_id"],
    )
    op.create_index(
        "ix_activity_subcategories_team",
        "activity_subcategories",
        ["team_id"],
    )

    # ── time_entries: rename category -> activity, add tier-2 cols ──
    # Postgres ALTER TABLE ... RENAME COLUMN is metadata-only and fast,
    # no row rewrite. Existing rows keep their value (now under the new
    # column name); existing app code referring to `category` will be
    # updated in the same commit cycle.
    op.alter_column(
        "time_entries",
        "category",
        new_column_name="activity",
        existing_type=sa.String(length=50),
        existing_nullable=False,
    )
    op.add_column(
        "time_entries",
        sa.Column("subcategory_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_time_entries_subcategory",
        "time_entries", "activity_subcategories",
        ["subcategory_id"], ["id"],
        ondelete="SET NULL",
    )
    # Snapshot of the subcategory name at write-time. Reports/tables read
    # this, NOT a join — renames + soft-deletes never fragment history.
    op.add_column(
        "time_entries",
        sa.Column("subcategory_name", sa.String(length=100), nullable=True),
    )
    # Event-attendance fields; populated only when the chosen subcategory
    # has allow_event_fields=true. Otherwise NULL.
    op.add_column(
        "time_entries",
        sa.Column("retained_participants", sa.Integer(), nullable=True),
    )
    op.add_column(
        "time_entries",
        sa.Column("new_participants", sa.Integer(), nullable=True),
    )
    # Aggregation index for the timekeeping report's new GROUP BY.
    op.create_index(
        "ix_time_entries_org_activity_sub",
        "time_entries",
        ["org_id", "activity", "subcategory_name"],
    )


def downgrade():
    # time_entries reversal — drop new columns and revert rename.
    op.drop_index("ix_time_entries_org_activity_sub", table_name="time_entries")
    op.drop_column("time_entries", "new_participants")
    op.drop_column("time_entries", "retained_participants")
    op.drop_column("time_entries", "subcategory_name")
    op.drop_constraint("fk_time_entries_subcategory", "time_entries", type_="foreignkey")
    op.drop_column("time_entries", "subcategory_id")
    op.alter_column(
        "time_entries",
        "activity",
        new_column_name="category",
        existing_type=sa.String(length=50),
        existing_nullable=False,
    )

    # activity_subcategories reversal — drop indexes then table.
    op.drop_index("ix_activity_subcategories_team", table_name="activity_subcategories")
    op.drop_index("ix_activity_subcategories_org", table_name="activity_subcategories")
    op.drop_index("ix_activity_subcategories_dropdown", table_name="activity_subcategories")
    op.drop_table("activity_subcategories")
