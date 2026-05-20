"""
Unit tests for the payment-calculation SSOT in api/views/Payments.py.

The five compensation models (hourly, salaried, per_task, project_based,
hybrid) all funnel through ``_compute_payable``. The table / KPIs /
contributor detail / CSV export all read from it, so anything that goes
wrong here propagates everywhere. The tests below pin one assertion
per model and the cross-cutting helpers (``_effective_comp_model``,
``_prorated_salary``, ``_comp_filter_from_body``, ``_passes_comp_filter``).

DB-free: minimal ``_FakeUser`` stand-in carries only the attributes the
functions under test actually read.
"""

from datetime import date
from decimal import Decimal

from api.views.Payments import (
    VALID_COMP_MODELS,
    _comp_filter_from_body,
    _compute_payable,
    _decimal,
    _effective_comp_model,
    _passes_comp_filter,
    _prorated_salary,
)


# ─── _FakeUser ───────────────────────────────────────────────────


class _FakeUser:
    """Carries only the fields the payment helpers read."""

    def __init__(
        self,
        *,
        compensation_model=None,
        hourly_rate=None,
        monthly_salary=None,
        payable_total=None,
        first_name="",
        last_name="",
        email="",
        id="auth0|test",
    ):
        self.compensation_model = compensation_model
        self.hourly_rate = hourly_rate
        self.monthly_salary = monthly_salary
        self.payable_total = payable_total
        self.first_name = first_name
        self.last_name = last_name
        self.email = email
        self.id = id


# ─── _decimal ────────────────────────────────────────────────────


def test_decimal_none_stays_none():
    assert _decimal(None) is None


def test_decimal_converts_decimal_to_float():
    out = _decimal(Decimal("12.34"))
    assert isinstance(out, float)
    assert out == 12.34


def test_decimal_passes_float_through():
    assert _decimal(7.5) == 7.5


def test_decimal_converts_int_to_float():
    out = _decimal(5)
    assert isinstance(out, float)
    assert out == 5.0


# ─── VALID_COMP_MODELS ───────────────────────────────────────────


def test_valid_comp_models_contains_all_five():
    """Pin the contract: any new model added on the backend must also be
    added here. The frontend enum in lib/timeTracking.ts and the admin
    user-profile select rely on this set."""
    assert VALID_COMP_MODELS == {
        "per_task",
        "hourly",
        "salaried",
        "project_based",
        "hybrid",
    }


# ─── _effective_comp_model ───────────────────────────────────────


def test_effective_comp_model_explicit_value_passes_through():
    for model in ("per_task", "hourly", "salaried", "project_based", "hybrid"):
        u = _FakeUser(compensation_model=model)
        assert _effective_comp_model(u) == model


def test_effective_comp_model_null_with_hourly_rate_falls_back_to_hourly():
    """Legacy user with hourly_rate set but no compensation_model column
    value → hourly (the most common pre-rework legacy path)."""
    u = _FakeUser(compensation_model=None, hourly_rate=Decimal("25.00"))
    assert _effective_comp_model(u) == "hourly"


def test_effective_comp_model_null_without_hourly_rate_falls_back_to_per_task():
    """Legacy user with no comp_model AND no hourly_rate → per_task
    (the historical core micropayment flow)."""
    u = _FakeUser(compensation_model=None, hourly_rate=None)
    assert _effective_comp_model(u) == "per_task"


def test_effective_comp_model_unknown_value_falls_back_to_legacy_rules():
    """Defense-in-depth: a typo / future-removed value must not crash —
    it falls back to the same legacy rule as NULL."""
    u_with_rate = _FakeUser(compensation_model="contractor", hourly_rate=Decimal("30"))
    assert _effective_comp_model(u_with_rate) == "hourly"
    u_no_rate = _FakeUser(compensation_model="bogus", hourly_rate=None)
    assert _effective_comp_model(u_no_rate) == "per_task"


# ─── _prorated_salary ────────────────────────────────────────────


def test_prorated_salary_no_salary_returns_zero():
    u = _FakeUser(monthly_salary=None)
    assert _prorated_salary(u, date(2026, 4, 1), date(2026, 4, 30)) == 0.0


def test_prorated_salary_full_month_returns_full_salary():
    """A full April (30 days) at $3000/month → $3000."""
    u = _FakeUser(monthly_salary=Decimal("3000"))
    assert _prorated_salary(u, date(2026, 4, 1), date(2026, 4, 30)) == 3000.00


def test_prorated_salary_half_month_returns_half_salary():
    """First half of April (1st–15th, 15 days of 30) at $3000 → $1500."""
    u = _FakeUser(monthly_salary=Decimal("3000"))
    assert _prorated_salary(u, date(2026, 4, 1), date(2026, 4, 15)) == 1500.00


def test_prorated_salary_february_short_month_still_full_when_inclusive():
    """A whole non-leap February (28 days) at $2800 should still be full
    salary — proration's denominator is the month length, not 30/31."""
    u = _FakeUser(monthly_salary=Decimal("2800"))
    assert _prorated_salary(u, date(2026, 2, 1), date(2026, 2, 28)) == 2800.00


def test_prorated_salary_december_anchor_handles_year_rollover():
    """December → next month is January of NEXT year. The branch that
    computes that boundary has caught me before — test it."""
    u = _FakeUser(monthly_salary=Decimal("3100"))
    # A full December (31 days) → full salary.
    assert _prorated_salary(u, date(2026, 12, 1), date(2026, 12, 31)) == 3100.00


# ─── _compute_payable (the SSOT) ─────────────────────────────────


def _hours_to_seconds(h):
    return int(h * 3600)


def test_compute_payable_hourly_with_rate_and_hours():
    """Hourly: 40 hours × $25 = $1000 base, plus adjustments."""
    u = _FakeUser(compensation_model="hourly", hourly_rate=Decimal("25"))
    model, base, total = _compute_payable(
        u, _hours_to_seconds(40), 0, date(2026, 4, 1), date(2026, 4, 30),
    )
    assert model == "hourly"
    assert base == 1000.00
    assert total == 1000.00


def test_compute_payable_hourly_without_rate_is_zero():
    """Hourly model but hourly_rate=NULL must not crash; base=0.
    Surfaces a config bug (admin set model but forgot the rate) as
    "earned nothing this cycle" rather than a 500."""
    u = _FakeUser(compensation_model="hourly", hourly_rate=None)
    model, base, total = _compute_payable(
        u, _hours_to_seconds(40), 0, date(2026, 4, 1), date(2026, 4, 30),
    )
    assert model == "hourly"
    assert base == 0.0
    assert total == 0.0


def test_compute_payable_hourly_adjustments_add_to_base():
    """Total must equal base + adjustments, rounded to cents."""
    u = _FakeUser(compensation_model="hourly", hourly_rate=Decimal("25"))
    model, base, total = _compute_payable(
        u, _hours_to_seconds(40), 150.00, date(2026, 4, 1), date(2026, 4, 30),
    )
    assert base == 1000.00
    assert total == 1150.00


def test_compute_payable_salaried_returns_prorated_salary():
    u = _FakeUser(compensation_model="salaried", monthly_salary=Decimal("3000"))
    model, base, total = _compute_payable(
        u, _hours_to_seconds(40), 0, date(2026, 4, 1), date(2026, 4, 30),
    )
    assert model == "salaried"
    assert base == 3000.00
    assert total == 3000.00


def test_compute_payable_per_task_uses_payable_total():
    """per_task pulls the user's payable_total (their unpaid
    micropayment balance) — hours / rate are irrelevant on this path."""
    u = _FakeUser(compensation_model="per_task", payable_total=Decimal("123.45"))
    model, base, total = _compute_payable(
        u, _hours_to_seconds(40), 0, date(2026, 4, 1), date(2026, 4, 30),
    )
    assert model == "per_task"
    assert base == 123.45
    assert total == 123.45


def test_compute_payable_per_task_missing_payable_total_is_zero():
    """No payable_total attribute → 0 base (legacy users predating the
    per_task flow shouldn't crash here)."""
    u = _FakeUser(compensation_model="per_task")
    u.payable_total = None
    model, base, total = _compute_payable(
        u, _hours_to_seconds(40), 0, date(2026, 4, 1), date(2026, 4, 30),
    )
    assert model == "per_task"
    assert base == 0.0


def test_compute_payable_project_based_base_is_zero_scaffold():
    """project_based is a scaffold — base=0 with adjustments overlay.
    When the math is defined, this test must be updated."""
    u = _FakeUser(compensation_model="project_based")
    model, base, total = _compute_payable(
        u, _hours_to_seconds(40), 200.00, date(2026, 4, 1), date(2026, 4, 30),
    )
    assert model == "project_based"
    assert base == 0.0
    assert total == 200.00


def test_compute_payable_hybrid_with_rate_uses_hourly_path():
    u = _FakeUser(
        compensation_model="hybrid",
        hourly_rate=Decimal("30"),
        monthly_salary=Decimal("5000"),  # ignored when rate present
    )
    model, base, total = _compute_payable(
        u, _hours_to_seconds(20), 0, date(2026, 4, 1), date(2026, 4, 30),
    )
    assert model == "hybrid"
    assert base == 600.00  # 20 * 30


def test_compute_payable_hybrid_without_rate_falls_back_to_prorated_salary():
    u = _FakeUser(
        compensation_model="hybrid",
        hourly_rate=None,
        monthly_salary=Decimal("3000"),
    )
    model, base, total = _compute_payable(
        u, _hours_to_seconds(20), 0, date(2026, 4, 1), date(2026, 4, 30),
    )
    assert model == "hybrid"
    assert base == 3000.00  # full month


def test_compute_payable_legacy_user_defaults_to_hourly_via_effective_model():
    """compensation_model=None + hourly_rate set → resolves to "hourly"
    via _effective_comp_model. Whole flow stays consistent."""
    u = _FakeUser(compensation_model=None, hourly_rate=Decimal("20"))
    model, base, total = _compute_payable(
        u, _hours_to_seconds(10), 0, date(2026, 4, 1), date(2026, 4, 30),
    )
    assert model == "hourly"
    assert base == 200.00


def test_compute_payable_zero_seconds_zero_base_on_hourly():
    """An hourly user with no time logged earns nothing — total reflects
    adjustments only. This catches division-by-zero / NaN bugs in any
    future seconds-derived math."""
    u = _FakeUser(compensation_model="hourly", hourly_rate=Decimal("25"))
    model, base, total = _compute_payable(
        u, 0, 50.00, date(2026, 4, 1), date(2026, 4, 30),
    )
    assert base == 0.0
    assert total == 50.00


def test_compute_payable_rounds_base_to_cents():
    """Hours math can produce non-cent values — base must round to 2dp
    so the export and the UI agree on the displayed number."""
    u = _FakeUser(compensation_model="hourly", hourly_rate=Decimal("33.333"))
    model, base, total = _compute_payable(
        u, _hours_to_seconds(1), 0, date(2026, 4, 1), date(2026, 4, 30),
    )
    # 1 * 33.333 = 33.333 → rounded to 33.33
    assert base == 33.33


# ─── _comp_filter_from_body ──────────────────────────────────────


def test_comp_filter_empty_body_returns_none():
    assert _comp_filter_from_body({}) is None
    assert _comp_filter_from_body(None) is None


def test_comp_filter_no_filters_key_returns_none():
    assert _comp_filter_from_body({"foo": "bar"}) is None


def test_comp_filter_empty_compensation_returns_none():
    assert _comp_filter_from_body({"filters": {}}) is None
    assert _comp_filter_from_body({"filters": {"compensation": []}}) is None
    assert _comp_filter_from_body({"filters": {"compensation": ""}}) is None


def test_comp_filter_single_string_value_wrapped_in_set():
    """The frontend filter can send a single string OR a list. Both
    must produce the same Set-shaped output downstream."""
    out = _comp_filter_from_body({"filters": {"compensation": "hourly"}})
    assert out == {"hourly"}


def test_comp_filter_list_of_strings_becomes_set():
    out = _comp_filter_from_body(
        {"filters": {"compensation": ["hourly", "salaried", "per_task"]}}
    )
    assert out == {"hourly", "salaried", "per_task"}


def test_comp_filter_drops_empty_strings_from_list():
    out = _comp_filter_from_body(
        {"filters": {"compensation": ["hourly", "", "salaried"]}}
    )
    assert out == {"hourly", "salaried"}


# ─── _passes_comp_filter ─────────────────────────────────────────


def test_passes_comp_filter_no_filter_excludes_per_task_by_default():
    """The whole point of the per_task default-off rule: when no explicit
    compensation filter is set, per_task users don't appear on the page."""
    assert _passes_comp_filter("per_task", None) is False


def test_passes_comp_filter_no_filter_includes_everything_else():
    for model in ("hourly", "salaried", "project_based", "hybrid"):
        assert _passes_comp_filter(model, None) is True


def test_passes_comp_filter_explicit_filter_is_inclusion_only():
    """With an explicit set, only models in the set pass — including
    per_task. This is the ONLY way per_task users surface; flipping the
    default later is a one-line change."""
    f = {"per_task"}
    assert _passes_comp_filter("per_task", f) is True
    assert _passes_comp_filter("hourly", f) is False


def test_passes_comp_filter_explicit_multi_model_filter():
    f = {"hourly", "salaried"}
    assert _passes_comp_filter("hourly", f) is True
    assert _passes_comp_filter("salaried", f) is True
    assert _passes_comp_filter("per_task", f) is False
    assert _passes_comp_filter("hybrid", f) is False
