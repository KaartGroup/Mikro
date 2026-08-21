#!/usr/bin/env python3
"""
AvailabilityService — recurring weekly availability + date-specific exceptions.

This module is the SINGLE SOURCE OF TRUTH for availability time math. The
``/api/availability/*`` endpoints and (Phase 6) meeting-poll slot scoring both
resolve availability through the pure functions here. Do NOT reimplement the
local-wall-clock -> UTC conversion anywhere else.

Storage model (see also the model docstrings in ``database/core.py``):
  - Weekly blocks are LOCAL WALL-CLOCK: ``day_of_week`` (0=Mon) plus minute
    offsets from local midnight, interpreted in the user's own
    ``User.timezone``. They are NOT UTC instants — "09:00-17:00" must stay
    09:00-17:00 across DST transitions.
  - Resolving a block against a concrete date yields a real UTC instant pair.
    Everything downstream (overlap, poll scoring, rendering) works in UTC.

The Flask view keeps HTTP parsing, auth decorators, and response building; this
class never touches ``flask.g`` and never returns HTTP shapes.
"""

from collections import Counter
from datetime import date as date_cls, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..database import UserAvailability, UserAvailabilityException, db

# ── Domain constants ────────────────────────────────────────────────────

DAYS_IN_WEEK = 7
MINUTES_IN_DAY = 1440

KIND_AVAILABLE = "available"
KIND_PREFERRED = "preferred"
BLOCK_KINDS = frozenset({KIND_AVAILABLE, KIND_PREFERRED})

EXCEPTION_UNAVAILABLE = "unavailable"
EXCEPTION_AVAILABLE = "available"
EXCEPTION_KINDS = frozenset({EXCEPTION_UNAVAILABLE, EXCEPTION_AVAILABLE})

DEFAULT_TIMEZONE = "UTC"

# Mon-Fri 09:00-17:00 — seeded for a user who has never set a grid.
DEFAULT_WEEKLY_BLOCKS = tuple(
    {
        "day_of_week": dow,
        "start_minute": 9 * 60,
        "end_minute": 17 * 60,
        "kind": KIND_AVAILABLE,
    }
    for dow in range(5)
)

# Guards against a caller asking for an unbounded range.
MAX_RANGE_DAYS = 90

# A full 7-day grid at 15-minute resolution is 672 blocks; anything past
# this is a malformed or hostile client, not a real schedule.
MAX_BLOCKS_PER_GRID = 1000

# Bounds the sweep-line and the IN () clause on /overlap.
MAX_USERS_PER_OVERLAP = 200


# ── Pure helpers: validation ────────────────────────────────────────────


def validate_block(block: dict):
    """Return an error string for an invalid weekly block, else ``None``."""
    try:
        dow = int(block["day_of_week"])
        start = int(block["start_minute"])
        end = int(block["end_minute"])
    except (KeyError, TypeError, ValueError):
        return "each block needs integer day_of_week, start_minute, end_minute"

    if not 0 <= dow <= 6:
        return f"day_of_week must be 0-6, got {dow}"
    if not 0 <= start < end <= MINUTES_IN_DAY:
        return (
            "require 0 <= start_minute < end_minute <= 1440, got "
            f"{start}-{end} (a block may not cross midnight — use two blocks)"
        )

    kind = block.get("kind", KIND_AVAILABLE)
    if kind not in BLOCK_KINDS:
        return f"kind must be one of {sorted(BLOCK_KINDS)}, got {kind!r}"
    return None


def validate_exception(kind: str, start_minute, end_minute):
    """Return an error string for an invalid exception, else ``None``."""
    if kind not in EXCEPTION_KINDS:
        return f"kind must be one of {sorted(EXCEPTION_KINDS)}, got {kind!r}"

    if start_minute is None and end_minute is None:
        return None  # whole-day exception
    if start_minute is None or end_minute is None:
        return "start_minute and end_minute must both be set, or both omitted"

    try:
        start = int(start_minute)
        end = int(end_minute)
    except (TypeError, ValueError):
        return "start_minute and end_minute must be integers"
    if not 0 <= start < end <= MINUTES_IN_DAY:
        return f"require 0 <= start_minute < end_minute <= 1440, got {start}-{end}"
    return None


def resolve_timezone(tz_name):
    """Return a usable :class:`ZoneInfo`, falling back to UTC.

    ``User.timezone`` is nullable (users predating country-based auto-fill, or
    users with no country), so every read path must tolerate ``None``.
    """
    if not tz_name:
        return ZoneInfo(DEFAULT_TIMEZONE)
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TIMEZONE)


# ── Pure helpers: interval algebra (minutes within one local day) ───────


def merge_ranges(ranges):
    """Merge overlapping/adjacent ``(start, end)`` minute ranges."""
    out = []
    for start, end in sorted(ranges):
        if out and start <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return [tuple(r) for r in out]


def subtract_range(ranges, cut_start, cut_end):
    """Remove ``(cut_start, cut_end)`` from a list of minute ranges."""
    out = []
    for start, end in ranges:
        if cut_end <= start or cut_start >= end:
            out.append((start, end))
            continue
        if start < cut_start:
            out.append((start, cut_start))
        if cut_end < end:
            out.append((cut_end, end))
    return out


def normalize_blocks(blocks):
    """Validated blocks -> merged, sorted blocks, grouped by (day, kind).

    Overlapping same-kind blocks on the same day collapse into one, so the
    stored grid is always canonical regardless of how the UI painted it.
    """
    grouped = {}
    for block in blocks:
        key = (int(block["day_of_week"]), block.get("kind", KIND_AVAILABLE))
        grouped.setdefault(key, []).append(
            (int(block["start_minute"]), int(block["end_minute"]))
        )

    out = []
    for (dow, kind), ranges in sorted(grouped.items()):
        for start, end in merge_ranges(ranges):
            out.append(
                {
                    "day_of_week": dow,
                    "start_minute": start,
                    "end_minute": end,
                    "kind": kind,
                }
            )
    return out


# ── Pure helpers: local wall-clock -> UTC ───────────────────────────────


def local_minute_to_utc(day: date_cls, minute: int, tz) -> datetime:
    """Convert a local wall-clock minute-of-day on ``day`` to a UTC instant.

    ``minute == 1440`` means local midnight at the *end* of ``day``.

    DST note: a local time that does not exist (spring-forward gap) or occurs
    twice (fall-back overlap) is resolved by :mod:`zoneinfo`'s ``fold=0``
    default. Declared working hours essentially never straddle a 02:00
    transition, so this is deterministic rather than merely tolerable.
    """
    if minute >= MINUTES_IN_DAY:
        day = day + timedelta(days=1)
        minute -= MINUTES_IN_DAY
    hour, mins = divmod(minute, 60)
    local = datetime(day.year, day.month, day.day, hour, mins, tzinfo=tz)
    return local.astimezone(timezone.utc)


def clip_intervals(intervals, clip_start: datetime, clip_end: datetime):
    """Trim UTC intervals to ``[clip_start, clip_end)``, dropping empties."""
    out = []
    for start, end in intervals:
        trimmed_start = max(start, clip_start)
        trimmed_end = min(end, clip_end)
        if trimmed_end > trimmed_start:
            out.append((trimmed_start, trimmed_end))
    return out


def daterange(start_date: date_cls, end_date: date_cls):
    """Yield each date from ``start_date`` to ``end_date`` inclusive."""
    current = start_date
    while current <= end_date:
        yield current
        current += timedelta(days=1)


def resolve_intervals(
    blocks,
    exceptions,
    tz_name,
    start_date: date_cls,
    end_date: date_cls,
    kinds=None,
):
    """Concrete UTC ``(start, end)`` intervals for ONE user over a date range.

    ``blocks`` / ``exceptions`` are ORM rows (or any objects exposing the same
    attributes). ``kinds`` optionally restricts which block kinds count — pass
    ``{KIND_PREFERRED}`` to resolve only core hours.

    Exceptions are applied per-date: ``unavailable`` subtracts (a whole-day
    exception clears the date entirely), ``available`` adds.
    """
    tz = resolve_timezone(tz_name)

    by_day = {}
    for block in blocks:
        if kinds is not None and block.kind not in kinds:
            continue
        by_day.setdefault(block.day_of_week, []).append(
            (block.start_minute, block.end_minute)
        )

    exc_by_date = {}
    for exc in exceptions:
        exc_by_date.setdefault(exc.date, []).append(exc)

    # When resolving a restricted kind (e.g. core hours only), an "I am also
    # free then" exception must NOT manufacture preferred hours — otherwise a
    # whole-day `available` exception would report 24h of core availability.
    # `unavailable` still applies: PTO removes preferred hours too.
    additions_apply = kinds is None or KIND_AVAILABLE in kinds

    intervals = []
    for day in daterange(start_date, end_date):
        ranges = merge_ranges(by_day.get(day.weekday(), []))

        # Additions first, then subtractions, so the result does not depend on
        # DB row order when a date carries both. "Unavailable wins" is the
        # intended precedence: PTO must beat an extra-hours entry.
        day_exceptions = exc_by_date.get(day, [])
        if additions_apply:
            for exc in day_exceptions:
                if exc.kind != EXCEPTION_AVAILABLE:
                    continue
                whole_day = exc.start_minute is None or exc.end_minute is None
                addition = (
                    (0, MINUTES_IN_DAY)
                    if whole_day
                    else (exc.start_minute, exc.end_minute)
                )
                ranges = merge_ranges(list(ranges) + [addition])

        for exc in day_exceptions:
            if exc.kind != EXCEPTION_UNAVAILABLE:
                continue
            whole_day = exc.start_minute is None or exc.end_minute is None
            if whole_day:
                ranges = []
                break
            ranges = subtract_range(ranges, exc.start_minute, exc.end_minute)

        for start, end in ranges:
            intervals.append(
                (
                    local_minute_to_utc(day, start, tz),
                    local_minute_to_utc(day, end, tz),
                )
            )

    intervals.sort()
    return intervals


def intersect_intervals(per_user, threshold=None):
    """Sweep-line intersection across users.

    ``per_user`` maps ``user_id -> [(start_utc, end_utc), ...]``. Returns
    ``[{"start", "end", "count", "user_ids"}]`` for every maximal window where
    at least ``threshold`` users are simultaneously available (default: all).

    Adjacent segments are merged only when the participating set is identical,
    so a window never silently changes membership mid-way.

    ``active`` is a :class:`~collections.Counter`, NOT a set: one user may
    contribute overlapping intervals (poll options in a later phase are
    arbitrary UTC instants, unlike the per-day-merged availability that feeds
    this today). With a set, the first close event would drop a user whose
    longer interval is still open, truncating the window.
    """
    if not per_user:
        return []
    if threshold is None:
        threshold = len(per_user)

    events = []
    for user_id, intervals in per_user.items():
        for start, end in intervals:
            if end <= start:
                continue
            events.append((start, 1, user_id))
            events.append((end, -1, user_id))
    if not events:
        return []

    # -1 sorts before +1 at the same instant, so a window that ends exactly
    # where another begins never registers as a zero-length overlap.
    events.sort(key=lambda e: (e[0], e[1]))

    out = []
    active = Counter()
    distinct = 0  # users with at least one interval currently open
    # Non-None only while the running set already meets the threshold, so its
    # presence *is* the "a window is open" flag.
    segment_start = None
    for moment, delta, user_id in events:
        if segment_start is not None and moment > segment_start:
            _append_segment(out, segment_start, moment, active)

        if delta == 1:
            if active[user_id] == 0:
                distinct += 1
            active[user_id] += 1
        else:
            active[user_id] -= 1
            if active[user_id] <= 0:
                del active[user_id]
                distinct -= 1

        segment_start = moment if distinct >= threshold else None

    return out


def _append_segment(out, start, end, members):
    """Append a window, merging into the previous one when membership matches."""
    user_ids = sorted(members)
    if out and out[-1]["end"] == start and out[-1]["user_ids"] == user_ids:
        out[-1]["end"] = end
        return
    out.append(
        {
            "start": start,
            "end": end,
            "count": len(user_ids),
            "user_ids": user_ids,
        }
    )


# ── Service ─────────────────────────────────────────────────────────────


class AvailabilityService:
    """Database operations for user availability.

    Construct with the current viewer's ``org_id``; writes are stamped with it.
    """

    def __init__(self, org_id: str):
        self.org_id = org_id

    # ── Reads ───────────────────────────────────────────────────────

    def get_blocks(self, user_id: str) -> list:
        """A user's recurring weekly blocks, ordered for stable rendering."""
        return (
            UserAvailability.query.filter(UserAvailability.user_id == user_id)
            .order_by(
                UserAvailability.day_of_week.asc(),
                UserAvailability.start_minute.asc(),
            )
            .all()
        )

    def get_exceptions(
        self, user_id: str, start_date: date_cls = None, end_date: date_cls = None
    ) -> list:
        """A user's date exceptions, optionally limited to a date range."""
        q = UserAvailabilityException.query.filter(
            UserAvailabilityException.user_id == user_id
        )
        if start_date is not None:
            q = q.filter(UserAvailabilityException.date >= start_date)
        if end_date is not None:
            q = q.filter(UserAvailabilityException.date <= end_date)
        return q.order_by(
            UserAvailabilityException.date.asc(),
            UserAvailabilityException.id.asc(),
        ).all()

    def get_blocks_for_users(self, user_ids) -> dict:
        """``user_id -> [blocks]`` for many users in one query."""
        ids = list(user_ids)
        out = {uid: [] for uid in ids}
        if not ids:
            return out
        rows = (
            UserAvailability.query.filter(UserAvailability.user_id.in_(ids))
            .order_by(
                UserAvailability.day_of_week.asc(),
                UserAvailability.start_minute.asc(),
            )
            .all()
        )
        for row in rows:
            out[row.user_id].append(row)
        return out

    def get_exceptions_for_users(
        self, user_ids, start_date: date_cls = None, end_date: date_cls = None
    ) -> dict:
        """``user_id -> [exceptions]`` for many users in one query."""
        ids = list(user_ids)
        out = {uid: [] for uid in ids}
        if not ids:
            return out
        q = UserAvailabilityException.query.filter(
            UserAvailabilityException.user_id.in_(ids)
        )
        if start_date is not None:
            q = q.filter(UserAvailabilityException.date >= start_date)
        if end_date is not None:
            q = q.filter(UserAvailabilityException.date <= end_date)
        ordered = q.order_by(
            UserAvailabilityException.date.asc(),
            UserAvailabilityException.id.asc(),
        )
        for row in ordered.all():
            out[row.user_id].append(row)
        return out

    # ── Writes ──────────────────────────────────────────────────────

    def set_weekly(self, user_id: str, blocks) -> list:
        """Replace a user's entire weekly grid. Idempotent.

        Callers MUST validate with :func:`validate_block` first; this method
        normalizes (merges overlaps) but does not re-validate.
        """
        normalized = normalize_blocks(blocks)

        UserAvailability.query.filter(UserAvailability.user_id == user_id).delete(
            synchronize_session=False
        )

        for block in normalized:
            db.session.add(
                UserAvailability(
                    user_id=user_id,
                    org_id=self.org_id,
                    day_of_week=block["day_of_week"],
                    start_minute=block["start_minute"],
                    end_minute=block["end_minute"],
                    kind=block["kind"],
                )
            )
        db.session.commit()
        return self.get_blocks(user_id)

    def add_exception(
        self,
        user_id: str,
        day: date_cls,
        kind: str,
        start_minute=None,
        end_minute=None,
        note: str = None,
    ):
        """Create and return one date exception."""
        return UserAvailabilityException.create(
            user_id=user_id,
            org_id=self.org_id,
            date=day,
            kind=kind,
            start_minute=start_minute,
            end_minute=end_minute,
            note=note,
        )

    def delete_exception(self, user_id: str, exception_id: int) -> bool:
        """Delete one exception. ``False`` when absent or owned by someone else."""
        row = UserAvailabilityException.query.filter(
            UserAvailabilityException.id == exception_id,
            UserAvailabilityException.user_id == user_id,
        ).first()
        if row is None:
            return False
        db.session.delete(row)
        db.session.commit()
        return True

    # ── Resolution ──────────────────────────────────────────────────

    def resolve_for_users(
        self, users, start_date: date_cls, end_date: date_cls, kinds=None
    ) -> dict:
        """``user_id -> [(start_utc, end_utc)]`` over the requested UTC window.

        ``users`` is an iterable of ORM ``User`` rows (needs ``.id`` and
        ``.timezone``). One query for blocks, one for exceptions — no N+1.

        The requested range is a span of **UTC days**:
        ``[start_date 00:00Z, end_date+1 00:00Z)``.

        Each user's *local* day maps to a different UTC span, so resolving only
        the local dates inside the range would produce ragged, unequal UTC
        coverage and silently drop genuine overlap at the edges — e.g. a Denver
        Sunday 18:00 block and a Tokyo Monday 09:00 block are both 00:00Z on
        Monday, but the Denver block sits on local Sunday and would vanish from
        a Monday-only query. So we resolve one local day either side and then
        clip the result to the requested UTC bounds.
        """
        user_list = list(users)
        ids = [u.id for u in user_list]

        padded_start = start_date - timedelta(days=1)
        padded_end = end_date + timedelta(days=1)

        blocks = self.get_blocks_for_users(ids)
        exceptions = self.get_exceptions_for_users(ids, padded_start, padded_end)

        utc = timezone.utc
        clip_start = datetime(
            start_date.year, start_date.month, start_date.day, tzinfo=utc
        )
        clip_end_date = end_date + timedelta(days=1)
        clip_end = datetime(
            clip_end_date.year, clip_end_date.month, clip_end_date.day, tzinfo=utc
        )

        return {
            user.id: clip_intervals(
                resolve_intervals(
                    blocks.get(user.id, []),
                    exceptions.get(user.id, []),
                    user.timezone,
                    padded_start,
                    padded_end,
                    kinds=kinds,
                ),
                clip_start,
                clip_end,
            )
            for user in user_list
        }
