"""Reimbursement-request workflow table (editor -> admin queue).

Revision ID: f7d5e6c7a8b9
Revises: e6c4d5b6f7a8
Create Date: 2026-05-21

Adds the workflow side of the editor-submitted reimbursement flow that
Logan asked for (Trello card PkljPEJx).

Two-table split (deliberate):

  - ``payment_adjustments`` (existing) stays the FINANCIAL record. A row
    here = "this amount applies to a payout". The original schema author
    anticipated this card — that table already carries
    ``source = 'admin_entry' | 'approved_request'`` and a nullable
    ``request_id`` linking back to here.

  - ``reimbursement_requests`` (this migration) is the WORKFLOW record.
    Editors submit -> rows land here as ``pending``. Admin reviews,
    approves -> create a paired ``payment_adjustments`` row and link
    both via ``adjustment_id`` / ``request_id``. Reject -> the request
    stays here as a record; no adjustment is created.

State machine (status column):

    pending --(editor withdraws)--> withdrawn
    pending --(admin approves)----> approved   (paired adjustment created)
    pending --(admin rejects)-----> rejected   (reviewer_note required)

approved/rejected/withdrawn are terminal. To "undo" an approval, admin
soft-deletes the resulting payment_adjustments row via the existing
delete flow; the original request stays in approved state for audit.

Locked design decisions (2026-05-21):

  - The editor's submission form does NOT carry cycle dates. The cycle
    that the eventual payment_adjustments row uses is chosen by the
    admin at approval time. This table therefore has no cycle columns
    at all — they live only on payment_adjustments where they belong.
  - Receipts live in DO Spaces (bucket stays private). ``attachment_url``
    stores the object key, not a signed URL. The Spaces helper signs
    URLs on demand at fetch time.

Additive only. No changes to existing tables. Fully reversible.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f7d5e6c7a8b9"
down_revision = "e6c4d5b6f7a8"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "reimbursement_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        # The editor who submitted. CASCADE deletes the request if the
        # user is hard-deleted; soft-deletes (is_active=false) don't
        # touch this row.
        sa.Column(
            "user_id",
            sa.String(length=255),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Per-org siloing. Captured at submit time from the editor's
        # session (g.user.org_id). The admin queue + pay-visibility
        # filters key on this.
        sa.Column("org_id", sa.String(length=255), nullable=True),
        sa.Column(
            "amount",
            sa.Numeric(10, 2),
            nullable=False,
        ),
        sa.Column("description", sa.Text(), nullable=False),
        # DO Spaces object key (e.g. "reimbursements/<user_id>/<uuid>/<file>").
        # NOT a signed URL — those are issued on demand by the backend.
        sa.Column("attachment_url", sa.String(length=500), nullable=True),
        # Workflow state. See state machine in the module docstring.
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "submitted_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # Admin who acted on the request (approve or reject). Null while
        # still pending or after a self-withdraw.
        sa.Column("reviewed_by", sa.String(length=255), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        # Reason on reject (required by app validation); optional note
        # on approve.
        sa.Column("reviewer_note", sa.Text(), nullable=True),
        # Set on approval. Points at the payment_adjustments row that
        # was created to apply this reimbursement to a payout cycle.
        # ON DELETE SET NULL so admins can soft-delete the adjustment
        # without orphaning the request reference.
        sa.Column(
            "adjustment_id",
            sa.Integer(),
            sa.ForeignKey("payment_adjustments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Amount must be strictly positive — refunds / corrections live
        # on payment_adjustments directly via the admin flow.
        sa.CheckConstraint(
            "amount > 0",
            name="ck_reimbursement_requests_amount_positive",
        ),
    )

    # Admin pending-queue is the hot path: WHERE org_id = ? AND status = ?
    op.create_index(
        "ix_reimbursement_requests_org_status",
        "reimbursement_requests",
        ["org_id", "status"],
    )
    # Editor's own-history view: WHERE user_id = ? ORDER BY submitted_at DESC.
    op.create_index(
        "ix_reimbursement_requests_user_submitted",
        "reimbursement_requests",
        ["user_id", "submitted_at"],
    )
    # Single-column FK indexes (Postgres doesn't auto-create these
    # the way it does for primary keys).
    op.create_index(
        "ix_reimbursement_requests_user_id",
        "reimbursement_requests",
        ["user_id"],
    )
    op.create_index(
        "ix_reimbursement_requests_adjustment_id",
        "reimbursement_requests",
        ["adjustment_id"],
    )


def downgrade():
    op.drop_index(
        "ix_reimbursement_requests_adjustment_id",
        table_name="reimbursement_requests",
    )
    op.drop_index(
        "ix_reimbursement_requests_user_id",
        table_name="reimbursement_requests",
    )
    op.drop_index(
        "ix_reimbursement_requests_user_submitted",
        table_name="reimbursement_requests",
    )
    op.drop_index(
        "ix_reimbursement_requests_org_status",
        table_name="reimbursement_requests",
    )
    op.drop_table("reimbursement_requests")
