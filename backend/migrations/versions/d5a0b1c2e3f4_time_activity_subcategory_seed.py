"""Seed time-tracking activity subcategories.

Revision ID: d5a0b1c2e3f4
Revises: c4f8a9b0d1e2
Create Date: 2026-05-19

Three things, all idempotent (re-runnable safely):

1. Migrate existing ``custom_topics`` rows into ``activity_subcategories``
   as ``activity='other'`` subs, scoped to their original org. Tagged
   with ``created_by = 'system:migrate-from-custom-topics'`` so the
   downgrade can find them.

2. Backfill ``time_entries.subcategory_id`` + ``subcategory_name`` for
   any legacy ``other`` entries whose ``task_name`` matches a migrated
   sub (case-insensitive, same-org).

3. Seed Logan's Kaart-org subcategory tree (the two-tier taxonomy he
   asked for). Tagged with ``created_by = 'system:seed-d5a0b1c2e3f4'``.
   Only runs if ``AUTH0_ORG_ID`` is set in the migration's env — on dev
   without that var the seed is skipped and admins can add subs via the
   Time Categories admin page.

The ``custom_topics`` table is **not** dropped here — a follow-up
migration handles that once we're confident in the backfill. Keeps
rollback trivial.
"""
import os
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d5a0b1c2e3f4"
down_revision = "c4f8a9b0d1e2"
branch_labels = None
depends_on = None


# Sentinels so the downgrade can target exactly what this migration
# inserted (vs. anything admins later add via the UI).
_SENTINEL_CT_MIGRATE = "system:migrate-from-custom-topics"
_SENTINEL_KAART_SEED = "system:seed-d5a0b1c2e3f4"


# Logan's Kaart tree.
# Tuple: (activity, name, slug, requires_project, allow_event_fields, sort_order)
# Slugs are snake_case. Uniqueness is per (activity, scope) so the same
# slug may legitimately exist under multiple activities — we still keep
# them distinct here for readability.
#
# `requires_project` defaults: subs that explicitly name a Kaart-tracked
# project type require the project picker. `Editing -> project` is
# explicitly project-bound. (Best-judgement defaults; confirm with Logan
# at plan review.)
#
# `allow_event_fields` defaults: only `Community -> Events`, strict to
# the original spec.
_KAART_TREE = [
    # Community
    ("community", "Discussion", "discussion", False, False, 10),
    ("community", "Events", "events", False, True, 20),
    ("community", "General", "general", False, False, 30),
    # Project Creation
    ("project_creation", "Kaart Project", "kaart_project", True, False, 10),
    ("project_creation", "Community Project", "community_project", False, False, 20),
    # Imagery Capture
    ("imagery_capture", "General Imagery Collection", "general_imagery_collection", False, False, 10),
    ("imagery_capture", "Narrow Road Imagery Collection", "narrow_road_imagery_collection", False, False, 20),
    # Documentation
    ("documentation", "Project Workflow Documentation", "project_workflow_documentation", False, False, 10),
    ("documentation", "Wiki Documentation", "wiki_documentation", False, False, 20),
    # Meeting
    ("meeting", "Community", "community_meeting", False, False, 10),
    ("meeting", "Internal Team Members", "internal_team_members", False, False, 20),
    # QC Review (display label remains "QC / Review")
    ("qc_review", "Community QC", "community_qc", False, False, 10),
    ("qc_review", "Kaart QC", "kaart_qc", True, False, 20),
    # Training
    ("training", "Community", "community_training", False, False, 10),
    ("training", "Internal / Kaart", "internal_kaart", False, False, 20),
    # Validating
    ("validating", "Community Project", "community_project_validating", False, False, 10),
    ("validating", "Kaart Project", "kaart_project_validating", True, False, 20),
    # Editing
    ("editing", "project", "project", True, False, 10),
    # Other
    ("other", "Miscellaneous", "miscellaneous", False, False, 10),
]


def upgrade():
    bind = op.get_bind()

    # ── 1. Migrate custom_topics -> activity_subcategories ──
    # Each row becomes an 'other' subcategory scoped to its original
    # org. Slugify the name (lowercase, non-alnum -> underscore).
    # ON CONFLICT keeps the migration idempotent on a re-run.
    bind.execute(sa.text("""
        INSERT INTO activity_subcategories
            (activity, name, slug, org_id, team_id, is_active, sort_order,
             requires_project, allow_event_fields, created_by, created_at, updated_at)
        SELECT
            'other'                                                            AS activity,
            ct.name                                                            AS name,
            LOWER(REGEXP_REPLACE(TRIM(ct.name), '[^a-zA-Z0-9]+', '_', 'g'))    AS slug,
            ct.org_id                                                          AS org_id,
            NULL                                                               AS team_id,
            TRUE                                                               AS is_active,
            0                                                                  AS sort_order,
            FALSE                                                              AS requires_project,
            FALSE                                                              AS allow_event_fields,
            :ct_sentinel                                                       AS created_by,
            COALESCE(ct.created_at, NOW())                                     AS created_at,
            COALESCE(ct.created_at, NOW())                                     AS updated_at
        FROM custom_topics ct
        ON CONFLICT ON CONSTRAINT uq_activity_subcategories_scope DO NOTHING;
    """), {"ct_sentinel": _SENTINEL_CT_MIGRATE})

    # ── 2. Backfill time_entries.subcategory_id / subcategory_name ──
    # For legacy 'other' entries whose task_name matches a migrated sub
    # in the same org. Case-insensitive name match. `IS NOT DISTINCT
    # FROM` so NULL org on either side compares equal (legacy entries
    # from before org_id existed will match global subs).
    bind.execute(sa.text("""
        UPDATE time_entries te
        SET subcategory_id = s.id,
            subcategory_name = s.name
        FROM activity_subcategories s
        WHERE te.activity = 'other'
          AND te.subcategory_id IS NULL
          AND te.task_name IS NOT NULL
          AND s.activity = 'other'
          AND LOWER(TRIM(s.name)) = LOWER(TRIM(te.task_name))
          AND (s.org_id IS NOT DISTINCT FROM te.org_id);
    """))

    # ── 3. Seed Logan's Kaart-org tree ──
    kaart_org_id = os.environ.get("AUTH0_ORG_ID")
    if not kaart_org_id:
        # No env var (typical on local dev). Skip the seed; admins can
        # add subs via the Time Categories admin page on this DB.
        print(  # noqa: T201 — surfaces in `flask db upgrade` output
            "[d5a0b1c2e3f4 seed] AUTH0_ORG_ID not set; skipping Kaart-org "
            "subcategory seed. Add subs via the admin UI."
        )
        return

    rows = [
        {
            "activity": activity,
            "name": name,
            "slug": slug,
            "org_id": kaart_org_id,
            "team_id": None,
            "is_active": True,
            "sort_order": sort_order,
            "requires_project": requires_project,
            "allow_event_fields": allow_event_fields,
            "created_by": _SENTINEL_KAART_SEED,
        }
        for activity, name, slug, requires_project, allow_event_fields, sort_order
        in _KAART_TREE
    ]
    bind.execute(
        sa.text("""
            INSERT INTO activity_subcategories
                (activity, name, slug, org_id, team_id, is_active, sort_order,
                 requires_project, allow_event_fields, created_by)
            VALUES
                (:activity, :name, :slug, :org_id, :team_id, :is_active,
                 :sort_order, :requires_project, :allow_event_fields, :created_by)
            ON CONFLICT ON CONSTRAINT uq_activity_subcategories_scope DO NOTHING;
        """),
        rows,
    )


def downgrade():
    bind = op.get_bind()
    # Delete only the rows this migration inserted (matched via the
    # sentinel created_by). The FK on time_entries.subcategory_id is
    # ON DELETE SET NULL, so dangling pointers null out automatically;
    # the subcategory_name snapshot column stays (and gets dropped
    # entirely by c4f8a9b0d1e2's downgrade if we're rolling all the
    # way back).
    bind.execute(
        sa.text("""
            DELETE FROM activity_subcategories
            WHERE created_by IN (:ct_sentinel, :kaart_sentinel);
        """),
        {
            "ct_sentinel": _SENTINEL_CT_MIGRATE,
            "kaart_sentinel": _SENTINEL_KAART_SEED,
        },
    )
