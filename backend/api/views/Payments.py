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
    can_view_pay_for,
    is_org_admin_or_above,
    managed_team_ids_for,
    team_member_ids_for,
)
from ..database import (
    PaymentAdjustment,
    Payments,
    Project,
    ProjectTeam,
    TimeEntry,
    User,
    db,
)
from ..filters import resolve_filtered_user_ids
from ..payroll_periods import generate_cycles
from ..services.payment_cycle import (
    PaymentCycleService as PaymentService,
    STATUS_APPROVED,
    STATUS_HELD,
    STATUS_PAID,
    STATUS_PENDING,
    VALID_COMP_MODELS,
    VALID_STATUSES,
)
from ..utils import requires_admin, requires_team_admin_or_above



def _decimal(v):
    """Convert a Decimal (or int) to float for JSON responses; pass None through."""
    if v is None:
        return None
    return float(v)


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
        return {"message": f"Unknown payments path: {path}", "status": 404}, 404

    # ────────────────────────── cycle table ──────────────────────────

    @requires_team_admin_or_above
    def fetch_cycle(self):
        """Return per-contributor rows for the given cycle range.

        Defaults to non-zero hours only (Logan's 2026-05-12 decision).
        Pass ``include_zero_hours: true`` to show every hourly contractor
        regardless of activity in the period.
        """
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

        svc = PaymentService(g.user.org_id)
        hours_map = svc.hours_by_user(candidate_ids, cycle_start, cycle_end)
        adj_map = svc.adjustments_by_user(candidate_ids, cycle_start, cycle_end)
        status_map = svc.status_by_user(candidate_ids, cycle_start, cycle_end)
        rate_map = svc.rates_by_user(candidate_ids, cycle_start)
        for u in candidate_users:
            u._active_hourly_rate = rate_map.get(u.id)

        comp_filter = _comp_filter_from_body(body)
        rows = []
        for u in candidate_users:
            model = PaymentService.effective_comp_model(u)
            if not PaymentService.passes_comp_filter(model, comp_filter):
                continue
            seconds = hours_map.get(u.id, 0)
            adj = adj_map.get(u.id)
            adj_total = float(adj["total"]) if adj else 0.0
            row = PaymentService.build_row(u, seconds, adj, status_map.get(u.id))
            # Cohort: skip zero-everything rows unless include_zero.
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

        svc = PaymentService(g.user.org_id)
        hours_map = svc.hours_by_user(candidate_ids, cycle_start, cycle_end)
        adj_map = svc.adjustments_by_user(candidate_ids, cycle_start, cycle_end)
        status_map = svc.status_by_user(candidate_ids, cycle_start, cycle_end)
        rate_map = svc.rates_by_user(candidate_ids, cycle_start)
        for u in candidate_users:
            u._active_hourly_rate = rate_map.get(u.id)

        total_payable = 0.0
        approved_total = 0.0
        adjustments_total = 0.0
        counts = {STATUS_PENDING: 0, STATUS_APPROVED: 0, STATUS_HELD: 0, STATUS_PAID: 0}

        # Mirror fetch_cycle's cohort EXACTLY (same build_row / comp filter
        # / zero-skip) so the KPI strip always reconciles with the table.
        comp_filter = _comp_filter_from_body(body)
        for u in candidate_users:
            model = PaymentService.effective_comp_model(u)
            if not PaymentService.passes_comp_filter(model, comp_filter):
                continue
            seconds = hours_map.get(u.id, 0)
            adj = adj_map.get(u.id)
            adj_total = float(adj["total"]) if adj else 0.0
            row = PaymentService.build_row(u, seconds, adj, status_map.get(u.id))
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
            "project_based": 0,
        }
        for u in candidate_users:
            comp_distribution[PaymentService.effective_comp_model(u)] += 1

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
        """Payroll forecast: flat trailing-avg variable over cadence-generated
        cycles. v1 is deliberately NOT trended (see .claude/payroll-forecast-plan.md)."""
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

        # Pre-populate today's active rate so effective_comp_model uses
        # the history table rather than the deprecated column.
        svc = PaymentService(g.user.org_id)
        _today_rates = svc.rates_by_user([u.id for u in candidate_users], date.today())
        for u in candidate_users:
            u._active_hourly_rate = _today_rates.get(u.id)

        comp_filter = _comp_filter_from_body(body)
        cohort = [
            u
            for u in candidate_users
            if PaymentService.passes_comp_filter(
                PaymentService.effective_comp_model(u), comp_filter
            )
        ]
        cohort_ids = [u.id for u in cohort]

        cfg = svc.get_payroll_config()
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
            hours_map = svc.hours_by_user(cohort_ids, s, e)
            adj_map = svc.adjustments_by_user(cohort_ids, s, e)
            # Per-cycle rate resolution: use rate active on cycle start.
            cycle_rates = svc.rates_by_user(cohort_ids, s)
            for u in cohort:
                u._active_hourly_rate = cycle_rates.get(u.id)
            total = 0.0
            for u in cohort:
                seconds = hours_map.get(u.id, 0)
                adj = adj_map.get(u.id)
                adj_total = float(adj["total"]) if adj else 0.0
                _m, _b, t = PaymentService.compute_payable(u, seconds, adj_total)
                total += t
            return round(total, 2), 0.0, round(total, 2)

        past_vars = [actual_split(s, e)[2] for (s, e) in past]
        avg_variable = (
            round(sum(past_vars) / len(past_vars), 2) if past_vars else 0.0
        )

        cycles = []
        for idx, (s, e) in enumerate(future):
            label = PaymentService.cycle_label(s, e, cadence)
            if idx == 0:  # current cycle → actuals to date
                total, confirmed, variable = actual_split(s, e)
                cycles.append({
                    "label": label, "start": s.isoformat(),
                    "end": e.isoformat(), "is_current": True,
                    "is_projected": False, "confirmed": confirmed,
                    "variable": variable, "total": total,
                })
            else:  # projected: flat avg variable (no model has a confirmed commitment)
                cycles.append({
                    "label": label, "start": s.isoformat(),
                    "end": e.isoformat(), "is_current": False,
                    "is_projected": True, "confirmed": 0.0,
                    "variable": avg_variable,
                    "total": avg_variable,
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
        svc = PaymentService(g.user.org_id)
        hours_map = svc.hours_by_user([user.id], cycle_start, cycle_end)
        adj_map = svc.adjustments_by_user([user.id], cycle_start, cycle_end)
        status_map = svc.status_by_user([user.id], cycle_start, cycle_end)
        user._active_hourly_rate = svc.rates_by_user([user.id], cycle_start).get(user.id)
        seconds = hours_map.get(user.id, 0)
        header = PaymentService.build_row(
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
                    PaymentService.display_name(actors[a.added_by]) if a.added_by in actors else None
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

        svc = PaymentService(g.user.org_id)
        row = svc.create_adjustment(
            user_id=target_id,
            cycle_start=cycle_start,
            cycle_end=cycle_end,
            amount=amount,
            adj_type=adj_type,
            note=note,
            added_by=g.user.id,
            source=source,
            request_id=request_id,
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
        body = request.json or {}
        adj_id = body.get("adjustment_id")
        if not adj_id:
            return {"message": "adjustment_id required", "status": 400}

        # Cross-org safety: look up the adjustment, then verify its user is in this org
        existing = PaymentAdjustment.query.get(adj_id)
        if not existing or existing.is_deleted:
            return {"message": "Adjustment not found", "status": 404}
        user = User.query.filter_by(id=existing.user_id, org_id=g.user.org_id).first()
        if not user:
            return {"message": "Adjustment not found", "status": 404}

        svc = PaymentService(g.user.org_id)
        svc.soft_delete_adjustment(adj_id, deleted_by=g.user.id)
        return {"message": "Adjustment removed", "adjustment_id": adj_id, "status": 200}

    # ──────────────────────── status setter ──────────────────────────

    @requires_admin
    def set_status(self):
        """Set the cycle status for a user. Creates the row lazily."""
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

        svc = PaymentService(g.user.org_id)
        row = svc.upsert_cycle_status(
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

        svc = PaymentService(g.user.org_id)
        hours_map = svc.hours_by_user(candidate_ids, cycle_start, cycle_end)
        adj_map = svc.adjustments_by_user(candidate_ids, cycle_start, cycle_end)
        status_map = svc.status_by_user(candidate_ids, cycle_start, cycle_end)
        rate_map = svc.rates_by_user(candidate_ids, cycle_start)
        for u in candidate_users:
            u._active_hourly_rate = rate_map.get(u.id)

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
            model = PaymentService.effective_comp_model(u)
            if not PaymentService.passes_comp_filter(model, comp_filter):
                continue
            seconds = hours_map.get(uid, 0)
            adj = adj_map.get(uid)
            adj_total = float(adj["total"]) if adj else 0.0
            hours = round(seconds / 3600.0, 2) if seconds else 0.0
            _r = getattr(u, "_active_hourly_rate", None)
            rate = float(_r) if _r is not None else 0.0
            _m, base, total = PaymentService.compute_payable(u, seconds, adj_total)
            writer.writerow([
                PaymentService.display_name(u),
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
        cfg = PaymentService(g.user.org_id).get_payroll_config()
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

        svc = PaymentService(g.user.org_id)
        cfg = svc.save_payroll_config(
            cadence=cadence,
            anchor_day=anchor_day,
            anchor_date=anchor_date,
            timezone=(body.get("timezone") or None),
            updated_by=g.user.id,
        )

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
