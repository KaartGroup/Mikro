#!/usr/bin/env python3
"""
HourlyRateHistoryService — time-bounded hourly rates for users.

Each user may have multiple rates over time. Only one rate is active at any
given date (enforced at the application layer via overlap validation).

Usage::

    svc = HourlyRateHistoryService()
    entry = svc.create_rate(user_id, org_id, 25.00, date(2026, 6, 1), None, created_by="admin|123")
    rate  = svc.get_active_rate(user_id, date.today())
    rows  = svc.rate_map_for_users([uid1, uid2], date.today())
"""

import calendar
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import or_

from ..database import HourlyPayment, PaymentCycleStatus, UserHourlyRate, db

# Sentinel far-future date used for open-ended range comparisons.
_MAX_DATE = date(9999, 12, 31)


class OverlapError(ValueError):
    """Raised when a proposed rate range overlaps an existing one."""


class DeleteGuardError(ValueError):
    """Raised when a rate entry cannot be deleted because it covers a paid cycle."""


class HourlyRateHistoryService:

    def get_active_rate(self, user_id: str, for_date: date) -> UserHourlyRate | None:
        """Return the rate active on ``for_date``, or None."""
        return (
            UserHourlyRate.query.filter(
                UserHourlyRate.user_id == user_id,
                UserHourlyRate.start_date <= for_date,
                or_(
                    UserHourlyRate.end_date.is_(None),
                    UserHourlyRate.end_date >= for_date,
                ),
            )
            .order_by(UserHourlyRate.start_date.desc())
            .first()
        )

    def get_rate_history(self, user_id: str) -> list:
        """All rate entries for a user, newest first."""
        return (
            UserHourlyRate.query.filter_by(user_id=user_id)
            .order_by(UserHourlyRate.start_date.desc())
            .all()
        )

    def rate_map_for_users(self, user_ids: list, for_date: date) -> dict:
        """Bulk-fetch active rates for multiple users on ``for_date``.

        Returns ``{user_id: float}`` — users with no active rate are absent.
        Avoids N+1 by fetching all candidates in one query then selecting
        the highest ``start_date <= for_date`` per user in Python.
        """
        if not user_ids:
            return {}
        rows = (
            UserHourlyRate.query.filter(
                UserHourlyRate.user_id.in_(user_ids),
                UserHourlyRate.start_date <= for_date,
                or_(
                    UserHourlyRate.end_date.is_(None),
                    UserHourlyRate.end_date >= for_date,
                ),
            )
            .order_by(UserHourlyRate.user_id, UserHourlyRate.start_date.desc())
            .all()
        )
        seen: set[str] = set()
        result: dict[str, float] = {}
        for row in rows:
            if row.user_id not in seen:
                seen.add(row.user_id)
                result[row.user_id] = float(row.rate)
        return result

    def create_rate(
        self,
        user_id: str,
        org_id: str | None,
        rate: float | Decimal,
        start_date: date,
        end_date: date | None,
        created_by: str,
        notes: str | None = None,
    ) -> UserHourlyRate:
        """Insert a new rate entry after validating there is no overlap.

        Raises ``OverlapError`` if the proposed [start, end] range overlaps
        any existing entry for the same user.
        """
        self._check_overlap(user_id, start_date, end_date, exclude_id=None)
        entry = UserHourlyRate(
            user_id=user_id,
            org_id=org_id,
            rate=Decimal(str(rate)),
            start_date=start_date,
            end_date=end_date,
            created_by=created_by,
            created_at=datetime.now(timezone.utc),
            notes=notes,
        )
        db.session.add(entry)
        db.session.commit()
        return entry

    def set_current_rate(
        self,
        user_id: str,
        org_id: str | None,
        rate: float | Decimal | None,
        created_by: str,
        start_date: date,
        notes: str | None = None,
    ) -> "UserHourlyRate | None":
        """Replace the rate active on ``start_date``.

        Closes the existing rate that covers ``start_date`` by setting its
        ``end_date`` to ``start_date - 1 day``, then creates a new open-ended
        entry from ``start_date``.  Passing ``rate=None`` only closes the
        existing entry (removes pay from that date forward).
        Returns the new entry, or None when rate is None.
        """
        close_at = start_date - timedelta(days=1)

        current = self.get_active_rate(user_id, start_date)
        if current:
            if (
                rate is not None
                and float(current.rate) == float(rate)
                and current.start_date == start_date
            ):
                return current  # nothing changed
            current.end_date = close_at
            db.session.flush()

        if rate is None:
            db.session.commit()
            return None

        self._check_overlap(user_id, start_date, None, exclude_id=None)

        entry = UserHourlyRate(
            user_id=user_id,
            org_id=org_id,
            rate=Decimal(str(rate)),
            start_date=start_date,
            end_date=None,
            created_by=created_by,
            created_at=datetime.now(timezone.utc),
            notes=notes,
        )
        db.session.add(entry)
        db.session.commit()
        return entry

    def delete_rate(self, rate_id: int, user_id: str) -> None:
        """Delete a rate entry.

        Raises ``DeleteGuardError`` if any paid HourlyPayment or paid
        PaymentCycleStatus row falls within this entry's date range.
        Raises ``ValueError`` if the entry is not found or doesn't belong
        to ``user_id``.
        """
        entry = UserHourlyRate.query.filter_by(id=rate_id, user_id=user_id).first()
        if not entry:
            raise ValueError(f"Rate entry {rate_id} not found for user {user_id}")

        self._check_delete_guard(entry)
        db.session.delete(entry)
        db.session.commit()

    # ─── Internal helpers ─────────────────────────────────────────────────

    def _check_overlap(
        self, user_id: str, start: date, end: date | None, exclude_id: int | None
    ) -> None:
        """Raise OverlapError if [start, end] overlaps any existing entry."""
        proposed_end = end or _MAX_DATE

        q = UserHourlyRate.query.filter(UserHourlyRate.user_id == user_id)
        if exclude_id is not None:
            q = q.filter(UserHourlyRate.id != exclude_id)
        existing = q.all()

        for row in existing:
            row_end = row.end_date or _MAX_DATE
            # Two ranges [a, b] and [c, d] overlap when a <= d AND b >= c.
            if start <= row_end and proposed_end >= row.start_date:
                raise OverlapError(
                    f"Rate {row.start_date}–{row.end_date or 'open'} "
                    f"overlaps the proposed range {start}–{end or 'open'}"
                )

    def _check_delete_guard(self, entry: UserHourlyRate) -> None:
        """Raise DeleteGuardError if a paid cycle falls within entry's range."""
        e_end = entry.end_date or _MAX_DATE

        # Check HourlyPayment (old monthly-rate system)
        paid_hp = (
            HourlyPayment.query.filter(
                HourlyPayment.user_id == entry.user_id,
                HourlyPayment.paid.is_(True),
            )
            .all()
        )
        for hp in paid_hp:
            # Use full month-range overlap: [entry.start_date, e_end] overlaps
            # [month_start, month_end] when start <= month_end AND e_end >= month_start.
            month_start = date(hp.year, hp.month, 1)
            month_end = date(hp.year, hp.month, calendar.monthrange(hp.year, hp.month)[1])
            if entry.start_date <= month_end and e_end >= month_start:
                raise DeleteGuardError(
                    f"Cannot delete: paid HourlyPayment exists for "
                    f"{hp.year}-{hp.month:02d} which falls within this rate's range."
                )

        # Check PaymentCycleStatus (v1 payments system)
        paid_pcs = (
            PaymentCycleStatus.query.filter(
                PaymentCycleStatus.user_id == entry.user_id,
                PaymentCycleStatus.status == "paid",
            )
            .all()
        )
        for pcs in paid_pcs:
            if entry.start_date <= pcs.cycle_start <= e_end:
                raise DeleteGuardError(
                    f"Cannot delete: paid cycle {pcs.cycle_start}–{pcs.cycle_end} "
                    f"falls within this rate's range."
                )
