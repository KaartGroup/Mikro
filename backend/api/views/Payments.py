#!/usr/bin/env python3
"""
Payments page v1 API endpoints for Mikro.

End-of-month payroll workspace for org admins: cycle selector, per-
contributor payments table, adjustments, status state machine,
contributor drill-in, CSV export. Hourly-contractor scope only for v1
(see Trello DWAbQFlL and .claude/payments-page-v1-plan.md).

Routes mounted under ``/api/payments/`` in ``app.py``.
"""

import csv
import io
import re
import uuid
from datetime import date, datetime
from decimal import Decimal

import boto3
from flask import Response, current_app, g, request
from flask.views import MethodView
from sqlalchemy import cast, func, Date as SqlDate

from ..auth import (
    can_view_pay_for,
    is_org_admin_or_above,
    managed_team_ids_for,
    team_member_ids_for,
)
from ..database import (
    PaymentAdjustment,
    PaymentCycleStatus,
    Payments,
    PayrollConfig,
    Project,
    ProjectTeam,
    ReimbursementRequest,
    TimeEntry,
    User,
    db,
)
from ..filters import resolve_filtered_user_ids
from ..payroll_periods import generate_cycles
from ..utils import requires_admin, requires_team_admin_or_above


# ─── DO Spaces helpers (receipt uploads / fetches) ──────────────────
#
# Issues short-lived signed URLs for editor receipt uploads and admin
# receipt views. The bucket stays private at the DO Spaces ACL level —
# every read is mediated by a backend permission check (see
# _can_view_receipt below) followed by a fresh GET URL signed for that
# one viewer.
#
# Receipts whitelist:
#   image/jpeg, image/png, image/heic, application/pdf
#   max 10 MB
# Both checks are enforced at presign time (we refuse to issue a URL
# for non-conforming uploads).


_RECEIPT_ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/heic",
    "application/pdf",
}
_RECEIPT_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_RECEIPT_URL_EXPIRES_S = 300  # 5 minutes


def _spaces_client():
    """boto3 S3 client for DO Spaces."""
    return boto3.client(
        "s3",
        endpoint_url=current_app.config.get("DO_SPACES_ENDPOINT"),
        aws_access_key_id=current_app.config.get("DO_SPACES_KEY"),
        aws_secret_access_key=current_app.config.get("DO_SPACES_SECRET"),
        region_name=current_app.config.get("DO_SPACES_REGION"),
    )


_FILENAME_SAFE_RE = re.compile(r"[^a-zA-Z0-9._-]+")


def _safe_filename(name):
    """Sanitize a user-supplied filename for use in an object key.

    Keep just a tail (extension preservation) — receipts don't need
    the original name surfaced anywhere except admin view, where the
    backend can derive a display name.
    """
    if not name:
        return "receipt"
    cleaned = _FILENAME_SAFE_RE.sub("_", name).strip("._-")
    return cleaned[-80:] or "receipt"


def _receipt_object_key(user_id, filename):
    """Compose the Spaces object key for a reimbursement receipt.

    Shape: ``reimbursements/<user_id>/<uuid4>/<safe-filename>``. The
    UUID prefix guarantees uniqueness even if the editor uploads two
    receipts named the same thing, and lets us regenerate the URL
    without worrying about collisions.
    """
    return f"reimbursements/{user_id}/{uuid.uuid4()}/{_safe_filename(filename)}"


def _presigned_put_url(key, content_type, max_bytes=_RECEIPT_MAX_BYTES):
    """Short-lived presigned PUT URL for a single-file upload.

    The browser uses this to upload the receipt directly to Spaces
    without proxying the bytes through Flask. ``ContentLength`` here
    constrains the PUT — Spaces refuses an upload bigger than this.
    """
    bucket = current_app.config.get("DO_SPACES_BUCKET")
    if not bucket:
        raise RuntimeError("DO_SPACES_BUCKET not configured")
    s3 = _spaces_client()
    return s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": bucket,
            "Key": key,
            "ContentType": content_type,
            "ContentLength": max_bytes,
            "ACL": "private",
        },
        ExpiresIn=_RECEIPT_URL_EXPIRES_S,
        HttpMethod="PUT",
    )


def _presigned_get_url(key):
    """Short-lived presigned GET URL so an authorized viewer can fetch
    a receipt straight from Spaces (image rendering / PDF download).
    """
    bucket = current_app.config.get("DO_SPACES_BUCKET")
    if not bucket:
        raise RuntimeError("DO_SPACES_BUCKET not configured")
    s3 = _spaces_client()
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=_RECEIPT_URL_EXPIRES_S,
        HttpMethod="GET",
    )


# Status state machine for the cycle row pill
STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_HELD = "held"
STATUS_PAID = "paid"
VALID_STATUSES = {STATUS_PENDING, STATUS_APPROVED, STATUS_HELD, STATUS_PAID}


def _parse_iso_date(raw):
    """Parse an ISO date (YYYY-MM-DD) from a request payload. Returns None on bad input."""
    if not raw:
        return None
    try:
        if isinstance(raw, date) and not isinstance(raw, datetime):
            return raw
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _scoped_user_ids(viewer):
    """Resolve the user-id set the viewer is allowed to see on the Payments page.

    - super_admin / admin: all users in their org → return ``None`` (no filter).
    - team_admin: union of members across managed teams (set of ids).
    - anyone else: empty set (route gate blocks them anyway).
    """
    if is_org_admin_or_above(viewer):
        return None
    if getattr(viewer, "role", None) == "team_admin":
        return team_member_ids_for(managed_team_ids_for(viewer))
    return set()


def _candidate_user_ids(viewer, filters):
    """Viewer's team/role scope INTERSECTED with the universal ``filters`` body.

    Mirrors the Users/Projects standard-filter system: ``filters`` is the
    same dict shape ({region, country, team, role, timezone, ...}) resolved
    by ``resolve_filtered_user_ids``.

    Returns:
    - ``None``  → no constraint (org-admin+ AND no filters): all org users.
    - ``set()`` → nothing matches: caller short-circuits to no rows.
    - ``set``   → the allowed user-id set.

    The team-scope ceiling is never *widened* by the master filter — a
    filter can only narrow within what the viewer may already see, so the
    page-level filter and the team scope can never conflict.
    """
    scoped = _scoped_user_ids(viewer)  # None | set | set()
    resolved = resolve_filtered_user_ids(filters, viewer.org_id)  # None | list
    if resolved is None:
        return scoped
    resolved = set(resolved)
    if scoped is None:
        return resolved
    return scoped & resolved


def _hours_by_user(user_ids, cycle_start, cycle_end):
    """Aggregate completed-session seconds per user inside the cycle window.

    Rules (per plan §2.2 / §10 risks):
    - Only ``status = 'completed'`` time_entries (skip active + voided)
    - ``clock_out`` must fall within [cycle_start, cycle_end] inclusive
    - Cross-midnight sessions count toward the day on which they ended;
      matches Aaron's existing Chrono Cards process

    ``user_ids`` is either an iterable of ids (filter to that set) or
    ``None`` (no per-user filter — caller has already org-scoped).
    """
    q = (
        db.session.query(
            TimeEntry.user_id,
            func.coalesce(func.sum(TimeEntry.duration_seconds), 0).label("seconds"),
        )
        .filter(TimeEntry.status == "completed")
        .filter(TimeEntry.clock_out.isnot(None))
        .filter(cast(TimeEntry.clock_out, SqlDate) >= cycle_start)
        .filter(cast(TimeEntry.clock_out, SqlDate) <= cycle_end)
    )
    if user_ids is not None:
        ids = list(user_ids)
        if not ids:
            return {}
        q = q.filter(TimeEntry.user_id.in_(ids))
    return {row.user_id: int(row.seconds or 0) for row in q.group_by(TimeEntry.user_id).all()}


def _adjustments_by_user(user_ids, cycle_start, cycle_end):
    """Sum non-deleted adjustments per user for the cycle.

    Returns ``{user_id: {"total": Decimal, "count": int}}``.
    """
    q = (
        db.session.query(
            PaymentAdjustment.user_id,
            func.coalesce(func.sum(PaymentAdjustment.amount), 0).label("total"),
            func.count(PaymentAdjustment.id).label("count"),
        )
        .filter(PaymentAdjustment.is_deleted.is_(False))
        .filter(PaymentAdjustment.cycle_start == cycle_start)
        .filter(PaymentAdjustment.cycle_end == cycle_end)
    )
    if user_ids is not None:
        ids = list(user_ids)
        if not ids:
            return {}
        q = q.filter(PaymentAdjustment.user_id.in_(ids))
    out = {}
    for row in q.group_by(PaymentAdjustment.user_id).all():
        out[row.user_id] = {
            "total": Decimal(row.total or 0),
            "count": int(row.count or 0),
        }
    return out


def _status_by_user(user_ids, cycle_start, cycle_end):
    """Return ``{user_id: PaymentCycleStatus}`` for a cycle.

    Missing rows are treated as ``pending`` by the caller.
    """
    q = PaymentCycleStatus.query.filter(
        PaymentCycleStatus.cycle_start == cycle_start,
        PaymentCycleStatus.cycle_end == cycle_end,
    )
    if user_ids is not None:
        ids = list(user_ids)
        if not ids:
            return {}
        q = q.filter(PaymentCycleStatus.user_id.in_(ids))
    return {row.user_id: row for row in q.all()}


def _user_display_name(user):
    return (
        f"{user.first_name or ''} {user.last_name or ''}".strip()
        or user.email
        or user.id
    )


def _decimal(value):
    """Render a Decimal/float as a plain float for JSON; None stays None."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


VALID_COMP_MODELS = {
    "per_task",
    "hourly",
    "salaried",
    "project_based",
    "hybrid",
}


def _effective_comp_model(user):
    """Resolve a user's effective compensation model (SSOT).

    NULL/unknown ``compensation_model`` is treated as legacy: hourly when
    an ``hourly_rate`` is set, otherwise per_task (the core micropayment
    flow). Explicit values pass through.
    """
    m = getattr(user, "compensation_model", None)
    if m in VALID_COMP_MODELS:
        return m
    return "hourly" if getattr(user, "hourly_rate", None) is not None else "per_task"


def _prorated_salary(user, cycle_start, cycle_end):
    """Monthly salary prorated to the cycle window.

    v1 rule: salary × (days in [cycle_start, cycle_end] inclusive) /
    (days in cycle_start's calendar month). Good enough for monthly and
    near-monthly cycles; refine when semi-/bi-weekly cadence math lands.
    """
    sal = getattr(user, "monthly_salary", None)
    if sal is None:
        return 0.0
    sal = float(sal)
    cycle_days = (cycle_end - cycle_start).days + 1
    if cycle_start.month == 12:
        nxt = date(cycle_start.year + 1, 1, 1)
    else:
        nxt = date(cycle_start.year, cycle_start.month + 1, 1)
    month_first = date(cycle_start.year, cycle_start.month, 1)
    days_in_month = (nxt - month_first).days
    if days_in_month <= 0:
        return round(sal, 2)
    return round(sal * (cycle_days / days_in_month), 2)


def _compute_payable(user, seconds, adj_total, cycle_start, cycle_end):
    """Per-model base + total. Single source of truth used by the table,
    KPIs, contributor detail, and CSV export so they always agree.

    Returns ``(model, base, total)`` where total = base + adj_total.
    - hourly:        hours × hourly_rate
    - salaried:      monthly_salary prorated to the cycle
    - per_task:      current unpaid micropayment balance (payable_total).
                     Implemented (never skipped) but default-filtered off
                     this page — results-based billing may be revisited.
    - project_based: SCAFFOLD — adjustments only (base 0). Payout math
                     pending Logan's milestone/bonus definition.
    - hybrid:        SCAFFOLD — base = hourly (or prorated salary if no
                     rate) + adjustments overlay. Incentive/QA layer
                     pending Logan's definition.
    """
    hours = seconds / 3600.0 if seconds else 0.0
    rate = float(user.hourly_rate) if user.hourly_rate is not None else None
    model = _effective_comp_model(user)

    if model == "salaried":
        base = _prorated_salary(user, cycle_start, cycle_end)
    elif model == "per_task":
        base = float(getattr(user, "payable_total", 0) or 0)
    elif model == "project_based":
        base = 0.0  # scaffold: payout = adjustments only (definition pending)
    elif model == "hybrid":
        base = (
            round(hours * rate, 2)
            if rate is not None
            else _prorated_salary(user, cycle_start, cycle_end)
        )
    else:  # hourly (and legacy resolved to hourly)
        base = round(hours * rate, 2) if rate is not None else 0.0

    total = round(base + (adj_total or 0.0), 2)
    return model, round(base, 2), total


def _comp_filter_from_body(body):
    """Extract the `compensation` master-filter values from a request body.

    Returns a set of requested models, or ``None`` when the caller did not
    filter by compensation (the default).
    """
    filters = (body or {}).get("filters") or {}
    raw = filters.get("compensation")
    if not raw:
        return None
    if isinstance(raw, str):
        raw = [raw]
    return {str(v) for v in raw if v}


def _passes_comp_filter(model, comp_filter):
    """Cohort rule for the payments page.

    - Explicit ``compensation`` filter → include iff the user's model is in
      it (this is the ONLY way per_task users surface — re-enabling
      results-based billing is a filter default flip, no rework).
    - No filter → default-exclude per_task; include everything else.
    """
    if comp_filter is not None:
        return model in comp_filter
    return model != "per_task"


def _cycle_label(start, end, cadence):
    """Human label for a forecast cycle bar."""
    if cadence == "monthly":
        return start.strftime("%b %Y")
    if cadence == "semi_monthly":
        return f"{start.strftime('%b')} {start.day}–{end.day}"
    return f"{start.strftime('%b %d')}–{end.strftime('%d')}"


def _confirmed_for_user(u, s, e):
    """Deterministic (hours-independent) pay for a user in [s, e].

    Mirrors `_compute_payable`'s salaried/hybrid branches: salaried is
    fully prorated salary; hybrid with no hourly_rate falls back to
    prorated salary (deterministic); everything else's pay depends on
    hours/adjustments and is therefore NOT a confirmed commitment.
    """
    m = _effective_comp_model(u)
    if m == "salaried":
        return _prorated_salary(u, s, e)
    if m == "hybrid" and u.hourly_rate is None:
        return _prorated_salary(u, s, e)
    return 0.0


def _build_row(user, seconds, adj, status_row, cycle_start, cycle_end):
    """Compose a single PaymentCycleRow dict for the table."""
    hours = round(seconds / 3600.0, 2) if seconds else 0.0
    rate = float(user.hourly_rate) if user.hourly_rate is not None else None
    adj_total = float(adj["total"]) if adj else 0.0
    adj_count = adj["count"] if adj else 0
    model, base, total = _compute_payable(
        user, seconds, adj_total, cycle_start, cycle_end
    )
    # calculated_wage keeps its hourly meaning for hourly/hybrid rows;
    # for salaried/project_based it carries the model's base amount.
    wage = base if model in ("hourly", "hybrid") and rate is not None else (
        base if model in ("salaried", "per_task", "project_based") else None
    )
    return {
        "user_id": user.id,
        "name": _user_display_name(user),
        "first_name": user.first_name or "",
        "last_name": user.last_name or "",
        "email": user.email,
        "payment_email": user.payment_email,
        "osm_username": user.osm_username,
        "hours": hours,
        "seconds": seconds,
        "hourly_rate": rate,
        "compensation_model": model,
        "monthly_salary": (
            float(user.monthly_salary)
            if getattr(user, "monthly_salary", None) is not None
            else None
        ),
        "calculated_wage": wage,
        "adjustments_total": round(adj_total, 2),
        "adjustments_count": adj_count,
        "total_payable": round(total, 2),
        "status": status_row.status if status_row else STATUS_PENDING,
        "status_note": status_row.note if status_row else None,
        "status_actor_id": status_row.actor_id if status_row else None,
        "status_updated_at": (
            status_row.updated_at.isoformat() if status_row and status_row.updated_at else None
        ),
    }


class PaymentsAPI(MethodView):
    """Payments v1 endpoints."""

    def post(self, path: str):
        if path == "cycle":
            return self.fetch_cycle()
        elif path == "cycle/kpis":
            return self.fetch_cycle_kpis()
        elif path == "contributor":
            return self.fetch_contributor()
        elif path == "adjustment/create":
            return self.create_adjustment()
        elif path == "adjustment/delete":
            return self.delete_adjustment()
        elif path == "status/set":
            return self.set_status()
        elif path == "cycle/export":
            return self.export_cycle()
        elif path == "forecast":
            return self.fetch_forecast()
        elif path == "project-dispensation":
            return self.fetch_project_dispensation()
        elif path == "config/fetch":
            return self.fetch_payroll_config()
        elif path == "config":
            return self.save_payroll_config()
        # ─── reimbursement workflow (Trello PkljPEJx) ────────────────
        elif path == "reimbursement/submit":
            return self.reimbursement_submit()
        elif path == "reimbursement/my":
            return self.reimbursement_my()
        elif path == "reimbursement/withdraw":
            return self.reimbursement_withdraw()
        elif path == "reimbursement/upload-url":
            return self.reimbursement_upload_url()
        elif path == "reimbursement/pending":
            return self.reimbursement_pending()
        elif path == "reimbursement/approve":
            return self.reimbursement_approve()
        elif path == "reimbursement/reject":
            return self.reimbursement_reject()
        elif path == "reimbursement/attachment-url":
            return self.reimbursement_attachment_url()
        return {"message": f"Unknown payments path: {path}", "status": 404}, 404

    # ────────────────────────── cycle table ──────────────────────────

    @requires_team_admin_or_above
    def fetch_cycle(self):
        """Return per-contributor rows for the given cycle range.

        Defaults to non-zero hours only (Logan's 2026-05-12 decision).
        Pass ``include_zero_hours: true`` to show every hourly contractor
        regardless of activity in the period.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        cycle_start = _parse_iso_date(body.get("cycle_start"))
        cycle_end = _parse_iso_date(body.get("cycle_end"))
        include_zero = bool(body.get("include_zero_hours", False))
        if not cycle_start or not cycle_end or cycle_end < cycle_start:
            return {
                "message": "cycle_start and cycle_end required (YYYY-MM-DD)",
                "status": 400,
            }

        scoped_ids = _candidate_user_ids(g.user, body.get("filters"))
        # Build the candidate user query — every active org user with an
        # hourly_rate set (the v1 cohort). Filter to scoped_ids when team_admin.
        users_q = User.query.filter_by(org_id=g.user.org_id, is_active=True)
        if scoped_ids is not None:
            if not scoped_ids:
                return {
                    "rows": [],
                    "cycle_start": cycle_start.isoformat(),
                    "cycle_end": cycle_end.isoformat(),
                    "include_zero_hours": include_zero,
                    "status": 200,
                }
            users_q = users_q.filter(User.id.in_(list(scoped_ids)))
        # Pay-visibility SSOT: drops targets the viewer may not see pay for
        # (a team_admin never sees org/super-admin or peer team_admin pay,
        # even on a shared team). No-op for org_admin/super_admin.
        candidate_users = [
            u for u in users_q.all() if can_view_pay_for(g.user, u)
        ]
        candidate_ids = [u.id for u in candidate_users]

        hours_map = _hours_by_user(candidate_ids, cycle_start, cycle_end)
        adj_map = _adjustments_by_user(candidate_ids, cycle_start, cycle_end)
        status_map = _status_by_user(candidate_ids, cycle_start, cycle_end)

        comp_filter = _comp_filter_from_body(body)
        rows = []
        for u in candidate_users:
            model = _effective_comp_model(u)
            if not _passes_comp_filter(model, comp_filter):
                continue
            seconds = hours_map.get(u.id, 0)
            adj = adj_map.get(u.id)
            adj_total = float(adj["total"]) if adj else 0.0
            row = _build_row(
                u, seconds, adj, status_map.get(u.id), cycle_start, cycle_end
            )
            # Cohort: skip zero-everything rows unless include_zero. A
            # model with a real payout (e.g. salaried) keeps its row even
            # with no tracked hours.
            if (
                not include_zero
                and seconds == 0
                and adj_total == 0.0
                and (row["total_payable"] or 0.0) == 0.0
            ):
                continue
            rows.append(row)

        # Sort: held first (need attention), then by total_payable desc
        status_order = {
            STATUS_HELD: 0,
            STATUS_PENDING: 1,
            STATUS_APPROVED: 2,
            STATUS_PAID: 3,
        }
        rows.sort(
            key=lambda r: (
                status_order.get(r["status"], 99),
                -(r["total_payable"] or 0),
            )
        )

        return {
            "rows": rows,
            "cycle_start": cycle_start.isoformat(),
            "cycle_end": cycle_end.isoformat(),
            "include_zero_hours": include_zero,
            "status": 200,
        }

    @requires_team_admin_or_above
    def fetch_cycle_kpis(self):
        """Return totals for the 3-card KPI strip + per-status counts."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        cycle_start = _parse_iso_date(body.get("cycle_start"))
        cycle_end = _parse_iso_date(body.get("cycle_end"))
        if not cycle_start or not cycle_end or cycle_end < cycle_start:
            return {
                "message": "cycle_start and cycle_end required (YYYY-MM-DD)",
                "status": 400,
            }

        scoped_ids = _candidate_user_ids(g.user, body.get("filters"))
        users_q = User.query.filter_by(org_id=g.user.org_id, is_active=True)
        if scoped_ids is not None:
            if not scoped_ids:
                return {
                    "kpis": {
                        "total_payable": 0.0,
                        "approved_total": 0.0,
                        "adjustments_total": 0.0,
                        "pending_count": 0,
                        "approved_count": 0,
                        "held_count": 0,
                        "paid_count": 0,
                    },
                    "cycle_start": cycle_start.isoformat(),
                    "cycle_end": cycle_end.isoformat(),
                    "status": 200,
                }
            users_q = users_q.filter(User.id.in_(list(scoped_ids)))
        # Pay-visibility SSOT: drops targets the viewer may not see pay for
        # (a team_admin never sees org/super-admin or peer team_admin pay,
        # even on a shared team). No-op for org_admin/super_admin.
        candidate_users = [
            u for u in users_q.all() if can_view_pay_for(g.user, u)
        ]
        candidate_ids = [u.id for u in candidate_users]
        user_by_id = {u.id: u for u in candidate_users}

        hours_map = _hours_by_user(candidate_ids, cycle_start, cycle_end)
        adj_map = _adjustments_by_user(candidate_ids, cycle_start, cycle_end)
        status_map = _status_by_user(candidate_ids, cycle_start, cycle_end)

        total_payable = 0.0
        approved_total = 0.0
        adjustments_total = 0.0
        counts = {STATUS_PENDING: 0, STATUS_APPROVED: 0, STATUS_HELD: 0, STATUS_PAID: 0}

        # Mirror fetch_cycle's cohort EXACTLY (same _build_row / comp filter
        # / zero-skip) so the KPI strip always reconciles with the table.
        comp_filter = _comp_filter_from_body(body)
        for u in candidate_users:
            model = _effective_comp_model(u)
            if not _passes_comp_filter(model, comp_filter):
                continue
            seconds = hours_map.get(u.id, 0)
            adj = adj_map.get(u.id)
            adj_total = float(adj["total"]) if adj else 0.0
            row = _build_row(
                u, seconds, adj, status_map.get(u.id), cycle_start, cycle_end
            )
            row_total = row["total_payable"] or 0.0
            if (
                seconds == 0
                and adj_total == 0.0
                and row_total == 0.0
            ):
                continue
            total_payable += row_total
            adjustments_total += adj_total
            status_val = row["status"]
            counts[status_val] = counts.get(status_val, 0) + 1
            if status_val in (STATUS_APPROVED, STATUS_PAID):
                approved_total += row_total

        # Total Paid — lifetime recorded payouts, scoped to the same
        # pay-visibility cohort (team_admin only sums users they may see).
        if candidate_ids:
            total_paid_lifetime = float(
                db.session.query(
                    func.coalesce(func.sum(Payments.amount_paid), 0.0)
                )
                .filter(
                    Payments.org_id == g.user.org_id,
                    Payments.user_id.in_(candidate_ids),
                )
                .scalar()
                or 0.0
            )
        else:
            total_paid_lifetime = 0.0

        # Compensation-model distribution — the true workforce makeup over
        # the full pay-visibility cohort (every active user the viewer may
        # see), BEFORE cycle/comp filtering. Intentionally INCLUDES
        # per_task: a distribution must reflect reality, not the table's
        # default per_task exclusion.
        comp_distribution = {
            "per_task": 0,
            "hourly": 0,
            "salaried": 0,
            "project_based": 0,
            "hybrid": 0,
        }
        for u in candidate_users:
            comp_distribution[_effective_comp_model(u)] += 1

        return {
            "kpis": {
                "total_payable": round(total_payable, 2),
                "total_paid_lifetime": round(total_paid_lifetime, 2),
                "approved_total": round(approved_total, 2),
                "adjustments_total": round(adjustments_total, 2),
                "pending_count": counts[STATUS_PENDING],
                "approved_count": counts[STATUS_APPROVED],
                "held_count": counts[STATUS_HELD],
                "paid_count": counts[STATUS_PAID],
                "compensation_distribution": comp_distribution,
            },
            "cycle_start": cycle_start.isoformat(),
            "cycle_end": cycle_end.isoformat(),
            "status": 200,
        }

    @requires_team_admin_or_above
    def fetch_forecast(self):
        """Payroll forecast: exact confirmed (salaried) + flat trailing-avg
        variable over cadence-generated cycles. v1 is deliberately NOT
        trended (see .claude/payroll-forecast-plan.md)."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}
        body = request.json or {}
        try:
            horizon = int(body.get("horizon", 3))
        except (TypeError, ValueError):
            horizon = 3
        horizon = max(1, min(12, horizon))

        scoped_ids = _candidate_user_ids(g.user, body.get("filters"))
        users_q = User.query.filter_by(org_id=g.user.org_id, is_active=True)
        if scoped_ids is not None:
            if not scoped_ids:
                return {
                    "cadence": "monthly",
                    "cycles": [],
                    "stats": {},
                    "status": 200,
                }
            users_q = users_q.filter(User.id.in_(list(scoped_ids)))
        candidate_users = [
            u for u in users_q.all() if can_view_pay_for(g.user, u)
        ]

        comp_filter = _comp_filter_from_body(body)
        cohort = [
            u
            for u in candidate_users
            if _passes_comp_filter(_effective_comp_model(u), comp_filter)
        ]
        cohort_ids = [u.id for u in cohort]

        cfg = PayrollConfig.query.filter_by(org_id=g.user.org_id).first()
        cadence = cfg.cadence if cfg else "monthly"
        anchor_day = cfg.anchor_day if cfg else 1
        anchor_date = cfg.anchor_date if cfg else None
        if cadence == "bi_weekly" and anchor_date is None:
            cadence, anchor_day, anchor_date = "monthly", 1, None

        today = date.today()
        try:
            past = generate_cycles(
                cadence, anchor_day=anchor_day, anchor_date=anchor_date,
                ref=today, count=3, direction="past",
            )
            future = generate_cycles(
                cadence, anchor_day=anchor_day, anchor_date=anchor_date,
                ref=today, count=horizon, direction="future",
            )
        except ValueError:
            cadence, anchor_day, anchor_date = "monthly", 1, None
            past = generate_cycles(
                "monthly", anchor_day=1, ref=today, count=3,
                direction="past",
            )
            future = generate_cycles(
                "monthly", anchor_day=1, ref=today, count=horizon,
                direction="future",
            )

        def actual_split(s, e):
            hours_map = _hours_by_user(cohort_ids, s, e)
            adj_map = _adjustments_by_user(cohort_ids, s, e)
            total = 0.0
            confirmed = 0.0
            for u in cohort:
                seconds = hours_map.get(u.id, 0)
                adj = adj_map.get(u.id)
                adj_total = float(adj["total"]) if adj else 0.0
                _m, _b, t = _compute_payable(u, seconds, adj_total, s, e)
                total += t
                confirmed += _confirmed_for_user(u, s, e)
            return round(total, 2), round(confirmed, 2), round(
                total - confirmed, 2
            )

        past_vars = [actual_split(s, e)[2] for (s, e) in past]
        avg_variable = (
            round(sum(past_vars) / len(past_vars), 2) if past_vars else 0.0
        )

        cycles = []
        for idx, (s, e) in enumerate(future):
            label = _cycle_label(s, e, cadence)
            if idx == 0:  # current cycle → actuals to date
                total, confirmed, variable = actual_split(s, e)
                cycles.append({
                    "label": label, "start": s.isoformat(),
                    "end": e.isoformat(), "is_current": True,
                    "is_projected": False, "confirmed": confirmed,
                    "variable": variable, "total": total,
                })
            else:  # projected: exact confirmed + flat avg variable
                confirmed = round(
                    sum(_confirmed_for_user(u, s, e) for u in cohort), 2
                )
                cycles.append({
                    "label": label, "start": s.isoformat(),
                    "end": e.isoformat(), "is_current": False,
                    "is_projected": True, "confirmed": confirmed,
                    "variable": avg_variable,
                    "total": round(confirmed + avg_variable, 2),
                })

        cur_total = cycles[0]["total"] if cycles else 0.0
        next_total = cycles[1]["total"] if len(cycles) > 1 else cur_total
        proj_growth = round(next_total - cur_total, 2)
        deltas = [
            cycles[i + 1]["total"] - cycles[i]["total"]
            for i in range(len(cycles) - 1)
        ]
        avg_growth = round(sum(deltas) / len(deltas), 2) if deltas else 0.0

        return {
            "cadence": cadence,
            "cycles": cycles,
            "stats": {
                "projected_growth": proj_growth,
                "projected_growth_pct": (
                    round(proj_growth / cur_total * 100, 1)
                    if cur_total
                    else 0.0
                ),
                "avg_monthly_growth": avg_growth,
                "avg_monthly_growth_pct": (
                    round(avg_growth / cur_total * 100, 1)
                    if cur_total
                    else 0.0
                ),
                "variable_basis": avg_variable,
            },
            "status": 200,
        }

    @requires_team_admin_or_above
    def fetch_project_dispensation(self):
        """Per-project budget vs distributed vs remaining.

        Budget = Project.max_payment (Mikro's payment cap — a defensible
        proxy for 'budget'; confirm with Logan). Distributed =
        Project.total_payout. Remaining = max(budget − distributed, 0).
        Team-admins see only projects on teams they lead (consistent with
        the project-list scoping); org-admins see all org projects.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}
        body = request.json or {}
        try:
            limit = int(body.get("limit", 8))
        except (TypeError, ValueError):
            limit = 8
        limit = max(1, min(50, limit))

        q = Project.query.filter_by(org_id=g.user.org_id)
        if not is_org_admin_or_above(g.user):
            managed = managed_team_ids_for(g.user)
            if not managed:
                return {"projects": [], "totals": {
                    "budget": 0.0, "distributed": 0.0, "remaining": 0.0,
                }, "project_count": 0, "status": 200}
            pids = {
                pt.project_id
                for pt in ProjectTeam.query.filter(
                    ProjectTeam.team_id.in_(managed)
                ).all()
            }
            if not pids:
                return {"projects": [], "totals": {
                    "budget": 0.0, "distributed": 0.0, "remaining": 0.0,
                }, "project_count": 0, "status": 200}
            q = q.filter(Project.id.in_(pids))

        all_projects = q.all()
        rows = []
        tot_b = tot_d = 0.0
        for p in all_projects:
            budget = float(p.max_payment or 0)
            distributed = float(p.total_payout or 0)
            if budget <= 0 and distributed <= 0:
                continue  # nothing to show for unbudgeted/idle projects
            remaining = round(max(budget - distributed, 0.0), 2)
            tot_b += budget
            tot_d += distributed
            rows.append({
                "id": p.id,
                "name": p.short_name or p.name or f"Project {p.id}",
                "budget": round(budget, 2),
                "distributed": round(distributed, 2),
                "remaining": remaining,
            })

        rows.sort(key=lambda r: r["budget"], reverse=True)
        return {
            "projects": rows[:limit],
            "project_count": len(rows),
            "totals": {
                "budget": round(tot_b, 2),
                "distributed": round(tot_d, 2),
                "remaining": round(max(tot_b - tot_d, 0.0), 2),
            },
            "status": 200,
        }

    @requires_team_admin_or_above
    def fetch_contributor(self):
        """Drill-in detail for one user × cycle (sessions, adjustments, status)."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        target_id = body.get("user_id")
        cycle_start = _parse_iso_date(body.get("cycle_start"))
        cycle_end = _parse_iso_date(body.get("cycle_end"))
        if not target_id or not cycle_start or not cycle_end or cycle_end < cycle_start:
            return {
                "message": "user_id, cycle_start, cycle_end required",
                "status": 400,
            }

        # Scope check
        scoped_ids = _candidate_user_ids(g.user, body.get("filters"))
        if scoped_ids is not None and target_id not in scoped_ids:
            return {"message": "User not in your scope", "status": 403}

        user = User.query.filter_by(id=target_id, org_id=g.user.org_id).first()
        if not user:
            return {"message": "User not found", "status": 404}
        # Pay-visibility SSOT (defence-in-depth alongside the scope check).
        if not can_view_pay_for(g.user, user):
            return {"message": "User not in your scope", "status": 403}

        # Header row (reuse the cycle-row builder)
        hours_map = _hours_by_user([user.id], cycle_start, cycle_end)
        adj_map = _adjustments_by_user([user.id], cycle_start, cycle_end)
        status_map = _status_by_user([user.id], cycle_start, cycle_end)
        seconds = hours_map.get(user.id, 0)
        header = _build_row(
            user,
            seconds,
            adj_map.get(user.id),
            status_map.get(user.id),
            cycle_start,
            cycle_end,
        )

        # Session breakdown (raw completed time_entries inside the cycle)
        sessions = (
            TimeEntry.query.filter(
                TimeEntry.user_id == user.id,
                TimeEntry.status == "completed",
                TimeEntry.clock_out.isnot(None),
                cast(TimeEntry.clock_out, SqlDate) >= cycle_start,
                cast(TimeEntry.clock_out, SqlDate) <= cycle_end,
            )
            .order_by(TimeEntry.clock_in.asc())
            .all()
        )
        sessions_data = [
            {
                "id": s.id,
                "clock_in": s.clock_in.isoformat() if s.clock_in else None,
                "clock_out": s.clock_out.isoformat() if s.clock_out else None,
                "duration_seconds": s.duration_seconds or 0,
                "category": s.subcategory_name,
                "project_id": s.project_id,
                "task_name": s.task_name,
                "user_notes": s.user_notes,
            }
            for s in sessions
        ]

        # Adjustments (non-deleted), with resolver for added-by display name
        adj_rows = (
            PaymentAdjustment.query.filter(
                PaymentAdjustment.user_id == user.id,
                PaymentAdjustment.cycle_start == cycle_start,
                PaymentAdjustment.cycle_end == cycle_end,
                PaymentAdjustment.is_deleted.is_(False),
            )
            .order_by(PaymentAdjustment.created_at.asc())
            .all()
        )
        # Batch-resolve actor names
        actor_ids = {a.added_by for a in adj_rows if a.added_by}
        actors = (
            {u.id: u for u in User.query.filter(User.id.in_(list(actor_ids))).all()}
            if actor_ids
            else {}
        )
        adjustments_data = [
            {
                "id": a.id,
                "amount": float(a.amount),
                "type": a.type,
                "note": a.note,
                "source": a.source,
                "request_id": a.request_id,
                "added_by": a.added_by,
                "added_by_name": (
                    _user_display_name(actors[a.added_by]) if a.added_by in actors else None
                ),
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in adj_rows
        ]

        return {
            "contributor": header,
            "sessions": sessions_data,
            "adjustments": adjustments_data,
            "cycle_start": cycle_start.isoformat(),
            "cycle_end": cycle_end.isoformat(),
            "status": 200,
        }

    # ──────────────────────── adjustments ────────────────────────────

    @requires_admin
    def create_adjustment(self):
        """Create a new payment_adjustments row."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        target_id = body.get("user_id")
        cycle_start = _parse_iso_date(body.get("cycle_start"))
        cycle_end = _parse_iso_date(body.get("cycle_end"))
        amount_raw = body.get("amount")
        adj_type = (body.get("type") or "reimbursement").strip().lower()
        note = (body.get("note") or "").strip() or None
        source = (body.get("source") or "admin_entry").strip().lower()
        request_id = body.get("request_id")

        if not target_id or not cycle_start or not cycle_end or cycle_end < cycle_start:
            return {
                "message": "user_id, cycle_start, cycle_end required",
                "status": 400,
            }
        try:
            amount = Decimal(str(amount_raw))
        except Exception:
            return {"message": "amount must be a number", "status": 400}
        if adj_type not in {"reimbursement", "correction", "other"}:
            return {"message": "type must be reimbursement|correction|other", "status": 400}
        if source not in {"admin_entry", "approved_request"}:
            return {"message": "source must be admin_entry|approved_request", "status": 400}

        # Cross-org safety
        user = User.query.filter_by(id=target_id, org_id=g.user.org_id).first()
        if not user:
            return {"message": "User not found", "status": 404}

        row = PaymentAdjustment.create(
            user_id=target_id,
            cycle_start=cycle_start,
            cycle_end=cycle_end,
            amount=amount,
            type=adj_type,
            note=note,
            source=source,
            request_id=request_id,
            added_by=g.user.id,
        )
        return {
            "adjustment": {
                "id": row.id,
                "user_id": row.user_id,
                "cycle_start": row.cycle_start.isoformat(),
                "cycle_end": row.cycle_end.isoformat(),
                "amount": float(row.amount),
                "type": row.type,
                "note": row.note,
                "source": row.source,
                "request_id": row.request_id,
                "added_by": row.added_by,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            },
            "status": 200,
        }

    @requires_admin
    def delete_adjustment(self):
        """Soft-delete an adjustment row (audit trail preserved)."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        adj_id = body.get("adjustment_id")
        if not adj_id:
            return {"message": "adjustment_id required", "status": 400}

        row = PaymentAdjustment.query.get(adj_id)
        if not row or row.is_deleted:
            return {"message": "Adjustment not found", "status": 404}

        # Cross-org safety: confirm the adjustment's user belongs to this org
        user = User.query.filter_by(id=row.user_id, org_id=g.user.org_id).first()
        if not user:
            return {"message": "Adjustment not found", "status": 404}

        row.update(
            is_deleted=True,
            deleted_at=datetime.utcnow(),
            deleted_by=g.user.id,
        )
        return {"message": "Adjustment removed", "adjustment_id": adj_id, "status": 200}

    # ──────────────────────── status setter ──────────────────────────

    @requires_admin
    def set_status(self):
        """Set the cycle status for a user. Creates the row lazily."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        target_id = body.get("user_id")
        cycle_start = _parse_iso_date(body.get("cycle_start"))
        cycle_end = _parse_iso_date(body.get("cycle_end"))
        new_status = (body.get("status") or "").strip().lower()
        note = (body.get("note") or "").strip() or None

        if not target_id or not cycle_start or not cycle_end or cycle_end < cycle_start:
            return {
                "message": "user_id, cycle_start, cycle_end required",
                "status": 400,
            }
        if new_status not in VALID_STATUSES:
            return {
                "message": f"status must be one of: {sorted(VALID_STATUSES)}",
                "status": 400,
            }
        if new_status == STATUS_HELD and not note:
            return {"message": "Held requires a note", "status": 400}

        # Cross-org safety
        user = User.query.filter_by(id=target_id, org_id=g.user.org_id).first()
        if not user:
            return {"message": "User not found", "status": 404}

        row = PaymentCycleStatus.query.filter_by(
            user_id=target_id,
            cycle_start=cycle_start,
            cycle_end=cycle_end,
        ).first()
        if row:
            row.update(status=new_status, note=note, actor_id=g.user.id)
        else:
            row = PaymentCycleStatus.create(
                user_id=target_id,
                cycle_start=cycle_start,
                cycle_end=cycle_end,
                status=new_status,
                note=note,
                actor_id=g.user.id,
            )

        return {
            "status_row": {
                "user_id": row.user_id,
                "cycle_start": row.cycle_start.isoformat(),
                "cycle_end": row.cycle_end.isoformat(),
                "status": row.status,
                "note": row.note,
                "actor_id": row.actor_id,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            },
            "status": 200,
        }

    # ───────────────────────── csv export ────────────────────────────

    @requires_admin
    def export_cycle(self):
        """Return a CSV of approved rows for the cycle (Aaron's worksheet)."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        cycle_start = _parse_iso_date(body.get("cycle_start"))
        cycle_end = _parse_iso_date(body.get("cycle_end"))
        if not cycle_start or not cycle_end or cycle_end < cycle_start:
            return {
                "message": "cycle_start and cycle_end required (YYYY-MM-DD)",
                "status": 400,
            }

        scoped_ids = _candidate_user_ids(g.user, body.get("filters"))
        users_q = User.query.filter_by(org_id=g.user.org_id, is_active=True)
        if scoped_ids is not None:
            if not scoped_ids:
                return self._empty_csv(cycle_start, cycle_end)
            users_q = users_q.filter(User.id.in_(list(scoped_ids)))
        # Pay-visibility SSOT: drops targets the viewer may not see pay for
        # (a team_admin never sees org/super-admin or peer team_admin pay,
        # even on a shared team). No-op for org_admin/super_admin.
        candidate_users = [
            u for u in users_q.all() if can_view_pay_for(g.user, u)
        ]
        candidate_ids = [u.id for u in candidate_users]
        user_by_id = {u.id: u for u in candidate_users}

        hours_map = _hours_by_user(candidate_ids, cycle_start, cycle_end)
        adj_map = _adjustments_by_user(candidate_ids, cycle_start, cycle_end)
        status_map = _status_by_user(candidate_ids, cycle_start, cycle_end)

        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow([
            "Name",
            "OSM Username",
            "Payment Email",
            "Compensation Model",
            "Hours",
            "Hourly Rate",
            "Base / Wage",
            "Adjustments",
            "Total Payable",
        ])

        comp_filter = _comp_filter_from_body(body)
        for uid, status_row in status_map.items():
            if status_row.status not in (STATUS_APPROVED, STATUS_PAID):
                continue
            u = user_by_id.get(uid)
            if not u:
                continue
            model = _effective_comp_model(u)
            if not _passes_comp_filter(model, comp_filter):
                continue
            seconds = hours_map.get(uid, 0)
            adj = adj_map.get(uid)
            adj_total = float(adj["total"]) if adj else 0.0
            hours = round(seconds / 3600.0, 2) if seconds else 0.0
            rate = float(u.hourly_rate) if u.hourly_rate is not None else 0.0
            _m, base, total = _compute_payable(
                u, seconds, adj_total, cycle_start, cycle_end
            )
            writer.writerow([
                _user_display_name(u),
                u.osm_username or "",
                u.payment_email or "",
                model,
                f"{hours:.2f}",
                f"{rate:.2f}",
                f"{base:.2f}",
                f"{adj_total:.2f}",
                f"{total:.2f}",
            ])

        csv_text = buffer.getvalue()
        buffer.close()
        filename = f"mikro-payments-{cycle_start.isoformat()}-{cycle_end.isoformat()}.csv"
        return Response(
            csv_text,
            mimetype="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    def _empty_csv(self, cycle_start, cycle_end):
        filename = f"mikro-payments-{cycle_start.isoformat()}-{cycle_end.isoformat()}.csv"
        header = (
            "Name,OSM Username,Payment Email,Compensation Model,Hours,"
            "Hourly Rate,Base / Wage,Adjustments,Total Payable\n"
        )
        return Response(
            header,
            mimetype="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # ───────────────────── payroll cadence config ────────────────────

    _VALID_CADENCE = {"monthly", "semi_monthly", "bi_weekly"}

    @requires_team_admin_or_above
    def fetch_payroll_config(self):
        """Return the org's payroll cadence config.

        Fail-open: if no row exists, return the computed default
        (monthly / anchor day 1) so the cycle picker always works. The
        ``is_default`` flag tells the UI whether a config has been saved.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}
        cfg = PayrollConfig.query.filter_by(org_id=g.user.org_id).first()
        if not cfg:
            return {
                "config": {
                    "cadence": "monthly",
                    "anchor_day": 1,
                    "anchor_date": None,
                    "timezone": None,
                },
                "is_default": True,
                "status": 200,
            }
        return {
            "config": {
                "cadence": cfg.cadence,
                "anchor_day": cfg.anchor_day,
                "anchor_date": cfg.anchor_date.isoformat() if cfg.anchor_date else None,
                "timezone": cfg.timezone,
            },
            "is_default": False,
            "updated_by": cfg.updated_by,
            "updated_at": cfg.updated_at.isoformat() if cfg.updated_at else None,
            "status": 200,
        }

    @requires_admin
    def save_payroll_config(self):
        """Upsert the org's payroll cadence config (org_admin+ only)."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}
        body = request.json or {}
        cadence = (body.get("cadence") or "").strip()
        if cadence not in self._VALID_CADENCE:
            return {
                "message": f"cadence must be one of {sorted(self._VALID_CADENCE)}",
                "status": 400,
            }

        anchor_day = body.get("anchor_day")
        anchor_date = _parse_iso_date(body.get("anchor_date"))
        if cadence == "monthly":
            try:
                anchor_day = int(anchor_day) if anchor_day is not None else 1
            except (TypeError, ValueError):
                return {"message": "anchor_day must be an integer 1–28", "status": 400}
            if not (1 <= anchor_day <= 28):
                return {"message": "anchor_day must be 1–28", "status": 400}
            anchor_date = None
        elif cadence == "bi_weekly":
            if anchor_date is None:
                return {
                    "message": "anchor_date (YYYY-MM-DD) required for bi_weekly",
                    "status": 400,
                }
            anchor_day = None
        else:  # semi_monthly — fixed 1st & 16th, no anchor needed
            anchor_day = None
            anchor_date = None

        cfg = PayrollConfig.query.filter_by(org_id=g.user.org_id).first()
        if not cfg:
            cfg = PayrollConfig(org_id=g.user.org_id)
            db.session.add(cfg)
        cfg.cadence = cadence
        cfg.anchor_day = anchor_day
        cfg.anchor_date = anchor_date
        cfg.timezone = (body.get("timezone") or None)
        cfg.updated_by = g.user.id
        db.session.commit()

        return {
            "config": {
                "cadence": cfg.cadence,
                "anchor_day": cfg.anchor_day,
                "anchor_date": cfg.anchor_date.isoformat() if cfg.anchor_date else None,
                "timezone": cfg.timezone,
            },
            "is_default": False,
            "message": "Payroll config saved",
            "status": 200,
        }

    # ─── Reimbursement-request workflow (Trello PkljPEJx) ───────────
    #
    # Workflow rules (echoes the docstring on ReimbursementRequest):
    #   - Editor submits a request -> row in pending state. user_id +
    #     org_id always derived from g.user (never trusted from body).
    #   - Editor can withdraw their own pending requests; not after
    #     review.
    #   - Admin can approve (creates paired PaymentAdjustment) or
    #     reject (with reviewer_note). Admin picks the cycle at
    #     approval time — the editor's submission has no cycle.
    #   - Pay-visibility model: editors see their own rows only;
    #     admins see rows for users they can view via
    #     ``can_view_pay_for``.
    #
    # Notifications are stubbed (comms platform not yet built); the
    # three trigger points are marked TODO comms-platform inline so
    # wiring becomes a 5-minute follow-up per call site when comms
    # lands.

    # Helper — format one request for JSON. Single source of truth so
    # editor + admin endpoints emit the same shape.
    @staticmethod
    def _format_reimbursement(req):
        return {
            "id": req.id,
            "user_id": req.user_id,
            "org_id": req.org_id,
            "amount": float(req.amount) if req.amount is not None else None,
            "description": req.description,
            "attachment_url": req.attachment_url,  # Spaces object key — clients ask /attachment-url to get a signed URL.
            "has_attachment": bool(req.attachment_url),
            "status": req.status,
            "submitted_at": req.submitted_at.isoformat() + "Z" if req.submitted_at else None,
            "reviewed_by": req.reviewed_by,
            "reviewed_at": req.reviewed_at.isoformat() + "Z" if req.reviewed_at else None,
            "reviewer_note": req.reviewer_note,
            "adjustment_id": req.adjustment_id,
        }

    @staticmethod
    def _format_reimbursement_with_user(req, user):
        """Same as _format_reimbursement plus a minimal user payload
        for the admin queue (so the table can render name + osm
        username without a second round-trip)."""
        out = PaymentsAPI._format_reimbursement(req)
        if user is not None:
            out["user_name"] = _user_display_name(user)
            out["user_osm_username"] = user.osm_username or ""
        return out

    # ── Editor endpoints ─────────────────────────────────────

    def reimbursement_submit(self):
        """Editor submits a new reimbursement request.

        user_id + org_id come from the session — payload is ignored
        for those fields. Amount must be > 0; description required.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        try:
            amount = Decimal(str(body.get("amount")))
        except Exception:
            return {"message": "amount must be a number", "status": 400}
        if amount <= 0:
            return {"message": "amount must be > 0", "status": 400}

        description = (body.get("description") or "").strip()
        if not description:
            return {"message": "description is required", "status": 400}
        if len(description) > 2000:
            return {"message": "description exceeds 2000 characters", "status": 400}

        attachment_url = (body.get("attachment_url") or "").strip() or None
        if attachment_url and not attachment_url.startswith("reimbursements/"):
            return {
                "message": "attachment_url must be a reimbursements/ object key",
                "status": 400,
            }

        row = ReimbursementRequest.create(
            user_id=g.user.id,
            org_id=g.user.org_id,
            amount=amount,
            description=description,
            attachment_url=attachment_url,
            status="pending",
        )
        # TODO comms-platform: notify org admins of new pending request.
        return {
            "request": self._format_reimbursement(row),
            "message": "Reimbursement request submitted",
            "status": 200,
        }

    def reimbursement_my(self):
        """List the current user's own reimbursement requests.

        Optional ``status`` filter; results ordered newest-first by
        submitted_at.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        status_filter = (body.get("status") or "").strip().lower() or None
        if status_filter and status_filter not in {
            "pending", "approved", "rejected", "withdrawn",
        }:
            return {"message": "invalid status filter", "status": 400}

        q = ReimbursementRequest.query.filter(
            ReimbursementRequest.user_id == g.user.id
        )
        if status_filter:
            q = q.filter(ReimbursementRequest.status == status_filter)
        rows = q.order_by(ReimbursementRequest.submitted_at.desc()).all()
        return {
            "requests": [self._format_reimbursement(r) for r in rows],
            "status": 200,
        }

    def reimbursement_withdraw(self):
        """Editor withdraws their own pending request.

        Only the owner can withdraw, and only while still pending —
        approved/rejected/already-withdrawn requests are terminal.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        req_id = body.get("request_id")
        if not req_id:
            return {"message": "request_id required", "status": 400}

        row = ReimbursementRequest.query.get(req_id)
        if not row or row.user_id != g.user.id:
            return {"message": "Request not found", "status": 404}
        if row.status != "pending":
            return {
                "message": f"Cannot withdraw a request in '{row.status}' state",
                "status": 409,
            }

        row.status = "withdrawn"
        row.save()
        return {
            "request": self._format_reimbursement(row),
            "message": "Reimbursement request withdrawn",
            "status": 200,
        }

    def reimbursement_upload_url(self):
        """Issue a short-lived presigned PUT URL for a receipt upload.

        Body:
            filename: required, used to derive a safe object key
                      (the original name does NOT round-trip into
                      anything user-visible)
            content_type: required, must be in the whitelist
                          (jpeg/png/heic/pdf)

        Returns ``{ url, key }``. Editor PUTs the file to ``url``,
        then includes ``key`` as ``attachment_url`` on the submit
        call.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        filename = (body.get("filename") or "").strip()
        content_type = (body.get("content_type") or "").strip().lower()
        if not filename:
            return {"message": "filename required", "status": 400}
        if content_type not in _RECEIPT_ALLOWED_CONTENT_TYPES:
            return {
                "message": (
                    "content_type must be one of: "
                    + ", ".join(sorted(_RECEIPT_ALLOWED_CONTENT_TYPES))
                ),
                "status": 400,
            }

        key = _receipt_object_key(g.user.id, filename)
        try:
            url = _presigned_put_url(key, content_type)
        except RuntimeError as e:
            return {"message": str(e), "status": 500}
        return {
            "url": url,
            "key": key,
            "expires_in_seconds": _RECEIPT_URL_EXPIRES_S,
            "max_bytes": _RECEIPT_MAX_BYTES,
            "status": 200,
        }

    # ── Admin endpoints ──────────────────────────────────────

    @requires_team_admin_or_above
    def reimbursement_pending(self):
        """List pending reimbursement requests visible to this admin.

        Scope: the viewer's org_id, filtered to user_ids the viewer
        can ``can_view_pay_for``. Optional ``status`` filter (defaults
        to 'pending' for the queue use-case but the UI can pass other
        values to view history).
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        status_filter = (body.get("status") or "pending").strip().lower()
        if status_filter not in {"pending", "approved", "rejected", "withdrawn", "all"}:
            return {"message": "invalid status filter", "status": 400}

        q = ReimbursementRequest.query.filter(
            ReimbursementRequest.org_id == g.user.org_id
        )
        if status_filter != "all":
            q = q.filter(ReimbursementRequest.status == status_filter)
        rows = q.order_by(ReimbursementRequest.submitted_at.desc()).all()

        # Pay-visibility filter. We load each row's owner once (small N
        # for the pending queue; if this grows we batch via WHERE
        # user_id IN (...) later).
        out = []
        for r in rows:
            owner = User.query.get(r.user_id)
            if owner is None:
                continue
            if not can_view_pay_for(g.user, owner):
                continue
            out.append(self._format_reimbursement_with_user(r, owner))
        return {
            "requests": out,
            "pending_count": sum(1 for x in out if x["status"] == "pending"),
            "status": 200,
        }

    @requires_team_admin_or_above
    def reimbursement_approve(self):
        """Approve a pending request → creates the paired
        ``PaymentAdjustment`` row in the cycle the admin picks.

        Body:
            request_id: required
            cycle_start, cycle_end: required, ISO dates
            reviewer_note: optional
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        req_id = body.get("request_id")
        cycle_start = _parse_iso_date(body.get("cycle_start"))
        cycle_end = _parse_iso_date(body.get("cycle_end"))
        reviewer_note = (body.get("reviewer_note") or "").strip() or None

        if not req_id:
            return {"message": "request_id required", "status": 400}
        if not cycle_start or not cycle_end or cycle_end < cycle_start:
            return {
                "message": "cycle_start + cycle_end required",
                "status": 400,
            }
        if reviewer_note and len(reviewer_note) > 2000:
            return {
                "message": "reviewer_note exceeds 2000 characters",
                "status": 400,
            }

        row = ReimbursementRequest.query.get(req_id)
        if row is None:
            return {"message": "Request not found", "status": 404}
        if row.org_id != g.user.org_id:
            return {"message": "Cross-org request denied", "status": 403}
        if row.status != "pending":
            return {
                "message": f"Cannot approve a request in '{row.status}' state",
                "status": 409,
            }

        # Pay-visibility check: viewer must be allowed to act on this user.
        owner = User.query.get(row.user_id)
        if owner is None or not can_view_pay_for(g.user, owner):
            return {"message": "Not authorized for this request", "status": 403}

        # Create the paired PaymentAdjustment. Description carries into
        # the adjustment's note so the cycle row shows the editor's
        # reason without a join back.
        adj = PaymentAdjustment.create(
            user_id=row.user_id,
            cycle_start=cycle_start,
            cycle_end=cycle_end,
            amount=row.amount,
            type="reimbursement",
            note=row.description,
            source="approved_request",
            request_id=row.id,
            added_by=g.user.id,
        )

        row.status = "approved"
        row.reviewed_by = g.user.id
        row.reviewed_at = datetime.utcnow()
        row.reviewer_note = reviewer_note
        row.adjustment_id = adj.id
        row.save()

        # TODO comms-platform: notify editor that their request was approved.
        return {
            "request": self._format_reimbursement(row),
            "adjustment_id": adj.id,
            "message": "Reimbursement approved",
            "status": 200,
        }

    @requires_team_admin_or_above
    def reimbursement_reject(self):
        """Reject a pending request with a required reviewer note.

        No PaymentAdjustment is created. The request stays in the
        rejected state for audit; the editor sees the reviewer note
        in their own-history panel.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        req_id = body.get("request_id")
        reviewer_note = (body.get("reviewer_note") or "").strip()
        if not req_id:
            return {"message": "request_id required", "status": 400}
        if not reviewer_note:
            return {
                "message": "reviewer_note is required when rejecting",
                "status": 400,
            }
        if len(reviewer_note) > 2000:
            return {
                "message": "reviewer_note exceeds 2000 characters",
                "status": 400,
            }

        row = ReimbursementRequest.query.get(req_id)
        if row is None:
            return {"message": "Request not found", "status": 404}
        if row.org_id != g.user.org_id:
            return {"message": "Cross-org request denied", "status": 403}
        if row.status != "pending":
            return {
                "message": f"Cannot reject a request in '{row.status}' state",
                "status": 409,
            }

        owner = User.query.get(row.user_id)
        if owner is None or not can_view_pay_for(g.user, owner):
            return {"message": "Not authorized for this request", "status": 403}

        row.status = "rejected"
        row.reviewed_by = g.user.id
        row.reviewed_at = datetime.utcnow()
        row.reviewer_note = reviewer_note
        row.save()

        # TODO comms-platform: notify editor of rejection with reason.
        return {
            "request": self._format_reimbursement(row),
            "message": "Reimbursement rejected",
            "status": 200,
        }

    def reimbursement_attachment_url(self):
        """Issue a short-lived signed GET URL for a request's receipt.

        Dual-audience endpoint — no role decorator on purpose. The
        permission check is inline because:

          - The editor (any authenticated user) needs access to their
            own receipts (they uploaded them; they should be able to
            re-view them from their own-history panel).

          - An admin with ``can_view_pay_for`` access to the owner
            also needs access (to review attached receipts during
            approval triage).

        Auth gating is the ``if not g.user`` check + the explicit
        ownership-OR-pay-visibility branch below. Cross-org is hard-
        denied first via the org_id match.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        body = request.json or {}
        req_id = body.get("request_id")
        if not req_id:
            return {"message": "request_id required", "status": 400}

        row = ReimbursementRequest.query.get(req_id)
        if row is None:
            return {"message": "Request not found", "status": 404}
        if not row.attachment_url:
            return {"message": "This request has no attachment", "status": 404}

        # Owner OR admin-with-pay-visibility-for-owner.
        if row.user_id != g.user.id:
            if row.org_id != g.user.org_id:
                return {"message": "Cross-org access denied", "status": 403}
            owner = User.query.get(row.user_id)
            if owner is None or not can_view_pay_for(g.user, owner):
                return {"message": "Not authorized for this request", "status": 403}

        try:
            url = _presigned_get_url(row.attachment_url)
        except RuntimeError as e:
            return {"message": str(e), "status": 500}
        return {
            "url": url,
            "expires_in_seconds": _RECEIPT_URL_EXPIRES_S,
            "status": 200,
        }
