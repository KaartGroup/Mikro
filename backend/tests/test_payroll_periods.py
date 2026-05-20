"""
Unit tests for the payroll-cycle period generator (api/payroll_periods.py).

Pure stdlib-only date math — no DB, no Flask context, no mocking. The
test suite walks each cadence (monthly / semi_monthly / bi_weekly)
through:

  - the period-containing rule (which cycle does ``ref`` fall in?),
  - one-step forward / backward navigation (``_advance`` / ``_retreat``),
  - the public entry point ``generate_cycles`` for both future and past
    directions plus the edge cases (count=0, unknown cadence, unknown
    direction, bi_weekly missing anchor).

Bug surface tested explicitly:

  - month-end clamping (Jan 31 + 1 month → Feb 28/29 leap-correct),
  - bi_weekly anchor with ref BEFORE the anchor (floor-division wrap),
  - semi_monthly day-15 vs day-16 boundary,
  - monthly anchor capped at 28 (so day-31 anchors don't blow up in Feb),
  - generate_cycles "past" returns oldest→newest, not most-recent-first,
  - generate_cycles "future" includes the current cycle as the first element.

NOTE on imports: uses absolute imports rather than the relative pattern
in the older test files (which is broken under the current package
layout — no ``backend/__init__.py``).
"""

from datetime import date

import pytest

from api.payroll_periods import (
    CADENCES,
    _add_months,
    _advance,
    _eom,
    _period_containing,
    _retreat,
    generate_cycles,
)


# ─── _add_months ────────────────────────────────────────────────


def test_add_months_simple_forward():
    assert _add_months(date(2026, 3, 15), 1) == date(2026, 4, 15)
    assert _add_months(date(2026, 3, 15), 6) == date(2026, 9, 15)


def test_add_months_crosses_year_boundary():
    assert _add_months(date(2026, 11, 15), 2) == date(2027, 1, 15)
    assert _add_months(date(2026, 12, 31), 1) == date(2027, 1, 31)


def test_add_months_negative_retreat():
    assert _add_months(date(2026, 1, 15), -1) == date(2025, 12, 15)
    assert _add_months(date(2026, 3, 31), -3) == date(2025, 12, 31)


def test_add_months_clamps_to_target_month_length():
    """Jan 31 + 1 month must clamp to Feb 28 (or 29 in a leap year)."""
    assert _add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert _add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)  # leap
    assert _add_months(date(2026, 3, 31), 1) == date(2026, 4, 30)


# ─── _eom ────────────────────────────────────────────────────────


def test_eom_returns_last_day_of_month():
    assert _eom(date(2026, 4, 15)) == date(2026, 4, 30)
    assert _eom(date(2026, 2, 1)) == date(2026, 2, 28)
    assert _eom(date(2024, 2, 1)) == date(2024, 2, 29)  # leap year
    assert _eom(date(2026, 12, 25)) == date(2026, 12, 31)


# ─── _period_containing (monthly) ───────────────────────────────


def test_monthly_period_ref_after_anchor():
    """ref=2026-04-15 with anchor_day=1 → window is Apr 1 – Apr 30."""
    start, end = _period_containing("monthly", date(2026, 4, 15), 1, None)
    assert start == date(2026, 4, 1)
    assert end == date(2026, 4, 30)


def test_monthly_period_ref_on_anchor_includes_it():
    """The anchor day itself starts the new cycle (inclusive)."""
    start, end = _period_containing("monthly", date(2026, 4, 1), 1, None)
    assert start == date(2026, 4, 1)
    assert end == date(2026, 4, 30)


def test_monthly_period_ref_before_anchor_rolls_back_one_month():
    """anchor_day=15, ref=2026-04-10 → window is Mar 15 – Apr 14."""
    start, end = _period_containing("monthly", date(2026, 4, 10), 15, None)
    assert start == date(2026, 3, 15)
    assert end == date(2026, 4, 14)


def test_monthly_period_anchor_capped_at_28():
    """anchor_day=31 must clamp to 28 so it works in every month
    including February — protects against day-31 anchors in Feb."""
    start, end = _period_containing("monthly", date(2026, 3, 5), 31, None)
    # Cap to 28 → window is Feb 28 – Mar 27 (ref=Mar 5 is in that window).
    assert start == date(2026, 2, 28)
    assert end == date(2026, 3, 27)


def test_monthly_period_default_anchor_is_1():
    """anchor_day=None falls back to 1."""
    start, end = _period_containing("monthly", date(2026, 4, 15), None, None)
    assert start == date(2026, 4, 1)
    assert end == date(2026, 4, 30)


# ─── _period_containing (semi_monthly) ──────────────────────────


def test_semi_monthly_first_half_includes_day_1_and_day_15():
    for day in (1, 7, 15):
        start, end = _period_containing("semi_monthly", date(2026, 4, day), None, None)
        assert start == date(2026, 4, 1)
        assert end == date(2026, 4, 15)


def test_semi_monthly_second_half_runs_16_to_eom():
    start, end = _period_containing("semi_monthly", date(2026, 4, 16), None, None)
    assert start == date(2026, 4, 16)
    assert end == date(2026, 4, 30)

    start, end = _period_containing("semi_monthly", date(2026, 4, 30), None, None)
    assert start == date(2026, 4, 16)
    assert end == date(2026, 4, 30)


def test_semi_monthly_second_half_february_handles_short_month():
    """Feb has a short second half (16th–28th, or 16th–29th leap)."""
    start, end = _period_containing("semi_monthly", date(2026, 2, 20), None, None)
    assert start == date(2026, 2, 16)
    assert end == date(2026, 2, 28)

    start, end = _period_containing("semi_monthly", date(2024, 2, 20), None, None)
    assert start == date(2024, 2, 16)
    assert end == date(2024, 2, 29)  # leap


# ─── _period_containing (bi_weekly) ─────────────────────────────


def test_bi_weekly_period_at_anchor():
    """ref=anchor → window is anchor … anchor+13 (14-day inclusive)."""
    anchor = date(2026, 4, 1)
    start, end = _period_containing("bi_weekly", anchor, None, anchor)
    assert start == anchor
    assert end == date(2026, 4, 14)


def test_bi_weekly_period_one_full_cycle_after_anchor():
    anchor = date(2026, 4, 1)
    start, end = _period_containing("bi_weekly", date(2026, 4, 20), None, anchor)
    assert start == date(2026, 4, 15)
    assert end == date(2026, 4, 28)


def test_bi_weekly_period_ref_before_anchor_uses_floor_division():
    """Negative ``delta`` must still produce a coherent window — bug
    surface for date math that doesn't handle floor-div correctly."""
    anchor = date(2026, 4, 1)
    start, end = _period_containing("bi_weekly", date(2026, 3, 20), None, anchor)
    # Mar 20 → 12 days before anchor → k = -1 → cycle starts Mar 18.
    assert start == date(2026, 3, 18)
    assert end == date(2026, 3, 31)
    # And the next 14 days from Mar 18 do cover Mar 20 — sanity.
    assert start <= date(2026, 3, 20) <= end


def test_bi_weekly_requires_anchor_date():
    """No anchor → can't be deterministic. Reject explicitly so a
    misconfigured org doesn't silently get a wrong window."""
    with pytest.raises(ValueError, match="bi_weekly requires anchor_date"):
        _period_containing("bi_weekly", date(2026, 4, 1), None, None)


# ─── unknown cadence ────────────────────────────────────────────


def test_period_containing_unknown_cadence_rejects():
    with pytest.raises(ValueError, match="unknown cadence"):
        _period_containing("weekly", date(2026, 4, 1), 1, None)


def test_cadences_constant_holds_expected_three():
    assert CADENCES == {"monthly", "semi_monthly", "bi_weekly"}


# ─── _advance / _retreat ────────────────────────────────────────


def test_advance_monthly_returns_first_of_next_month():
    assert _advance("monthly", date(2026, 4, 1), 1) == date(2026, 5, 1)
    # December → next year
    assert _advance("monthly", date(2026, 12, 15), 15) == date(2027, 1, 15)


def test_retreat_monthly_returns_first_of_previous_month():
    assert _retreat("monthly", date(2026, 4, 1), 1) == date(2026, 3, 1)
    # January → previous year
    assert _retreat("monthly", date(2026, 1, 15), 15) == date(2025, 12, 15)


def test_advance_semi_monthly_toggles_1_to_16():
    assert _advance("semi_monthly", date(2026, 4, 1), None) == date(2026, 4, 16)
    # 16th → 1st of next month
    assert _advance("semi_monthly", date(2026, 4, 16), None) == date(2026, 5, 1)


def test_retreat_semi_monthly_toggles_16_to_1_and_1_to_prev_16():
    assert _retreat("semi_monthly", date(2026, 4, 16), None) == date(2026, 4, 1)
    # 1st → 16th of previous month
    assert _retreat("semi_monthly", date(2026, 4, 1), None) == date(2026, 3, 16)


def test_advance_retreat_bi_weekly_pm_14_days():
    s = date(2026, 4, 1)
    assert _advance("bi_weekly", s, None) == date(2026, 4, 15)
    assert _retreat("bi_weekly", s, None) == date(2026, 3, 18)


def test_advance_unknown_cadence_rejects():
    with pytest.raises(ValueError, match="unknown cadence"):
        _advance("annual", date(2026, 4, 1), 1)


def test_retreat_unknown_cadence_rejects():
    with pytest.raises(ValueError, match="unknown cadence"):
        _retreat("annual", date(2026, 4, 1), 1)


# ─── generate_cycles (the public entry point) ──────────────────


def test_generate_cycles_count_zero_returns_empty():
    out = generate_cycles(
        "monthly", anchor_day=1, ref=date(2026, 4, 15), count=0, direction="future",
    )
    assert out == []


def test_generate_cycles_unknown_cadence_rejects():
    with pytest.raises(ValueError, match="unknown cadence"):
        generate_cycles(
            "weekly", anchor_day=1, ref=date(2026, 4, 15), count=1, direction="future",
        )


def test_generate_cycles_unknown_direction_rejects():
    with pytest.raises(ValueError, match="direction must be"):
        generate_cycles(
            "monthly", anchor_day=1, ref=date(2026, 4, 15), count=1, direction="sideways",
        )


def test_generate_cycles_future_includes_current_cycle_as_first():
    """Future direction's first element MUST be the cycle containing ``ref`` —
    that's how the forecast page lines up "this cycle" with the now."""
    out = generate_cycles(
        "monthly", anchor_day=1, ref=date(2026, 4, 15), count=3, direction="future",
    )
    assert len(out) == 3
    assert out[0] == (date(2026, 4, 1), date(2026, 4, 30))
    assert out[1] == (date(2026, 5, 1), date(2026, 5, 31))
    assert out[2] == (date(2026, 6, 1), date(2026, 6, 30))


def test_generate_cycles_past_excludes_current_and_returns_oldest_first():
    """Past direction returns *completed* cycles strictly before the
    current one, ordered oldest→newest. The forecast page uses this for
    the trailing-average baseline."""
    out = generate_cycles(
        "monthly", anchor_day=1, ref=date(2026, 4, 15), count=3, direction="past",
    )
    assert len(out) == 3
    assert out[0] == (date(2026, 1, 1), date(2026, 1, 31))
    assert out[1] == (date(2026, 2, 1), date(2026, 2, 28))
    assert out[2] == (date(2026, 3, 1), date(2026, 3, 31))
    # And the current cycle is NOT in the past output.
    assert (date(2026, 4, 1), date(2026, 4, 30)) not in out


def test_generate_cycles_semi_monthly_future():
    """Semi-monthly: pickin from a day in the first half should walk
    1..15, 16..eom, then into the next month's 1..15."""
    out = generate_cycles(
        "semi_monthly", ref=date(2026, 4, 10), count=4, direction="future",
    )
    assert out[0] == (date(2026, 4, 1), date(2026, 4, 15))
    assert out[1] == (date(2026, 4, 16), date(2026, 4, 30))
    assert out[2] == (date(2026, 5, 1), date(2026, 5, 15))
    assert out[3] == (date(2026, 5, 16), date(2026, 5, 31))


def test_generate_cycles_bi_weekly_future_starts_at_period_containing_ref():
    anchor = date(2026, 4, 1)
    out = generate_cycles(
        "bi_weekly",
        anchor_date=anchor,
        ref=date(2026, 4, 10),  # falls in the Apr 1 – Apr 14 cycle
        count=2,
        direction="future",
    )
    assert out[0] == (date(2026, 4, 1), date(2026, 4, 14))
    assert out[1] == (date(2026, 4, 15), date(2026, 4, 28))


def test_generate_cycles_bi_weekly_past_strictly_before_ref():
    anchor = date(2026, 4, 1)
    out = generate_cycles(
        "bi_weekly",
        anchor_date=anchor,
        ref=date(2026, 4, 10),
        count=2,
        direction="past",
    )
    assert out[0] == (date(2026, 3, 4), date(2026, 3, 17))
    assert out[1] == (date(2026, 3, 18), date(2026, 3, 31))


def test_generate_cycles_monthly_past_handles_year_boundary():
    """Past from January must roll cleanly into December of the prior year."""
    out = generate_cycles(
        "monthly", anchor_day=1, ref=date(2026, 2, 5), count=3, direction="past",
    )
    assert out[0] == (date(2025, 11, 1), date(2025, 11, 30))
    assert out[1] == (date(2025, 12, 1), date(2025, 12, 31))
    assert out[2] == (date(2026, 1, 1), date(2026, 1, 31))
