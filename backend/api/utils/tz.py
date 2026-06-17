"""
Timezone helpers — single source of truth for org-anchored date math.

The DB stores all timestamps as naive UTC (via datetime.utcnow()). That's
fine for storage but wrong for aggregation windows: a session worked March
31 at 9pm Manila (= April 1 01:00 UTC) would otherwise get bucketed into
April for payroll, and a user in any non-UTC timezone would see the wrong
"today" window.

Two domains, two rules:

  - Per-user display ("today", "this week", "this month" on their own
    sidebar / widget / time page): use the user's browser-local TZ. The
    frontend sends ISO UTC instants aligned to their local midnights; the
    backend just filters clock_in >= X AND clock_in < Y. No helper needed
    — this module is only for the second case.

  - Org-wide aggregates run by Kaart admins (monthly payroll summary,
    "mark month paid" snapshots): anchor to America/Denver. Kaart HQ runs
    one monthly close; contractors all over the world get paid against
    that single clock.

If Kaart ever signs a second org with a different HQ timezone, move
ORG_TIMEZONE to a per-org DB column and thread the org_id → tz lookup
through the helpers below.
"""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# Kaart HQ is in Grand Junction, Colorado, which observes Mountain Time.
ORG_TIMEZONE = ZoneInfo("America/Denver")


def parse_filter_datetime(value):
    """Parse an ISO date or datetime from a filter body. Returns
    (naive_utc_datetime_or_None, was_date_only).

    Inputs we accept:
      - None / empty → (None, False)
      - "2026-04-23"                  → (2026-04-23 00:00 naive, True)
      - "2026-04-23T06:00:00Z"        → (2026-04-23 06:00 naive, False)
      - "2026-04-23T00:00:00-06:00"   → (2026-04-23 06:00 naive, False)
      - "2026-04-23T06:00:00"         → (2026-04-23 06:00 naive, False)  # tz-naive, assumed UTC

    Date-only callers should add timedelta(days=1) to the upper bound for
    an exclusive "[start, end+1d)" window (preserves legacy behavior).
    ISO-datetime callers should NOT add a day — the frontend already sent
    the user-local-midnight aligned exclusive bound.
    """
    if not value:
        return None, False
    is_date_only = "T" not in value
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt, is_date_only
    except (ValueError, AttributeError):
        try:
            return datetime.strptime(value, "%Y-%m-%d"), True
        except (ValueError, AttributeError):
            return None, False


def parse_date_range(start_value, end_value):
    """Parse start/end values into an inclusive (start_date, end_date) pair
    of date objects. Handles both input forms:

      - Plain date strings ("YYYY-MM-DD"): used as-is, inclusive on both ends.
      - ISO UTC datetime strings (from dateInputToLocalStart/EndIsoUtc): the
        end value is the exclusive next-day midnight, so 1 day is subtracted
        to recover the user's intended inclusive end date.

    Returns (start_date, end_date) or (None, None) if either value is invalid.
    Use this for any endpoint that queries a Date column.
    Use apply_date_range_filter for DateTime/timestamp columns.
    """
    start_dt, _ = parse_filter_datetime(start_value)
    end_dt, end_is_date_only = parse_filter_datetime(end_value)
    if start_dt is None or end_dt is None:
        return None, None
    start_date = start_dt.date()
    end_date = end_dt.date()
    if not end_is_date_only:
        end_date = end_date - timedelta(days=1)
    return start_date, end_date


def apply_date_range_filter(conditions, column, start_value, end_value):
    """Append start/end conditions against `column` to `conditions` list.

    Shared helper: parses the frontend-supplied start/end values via
    `parse_filter_datetime` and appends `column >= start`, `column < end`.
    Adds a day to the upper bound only when `end_value` was a date-only
    string (legacy input).
    """
    start_dt, _ = parse_filter_datetime(start_value)
    end_dt, end_was_date_only = parse_filter_datetime(end_value)
    if start_dt is not None:
        conditions.append(column >= start_dt)
    if end_dt is not None:
        if end_was_date_only:
            end_dt = end_dt + timedelta(days=1)
        conditions.append(column < end_dt)
    return start_dt, end_dt


def org_month_bounds_utc(year: int, month: int) -> tuple[datetime, datetime]:
    """Return [start, end_exclusive) for the given org-TZ month, as naive UTC."""
    start_local = datetime(year, month, 1, tzinfo=ORG_TIMEZONE)
    if month == 12:
        end_local = datetime(year + 1, 1, 1, tzinfo=ORG_TIMEZONE)
    else:
        end_local = datetime(year, month + 1, 1, tzinfo=ORG_TIMEZONE)
    return (
        start_local.astimezone(timezone.utc).replace(tzinfo=None),
        end_local.astimezone(timezone.utc).replace(tzinfo=None),
    )


def org_year_bounds_utc(year: int) -> tuple[datetime, datetime]:
    """Return [start, end_exclusive) for the given org-TZ year, as naive UTC."""
    start_local = datetime(year, 1, 1, tzinfo=ORG_TIMEZONE)
    end_local = datetime(year + 1, 1, 1, tzinfo=ORG_TIMEZONE)
    return (
        start_local.astimezone(timezone.utc).replace(tzinfo=None),
        end_local.astimezone(timezone.utc).replace(tzinfo=None),
    )


def _org_midnight_utc(d: date) -> datetime:
    """Local midnight of date ``d`` in ORG_TIMEZONE, as naive UTC."""
    return (
        datetime(d.year, d.month, d.day, tzinfo=ORG_TIMEZONE)
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )


def org_week_compare_bounds_utc(now_local: datetime = None):
    """Bounds for an apples-to-apples "this week vs last week" comparison.

    Anchored to ORG_TIMEZONE (Grand Junction / Mountain Time). Weeks start
    Sunday at local midnight. The previous-week window covers the *same number
    of fully completed days* that have elapsed in the current week, so a
    partial current week is never measured against a complete previous one.

    Returns a 4-tuple of naive-UTC datetimes::

        (week_start, today_start, prev_week_start, prev_week_compare_end)

      - [week_start, now)                          → current week so far
      - [week_start, today_start)                  → current week's completed days
      - [prev_week_start, prev_week_compare_end)   → same completed-day span,
                                                     previous week

    ``completed_days`` (the number of whole days elapsed since Sunday) is 0 on
    Sunday, in which case both completed-day windows are empty.
    """
    if now_local is None:
        now_local = datetime.now(ORG_TIMEZONE)
    today = now_local.date()
    # Sunday-start week: Python weekday() is Mon=0 … Sun=6.
    completed_days = (today.weekday() + 1) % 7
    week_start = today - timedelta(days=completed_days)
    prev_week_start = week_start - timedelta(days=7)
    return (
        _org_midnight_utc(week_start),
        _org_midnight_utc(today),
        _org_midnight_utc(prev_week_start),
        _org_midnight_utc(prev_week_start + timedelta(days=completed_days)),
    )


def org_month_compare_bounds_utc(now_local: datetime = None):
    """Bounds for an apples-to-apples "this month vs last month" comparison.

    Anchored to ORG_TIMEZONE (Grand Junction / Mountain Time). The
    previous-month window covers the *same number of fully completed days* that
    have elapsed in the current month, so a partial current month is never
    measured against a complete previous one.

    Returns a 4-tuple of naive-UTC datetimes::

        (month_start, today_start, prev_month_start, prev_month_compare_end)

      - [month_start, now)                          → current month so far
      - [month_start, today_start)                  → current month's completed days
      - [prev_month_start, prev_month_compare_end)  → same completed-day span,
                                                      previous month

    ``completed_days`` is today's day-of-month minus 1 (0 on the 1st). When the
    previous month is shorter than the current one, the previous-month window is
    clamped to that month's end rather than bleeding into the current month.
    """
    if now_local is None:
        now_local = datetime.now(ORG_TIMEZONE)
    today = now_local.date()
    completed_days = today.day - 1
    month_start, _ = org_month_bounds_utc(today.year, today.month)
    if today.month == 1:
        prev_year, prev_month = today.year - 1, 12
    else:
        prev_year, prev_month = today.year, today.month - 1
    prev_month_start, prev_month_end = org_month_bounds_utc(prev_year, prev_month)
    prev_compare_end = _org_midnight_utc(
        date(prev_year, prev_month, 1) + timedelta(days=completed_days)
    )
    # Shorter previous month: keep the window inside that month.
    prev_compare_end = min(prev_compare_end, prev_month_end)
    return (
        month_start,
        _org_midnight_utc(today),
        prev_month_start,
        prev_compare_end,
    )
