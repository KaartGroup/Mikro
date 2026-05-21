"""Logan taxonomy pass 1 — clock-in category cleanup.

Revision ID: e6c4d5b6f7a8
Revises: d5a0b1c2e3f4
Create Date: 2026-05-21

Logan asked for the following updates to the clock-in taxonomy after
the initial subcategory seed went live:

1. Drop the `validating` activity — QC/Validation covers it now. Its
   two subs (Community Project, Kaart Project) are DELETED outright.
2. Drop the `checklist` activity. No seeded subs to relocate.
3. Drop the `community` activity. Its subs (Discussion, Events,
   General) move to live under the `other` activity instead.
4. Add a new sub under `imagery_capture`: "Embedded Imagery
   Collection" (slug `embedded_imagery_collection`).
5. Where both Kaart-named and Community-named subs sit under the same
   activity, reorder so Kaart-named comes first:
     - qc_review: Kaart QC -> sort 10, Community QC -> sort 20.
     - training:  Internal / Kaart -> sort 10, Community -> sort 20.
   Project Creation already has Kaart first (10/20), no change.

Plus a one-off ownership reseed: the d5a0b1c2e3f4 seed stamped every
Kaart-org row with `created_by = 'system:seed-d5a0b1c2e3f4'`. Under
the new team_admin authorship rule (a team_admin can edit subs they
created themselves), nobody can edit the seeded tree. We re-stamp
every seeded row to Logan's user id so he becomes the de-facto owner
and can edit / delete / disable any of them via the admin UI.

Set ``LOGAN_USER_ID`` in the env before running this migration:

    LOGAN_USER_ID="auth0|xxxxxxxxxxxxxxxxxx" flask db upgrade

If the env var isn't set the reseed step is skipped (with a notice),
and the existing seeded rows stay owned by the sentinel — only super
admin and org admin can edit them. Logan stays gated out. You can
run the UPDATE manually any time afterwards.

The renames of `qc_review`'s display label ("QC / Review" -> "QC /
Validation") and the new team_admin permission model are pure code
changes (no DB writes needed). They land in the same commit as this
migration.

Tier-1 activity removal is enforced in code by removing the slugs
from ACTIVITY_SLUGS (clock_in 400s on new attempts). Historical
time_entries with those values are NOT touched — their activity
column keeps its original value and renders via the display map's
retained legacy entries. Anyone looking at a 2026-04 entry with
activity="checklist" still sees it labeled "Checklist".
"""
import os
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e6c4d5b6f7a8"
down_revision = "d5a0b1c2e3f4"
branch_labels = None
depends_on = None


_SEED_SENTINEL = "system:seed-d5a0b1c2e3f4"


def upgrade():
    bind = op.get_bind()

    # 1. DROP all validating subs. Logan said don't move them anywhere
    #    — they're redundant with QC/Validation. ON DELETE SET NULL on
    #    time_entries.subcategory_id means historical entries that
    #    reference these rows null out their FK cleanly; the
    #    subcategory_name snapshot column preserves the original label.
    bind.execute(sa.text("""
        DELETE FROM activity_subcategories
        WHERE activity = 'validating';
    """))

    # 2. MOVE community subs to live under 'other' instead. The slug
    #    uniqueness constraint is (activity, slug, org_id, team_id), so
    #    renaming activity from 'community' to 'other' can only collide
    #    if a sub with the same slug already exists under 'other' in the
    #    same scope. The current 'other' seed only has 'miscellaneous',
    #    so no collision with discussion/events/general.
    bind.execute(sa.text("""
        UPDATE activity_subcategories
        SET activity = 'other'
        WHERE activity = 'community';
    """))

    # 3. ADD "Embedded Imagery Collection" under imagery_capture as a
    #    Kaart-org sub (matches the scope of the seeded tree). Skipped
    #    if AUTH0_ORG_ID isn't set in the env — same fallback as the
    #    seed migration. ON CONFLICT keeps the migration idempotent.
    kaart_org_id = os.environ.get("AUTH0_ORG_ID")
    if kaart_org_id:
        bind.execute(
            sa.text("""
                INSERT INTO activity_subcategories
                    (activity, name, slug, org_id, team_id, is_active, sort_order,
                     requires_project, allow_event_fields, created_by)
                VALUES
                    ('imagery_capture', 'Embedded Imagery Collection',
                     'embedded_imagery_collection', :org_id, NULL, TRUE, 30,
                     FALSE, FALSE, :sentinel)
                ON CONFLICT ON CONSTRAINT uq_activity_subcategories_scope DO NOTHING;
            """),
            {"org_id": kaart_org_id, "sentinel": _SEED_SENTINEL},
        )
    else:
        print(  # noqa: T201 — surfaces in `flask db upgrade` output
            "[e6c4d5b6f7a8] AUTH0_ORG_ID not set; skipping the "
            "'Embedded Imagery Collection' Kaart-org insert. Add it via "
            "the admin UI on this environment if needed."
        )

    # 4. Reorder Kaart-named subs ahead of Community-named ones under
    #    qc_review and training. The slugs are stable so we key on them.
    bind.execute(sa.text("""
        UPDATE activity_subcategories
        SET sort_order = CASE slug
          WHEN 'kaart_qc' THEN 10
          WHEN 'community_qc' THEN 20
        END
        WHERE activity = 'qc_review' AND slug IN ('kaart_qc', 'community_qc');
    """))

    bind.execute(sa.text("""
        UPDATE activity_subcategories
        SET sort_order = CASE slug
          WHEN 'internal_kaart' THEN 10
          WHEN 'community_training' THEN 20
        END
        WHERE activity = 'training' AND slug IN ('internal_kaart', 'community_training');
    """))

    # 5. Reseed `created_by` on every Kaart-tree row to Logan's user id,
    #    so the new team_admin authorship rule lets him edit them. If
    #    LOGAN_USER_ID isn't set we leave the sentinel in place and
    #    only super/org-admin can edit those rows.
    logan_id = os.environ.get("LOGAN_USER_ID")
    if logan_id:
        bind.execute(
            sa.text("""
                UPDATE activity_subcategories
                SET created_by = :logan_id,
                    updated_at = NOW()
                WHERE created_by = :sentinel;
            """),
            {"logan_id": logan_id, "sentinel": _SEED_SENTINEL},
        )
    else:
        print(  # noqa: T201
            "[e6c4d5b6f7a8] LOGAN_USER_ID not set; skipping ownership "
            "reseed on the Kaart-tree subs. Run this manually after "
            "upgrade once you have Logan's auth0 id:\n"
            "  UPDATE activity_subcategories SET created_by = '<logan>' "
            "WHERE created_by = 'system:seed-d5a0b1c2e3f4';"
        )


def downgrade():
    bind = op.get_bind()

    # Ownership reseed reversal — best-effort. Without knowing Logan's
    # id at downgrade time we can't reverse the exact rows, but we can
    # restore the sentinel where created_by matches the LOGAN_USER_ID
    # env var (if set). Otherwise this is a no-op.
    logan_id = os.environ.get("LOGAN_USER_ID")
    if logan_id:
        bind.execute(
            sa.text("""
                UPDATE activity_subcategories
                SET created_by = :sentinel,
                    updated_at = NOW()
                WHERE created_by = :logan_id;
            """),
            {"sentinel": _SEED_SENTINEL, "logan_id": logan_id},
        )

    # Sort-order reversal: restore the original seed values
    # (Community-named first: 10, Kaart-named: 20).
    bind.execute(sa.text("""
        UPDATE activity_subcategories
        SET sort_order = CASE slug
          WHEN 'community_qc' THEN 10
          WHEN 'kaart_qc' THEN 20
        END
        WHERE activity = 'qc_review' AND slug IN ('community_qc', 'kaart_qc');
    """))

    bind.execute(sa.text("""
        UPDATE activity_subcategories
        SET sort_order = CASE slug
          WHEN 'community_training' THEN 10
          WHEN 'internal_kaart' THEN 20
        END
        WHERE activity = 'training' AND slug IN ('community_training', 'internal_kaart');
    """))

    # Drop the Embedded Imagery Collection sub if it exists.
    bind.execute(sa.text("""
        DELETE FROM activity_subcategories
        WHERE activity = 'imagery_capture' AND slug = 'embedded_imagery_collection';
    """))

    # Restore community subs (move them back from 'other' to 'community').
    # We can only safely target the seeded slugs to avoid sweeping up
    # other 'other' subs admins may have added with same slugs (unlikely
    # but defensive).
    bind.execute(sa.text("""
        UPDATE activity_subcategories
        SET activity = 'community'
        WHERE activity = 'other'
          AND slug IN ('discussion', 'events', 'general');
    """))

    # Validating subs are NOT recovered on downgrade — they were
    # DELETEd outright on upgrade. Restoring them would require
    # re-running the seed insert path; document the data loss here
    # rather than silently failing.
    print(  # noqa: T201
        "[e6c4d5b6f7a8 downgrade] Validating subs were DELETEd on "
        "upgrade and are NOT being recovered here. Re-seed via the "
        "admin UI if needed."
    )
