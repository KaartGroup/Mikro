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
from datetime import date, datetime
from decimal import Decimal

from flask import Response, g, request
from flask.views import MethodView
from sqlalchemy import cast, func, Date as SqlDate

from ..auth import (
    is_org_admin_or_above,
    managed_team_ids_for,
    team_member_ids_for,
)
from ..database import (
    PaymentAdjustment,
    PaymentCycleStatus,
    TimeEntry,
    User,
    db,
)
from ..utils import requires_admin, requires_team_admin_or_above


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


def _build_row(user, seconds, adj, status_row):
    """Compose a single PaymentCycleRow dict for the table."""
    hours = round(seconds / 3600.0, 2) if seconds else 0.0
    rate = float(user.hourly_rate) if user.hourly_rate is not None else None
    wage = round(hours * rate, 2) if rate is not None else None
    adj_total = float(adj["total"]) if adj else 0.0
    adj_count = adj["count"] if adj else 0
    total = (wage or 0.0) + adj_total
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

        scoped_ids = _scoped_user_ids(g.user)
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
        candidate_users = users_q.all()
        candidate_ids = [u.id for u in candidate_users]

        hours_map = _hours_by_user(candidate_ids, cycle_start, cycle_end)
        adj_map = _adjustments_by_user(candidate_ids, cycle_start, cycle_end)
        status_map = _status_by_user(candidate_ids, cycle_start, cycle_end)

        rows = []
        for u in candidate_users:
            seconds = hours_map.get(u.id, 0)
            adj = adj_map.get(u.id)
            adj_total = float(adj["total"]) if adj else 0.0
            if not include_zero and seconds == 0 and adj_total == 0.0:
                continue
            # Skip users without an hourly_rate AND no adjustments —
            # they're not in the hourly-payroll cohort.
            if u.hourly_rate is None and adj_total == 0.0:
                continue
            rows.append(
                _build_row(u, seconds, adj, status_map.get(u.id))
            )

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

        scoped_ids = _scoped_user_ids(g.user)
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
        candidate_users = users_q.all()
        candidate_ids = [u.id for u in candidate_users]
        user_by_id = {u.id: u for u in candidate_users}

        hours_map = _hours_by_user(candidate_ids, cycle_start, cycle_end)
        adj_map = _adjustments_by_user(candidate_ids, cycle_start, cycle_end)
        status_map = _status_by_user(candidate_ids, cycle_start, cycle_end)

        total_payable = 0.0
        approved_total = 0.0
        adjustments_total = 0.0
        counts = {STATUS_PENDING: 0, STATUS_APPROVED: 0, STATUS_HELD: 0, STATUS_PAID: 0}

        # Sum over all candidate users with non-zero activity. Same cohort
        # rule as fetch_cycle so KPIs match the visible table.
        for uid in set(hours_map.keys()) | set(adj_map.keys()):
            u = user_by_id.get(uid)
            if not u:
                continue
            seconds = hours_map.get(uid, 0)
            adj = adj_map.get(uid)
            adj_total = float(adj["total"]) if adj else 0.0
            if u.hourly_rate is None and adj_total == 0.0:
                continue
            hours = seconds / 3600.0
            wage = hours * float(u.hourly_rate) if u.hourly_rate is not None else 0.0
            row_total = wage + adj_total
            total_payable += row_total
            adjustments_total += adj_total
            status_row = status_map.get(uid)
            status_val = status_row.status if status_row else STATUS_PENDING
            counts[status_val] = counts.get(status_val, 0) + 1
            if status_val in (STATUS_APPROVED, STATUS_PAID):
                approved_total += row_total

        return {
            "kpis": {
                "total_payable": round(total_payable, 2),
                "approved_total": round(approved_total, 2),
                "adjustments_total": round(adjustments_total, 2),
                "pending_count": counts[STATUS_PENDING],
                "approved_count": counts[STATUS_APPROVED],
                "held_count": counts[STATUS_HELD],
                "paid_count": counts[STATUS_PAID],
            },
            "cycle_start": cycle_start.isoformat(),
            "cycle_end": cycle_end.isoformat(),
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
        scoped_ids = _scoped_user_ids(g.user)
        if scoped_ids is not None and target_id not in scoped_ids:
            return {"message": "User not in your scope", "status": 403}

        user = User.query.filter_by(id=target_id, org_id=g.user.org_id).first()
        if not user:
            return {"message": "User not found", "status": 404}

        # Header row (reuse the cycle-row builder)
        hours_map = _hours_by_user([user.id], cycle_start, cycle_end)
        adj_map = _adjustments_by_user([user.id], cycle_start, cycle_end)
        status_map = _status_by_user([user.id], cycle_start, cycle_end)
        seconds = hours_map.get(user.id, 0)
        header = _build_row(
            user, seconds, adj_map.get(user.id), status_map.get(user.id)
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
                "category": s.category,
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

        scoped_ids = _scoped_user_ids(g.user)
        users_q = User.query.filter_by(org_id=g.user.org_id, is_active=True)
        if scoped_ids is not None:
            if not scoped_ids:
                return self._empty_csv(cycle_start, cycle_end)
            users_q = users_q.filter(User.id.in_(list(scoped_ids)))
        candidate_users = users_q.all()
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
            "Hours",
            "Hourly Rate",
            "Calculated Wage",
            "Adjustments",
            "Total Payable",
        ])

        for uid, status_row in status_map.items():
            if status_row.status not in (STATUS_APPROVED, STATUS_PAID):
                continue
            u = user_by_id.get(uid)
            if not u:
                continue
            seconds = hours_map.get(uid, 0)
            adj = adj_map.get(uid)
            adj_total = float(adj["total"]) if adj else 0.0
            hours = round(seconds / 3600.0, 2) if seconds else 0.0
            rate = float(u.hourly_rate) if u.hourly_rate is not None else 0.0
            wage = round(hours * rate, 2)
            total = round(wage + adj_total, 2)
            writer.writerow([
                _user_display_name(u),
                u.osm_username or "",
                u.payment_email or "",
                f"{hours:.2f}",
                f"{rate:.2f}",
                f"{wage:.2f}",
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
            "Name,OSM Username,Payment Email,Hours,Hourly Rate,Calculated Wage,"
            "Adjustments,Total Payable\n"
        )
        return Response(
            header,
            mimetype="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
