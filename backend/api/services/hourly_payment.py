#!/usr/bin/env python3
"""
HourlyPaymentService — monthly pay snapshots for hourly contractors.

Extracted from ``api/views/TimeTracking.py``. Handles the HourlyPayment
record lifecycle: hourly summary computation, rate management, and
monthly paid/unpaid toggling.

Usage::

    svc = HourlyPaymentService(g.user.org_id)
    result = svc.hourly_summary(contractor_ids, year)
    svc.mark_month_paid(user, year, month, paid_by=g.user.id)
"""

from datetime import date, datetime, timezone

from sqlalchemy import func

from ..database import HourlyPayment, TimeEntry, User, db
from ..utils.tz import org_month_bounds_utc
from .hourly_rate_history import HourlyRateHistoryService


class HourlyPaymentService:
    """Monthly pay snapshot operations for hourly contractors, org-scoped."""

    def __init__(self, org_id: str):
        self.org_id = org_id

    def hourly_summary(self, contractor_ids: list, year: int) -> list[dict]:
        """Build the per-contractor monthly hours/earnings summary for a year.

        ``contractor_ids`` should already be filtered to the viewer's scope
        (team_admin narrowing happens in the view before calling this).

        Returns a list of contractor dicts, one per contractor, each with a
        ``months`` map keyed 1–12 and a ``yearTotal`` rollup.
        """
        if not contractor_ids:
            return []

        contractors = User.query.filter(
            User.org_id == self.org_id,
            User.id.in_(contractor_ids),
        ).all()

        # Aggregate time entries per user per month (org-TZ anchored windows)
        time_lookup: dict[str, dict[int, int]] = {}
        for m in range(1, 13):
            m_start, m_end = org_month_bounds_utc(year, m)
            rows = (
                db.session.query(
                    TimeEntry.user_id,
                    func.sum(TimeEntry.duration_seconds).label("total_seconds"),
                )
                .filter(
                    TimeEntry.org_id == self.org_id,
                    TimeEntry.status == "completed",
                    TimeEntry.clock_in >= m_start,
                    TimeEntry.clock_in < m_end,
                    TimeEntry.user_id.in_(contractor_ids),
                )
                .group_by(TimeEntry.user_id)
                .all()
            )
            for row in rows:
                time_lookup.setdefault(row.user_id, {})[m] = row.total_seconds or 0

        payment_lookup: dict[tuple, HourlyPayment] = {}
        for hp in HourlyPayment.query.filter(
            HourlyPayment.org_id == self.org_id,
            HourlyPayment.year == year,
        ).all():
            payment_lookup[(hp.user_id, hp.month)] = hp

        rate_svc = HourlyRateHistoryService()
        today = date.today()

        result = []
        for c in contractors:
            months = {}
            year_total_seconds = 0
            year_total_earnings = 0.0

            for m in range(1, 13):
                hp = payment_lookup.get((c.id, m))
                if hp and hp.paid:
                    secs = hp.total_seconds
                    hrs = round(secs / 3600, 2)
                    earnings = hp.amount_due
                    months[str(m)] = {
                        "totalSeconds": secs,
                        "hours": hrs,
                        "earnings": round(earnings, 2),
                        "paid": True,
                        "paidAt": hp.paid_at.isoformat() if hp.paid_at else None,
                        "notes": hp.notes,
                    }
                else:
                    secs = time_lookup.get(c.id, {}).get(m, 0)
                    hrs = round(secs / 3600, 2)
                    # Use the rate that was/is active on the first of the month.
                    for_date = date(year, m, 1) if date(year, m, 1) <= today else today
                    rate_row = rate_svc.get_active_rate(c.id, for_date)
                    rate = float(rate_row.rate) if rate_row else 0
                    earnings = round(hrs * rate, 2)
                    months[str(m)] = {
                        "totalSeconds": secs,
                        "hours": hrs,
                        "earnings": earnings,
                        "paid": False,
                        "paidAt": None,
                        "notes": hp.notes if hp else None,
                    }

                year_total_seconds += secs
                year_total_earnings += earnings

            current_rate_row = rate_svc.get_active_rate(c.id, today)
            result.append({
                "userId": c.id,
                "name": c.full_name,
                "osmUsername": c.osm_username or "",
                "country": c.country or "",
                "hourlyRate": float(current_rate_row.rate) if current_rate_row else None,
                "months": months,
                "yearTotal": {
                    "totalSeconds": year_total_seconds,
                    "hours": round(year_total_seconds / 3600, 2),
                    "earnings": round(year_total_earnings, 2),
                },
            })

        return result

    def mark_month_paid(
        self,
        user: User,
        year: int,
        month: int,
        paid_by: str,
        paid: bool = True,
        notes: str = None,
    ) -> HourlyPayment | None:
        """Create or update the HourlyPayment snapshot for a user's month.

        When ``paid=True``: aggregates completed TimeEntry seconds for the
        month window (org-TZ anchored), snapshots the current rate and amount,
        and upserts the HourlyPayment row.

        When ``paid=False``: clears paid/paid_at/paid_by on the existing row
        (no-op if the row doesn't exist).

        Returns the HourlyPayment row, or None if unpaid and no row exists.
        """
        hp = HourlyPayment.query.filter_by(
            user_id=user.id, year=year, month=month
        ).first()

        if paid:
            month_start, month_end = org_month_bounds_utc(year, month)
            total_seconds = (
                db.session.query(
                    func.coalesce(func.sum(TimeEntry.duration_seconds), 0)
                )
                .filter(
                    TimeEntry.user_id == user.id,
                    TimeEntry.org_id == self.org_id,
                    TimeEntry.status == "completed",
                    TimeEntry.clock_in >= month_start,
                    TimeEntry.clock_in < month_end,
                )
                .scalar()
            ) or 0

            # Resolve the rate active on the first of the paid month.
            rate_row = HourlyRateHistoryService().get_active_rate(
                user.id, date(year, month, 1)
            )
            rate = float(rate_row.rate) if rate_row else 0
            amount = round((total_seconds / 3600) * rate, 2)
            now = datetime.now(timezone.utc)

            if hp:
                hp.total_seconds = total_seconds
                hp.hourly_rate = rate
                hp.amount_due = amount
                hp.paid = True
                hp.paid_at = now
                hp.paid_by = paid_by
                if notes is not None:
                    hp.notes = notes
            else:
                hp = HourlyPayment(
                    user_id=user.id,
                    org_id=self.org_id,
                    year=year,
                    month=month,
                    total_seconds=total_seconds,
                    hourly_rate=rate,
                    amount_due=amount,
                    paid=True,
                    paid_at=now,
                    paid_by=paid_by,
                    notes=notes,
                )
                db.session.add(hp)
        else:
            if hp:
                hp.paid = False
                hp.paid_at = None
                hp.paid_by = None
                if notes is not None:
                    hp.notes = notes

        db.session.commit()
        return hp
