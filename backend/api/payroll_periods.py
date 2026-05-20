"""Payroll cycle period generation — pure, deterministic, stdlib only.

Single source of truth for turning an org's cadence config
(monthly / semi_monthly / bi_weekly + anchor) into concrete
``[start, end]`` date windows. Used by the payroll forecast and,
later, by the cycle-picker presets.

A "period" is an inclusive ``(start_date, end_date)`` pair. The period
*containing* a reference date is the cycle that ``ref`` falls in.
"""

from calendar import monthrange
from datetime import date, timedelta

CADENCES = {"monthly", "semi_monthly", "bi_weekly"}


def _add_months(d: date, n: int) -> date:
    """Shift a date by n months, clamping the day to the target month."""
    total = d.month - 1 + n
    year = d.year + total // 12
    month = total % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


def _eom(d: date) -> date:
    return date(d.year, d.month, monthrange(d.year, d.month)[1])


def _period_containing(cadence, ref, anchor_day, anchor_date):
    """Return the inclusive (start, end) of the period that holds ``ref``."""
    if cadence == "monthly":
        a = anchor_day or 1
        a = max(1, min(28, a))
        if ref.day >= a:
            start = date(ref.year, ref.month, a)
        else:
            start = _add_months(date(ref.year, ref.month, a), -1)
        end = _add_months(start, 1) - timedelta(days=1)
        return start, end

    if cadence == "semi_monthly":
        if ref.day <= 15:
            return date(ref.year, ref.month, 1), date(ref.year, ref.month, 15)
        return date(ref.year, ref.month, 16), _eom(ref)

    if cadence == "bi_weekly":
        if anchor_date is None:
            raise ValueError("bi_weekly requires anchor_date")
        delta = (ref - anchor_date).days
        k = delta // 14  # floor division → handles ref before anchor too
        start = anchor_date + timedelta(days=14 * k)
        return start, start + timedelta(days=13)

    raise ValueError(f"unknown cadence: {cadence}")


def _advance(cadence, start, anchor_day):
    """Start date of the period immediately after the one beginning at ``start``."""
    if cadence == "monthly":
        return _add_months(start, 1)
    if cadence == "semi_monthly":
        if start.day == 1:
            return date(start.year, start.month, 16)
        # was the 16th → first of next month
        return _add_months(date(start.year, start.month, 1), 1)
    if cadence == "bi_weekly":
        return start + timedelta(days=14)
    raise ValueError(f"unknown cadence: {cadence}")


def _retreat(cadence, start, anchor_day):
    """Start date of the period immediately before the one at ``start``."""
    if cadence == "monthly":
        return _add_months(start, -1)
    if cadence == "semi_monthly":
        if start.day == 16:
            return date(start.year, start.month, 1)
        prev = _add_months(date(start.year, start.month, 1), -1)
        return date(prev.year, prev.month, 16)
    if cadence == "bi_weekly":
        return start - timedelta(days=14)
    raise ValueError(f"unknown cadence: {cadence}")


def generate_cycles(
    cadence: str,
    *,
    anchor_day: int | None = None,
    anchor_date: date | None = None,
    ref: date,
    count: int,
    direction: str,
):
    """Generate ``count`` inclusive (start, end) periods, ascending.

    direction="future": starts with the period containing ``ref`` (the
        *current* cycle), then each subsequent cycle.
    direction="past": the ``count`` completed cycles strictly before the
        current one, returned oldest → newest.
    """
    if cadence not in CADENCES:
        raise ValueError(f"unknown cadence: {cadence}")
    if count <= 0:
        return []

    cur_start, cur_end = _period_containing(
        cadence, ref, anchor_day, anchor_date
    )

    out: list[tuple[date, date]] = []
    if direction == "future":
        s = cur_start
        for _ in range(count):
            out.append((s, _advance(cadence, s, anchor_day) - timedelta(days=1)))
            s = _advance(cadence, s, anchor_day)
        return out

    if direction == "past":
        s = cur_start
        for _ in range(count):
            s = _retreat(cadence, s, anchor_day)
            end = _advance(cadence, s, anchor_day) - timedelta(days=1)
            out.append((s, end))
        out.reverse()  # oldest → newest
        return out

    raise ValueError(f"direction must be 'future' or 'past', got {direction!r}")
