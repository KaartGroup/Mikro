"""
Unit tests for the payment-calculation SSOT in api/services/payments.py.

The three compensation models (hourly, per_task, project_based) all funnel
through ``PaymentService.compute_payable``. The table / KPIs / contributor
detail / CSV export all read from it, so anything that goes wrong here
propagates everywhere. The tests below pin one assertion per model and the
cross-cutting helpers (``effective_comp_model``, ``_comp_filter_from_body``,
``passes_comp_filter``).

DB-free: minimal ``_FakeUser`` stand-in carries only the attributes the
functions under test actually read.
"""

from decimal import Decimal

from api.services.payment_cycle import (
    PaymentCycleService as PaymentService,
    VALID_COMP_MODELS,
)
from api.views.Payments import _comp_filter_from_body

# ─── _FakeUser ───────────────────────────────────────────────────


class _FakeUser:
    """Carries only the fields the payment helpers read."""

    def __init__(
        self,
        *,
        compensation_model=None,
        hourly_rate=None,
        payable_total=None,
        first_name="",
        last_name="",
        email="",
        id="auth0|test",
    ):
        self.compensation_model = compensation_model
        self.hourly_rate = hourly_rate
        self.payable_total = payable_total
        self.first_name = first_name
        self.last_name = last_name
        self.email = email
        self.id = id


# ─── VALID_COMP_MODELS ───────────────────────────────────────────


def test_valid_comp_models_contains_all_three():
    """Pin the contract: any new model added on the backend must also be
    added here. The frontend enum in lib/timeTracking.ts and the admin
    user-profile select rely on this set."""
    assert VALID_COMP_MODELS == {
        "per_task",
        "hourly",
        "project_based",
    }


# ─── _effective_comp_model ───────────────────────────────────────


def test_effective_comp_model_explicit_value_passes_through():
    for model in ("per_task", "hourly", "project_based"):
        u = _FakeUser(compensation_model=model)
        assert PaymentService.effective_comp_model(u) == model


def test_effective_comp_model_null_with_hourly_rate_falls_back_to_hourly():
    """Legacy user with hourly_rate set but no compensation_model column
    value → hourly (the most common pre-rework legacy path)."""
    u = _FakeUser(compensation_model=None, hourly_rate=Decimal("25.00"))
    assert PaymentService.effective_comp_model(u) == "hourly"


def test_effective_comp_model_null_without_hourly_rate_falls_back_to_per_task():
    """Legacy user with no comp_model AND no hourly_rate → per_task
    (the historical core micropayment flow)."""
    u = _FakeUser(compensation_model=None, hourly_rate=None)
    assert PaymentService.effective_comp_model(u) == "per_task"


def test_effective_comp_model_unknown_value_falls_back_to_legacy_rules():
    """Defense-in-depth: a typo / future-removed value must not crash —
    it falls back to the same legacy rule as NULL."""
    u_with_rate = _FakeUser(compensation_model="contractor", hourly_rate=Decimal("30"))
    assert PaymentService.effective_comp_model(u_with_rate) == "hourly"
    u_no_rate = _FakeUser(compensation_model="bogus", hourly_rate=None)
    assert PaymentService.effective_comp_model(u_no_rate) == "per_task"


# ─── _compute_payable (the SSOT) ─────────────────────────────────


def _hours_to_seconds(h):
    return int(h * 3600)


def test_compute_payable_hourly_with_rate_and_hours():
    """Hourly: 40 hours × $25 = $1000 base, plus adjustments."""
    u = _FakeUser(compensation_model="hourly", hourly_rate=Decimal("25"))
    model, base, total = PaymentService.compute_payable(u, _hours_to_seconds(40), 0)
    assert model == "hourly"
    assert base == 1000.00
    assert total == 1000.00


def test_compute_payable_hourly_without_rate_is_zero():
    """Hourly model but hourly_rate=NULL must not crash; base=0.
    Surfaces a config bug (admin set model but forgot the rate) as
    "earned nothing this cycle" rather than a 500."""
    u = _FakeUser(compensation_model="hourly", hourly_rate=None)
    model, base, total = PaymentService.compute_payable(u, _hours_to_seconds(40), 0)
    assert model == "hourly"
    assert base == 0.0
    assert total == 0.0


def test_compute_payable_hourly_adjustments_add_to_base():
    """Total must equal base + adjustments, rounded to cents."""
    u = _FakeUser(compensation_model="hourly", hourly_rate=Decimal("25"))
    model, base, total = PaymentService.compute_payable(
        u, _hours_to_seconds(40), 150.00
    )
    assert base == 1000.00
    assert total == 1150.00


def test_compute_payable_per_task_uses_payable_total():
    """per_task pulls the user's payable_total (their unpaid
    micropayment balance) — hours / rate are irrelevant on this path."""
    u = _FakeUser(compensation_model="per_task", payable_total=Decimal("123.45"))
    model, base, total = PaymentService.compute_payable(u, _hours_to_seconds(40), 0)
    assert model == "per_task"
    assert base == 123.45
    assert total == 123.45


def test_compute_payable_per_task_missing_payable_total_is_zero():
    """No payable_total attribute → 0 base (legacy users predating the
    per_task flow shouldn't crash here)."""
    u = _FakeUser(compensation_model="per_task")
    u.payable_total = None
    model, base, total = PaymentService.compute_payable(u, _hours_to_seconds(40), 0)
    assert model == "per_task"
    assert base == 0.0


def test_compute_payable_project_based_base_is_zero_scaffold():
    """project_based is a scaffold — base=0 with adjustments overlay.
    When the math is defined, this test must be updated."""
    u = _FakeUser(compensation_model="project_based")
    model, base, total = PaymentService.compute_payable(
        u, _hours_to_seconds(40), 200.00
    )
    assert model == "project_based"
    assert base == 0.0
    assert total == 200.00


def test_compute_payable_legacy_user_defaults_to_hourly_via_effective_model():
    """compensation_model=None + hourly_rate set → resolves to "hourly"
    via _effective_comp_model. Whole flow stays consistent."""
    u = _FakeUser(compensation_model=None, hourly_rate=Decimal("20"))
    model, base, total = PaymentService.compute_payable(u, _hours_to_seconds(10), 0)
    assert model == "hourly"
    assert base == 200.00


def test_compute_payable_zero_seconds_zero_base_on_hourly():
    """An hourly user with no time logged earns nothing — total reflects
    adjustments only. This catches division-by-zero / NaN bugs in any
    future seconds-derived math."""
    u = _FakeUser(compensation_model="hourly", hourly_rate=Decimal("25"))
    model, base, total = PaymentService.compute_payable(u, 0, 50.00)
    assert base == 0.0
    assert total == 50.00


def test_compute_payable_rounds_base_to_cents():
    """Hours math can produce non-cent values — base must round to 2dp
    so the export and the UI agree on the displayed number."""
    u = _FakeUser(compensation_model="hourly", hourly_rate=Decimal("33.333"))
    model, base, total = PaymentService.compute_payable(u, _hours_to_seconds(1), 0)
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
    out = _comp_filter_from_body({"filters": {"compensation": ["hourly", "per_task"]}})
    assert out == {"hourly", "per_task"}


def test_comp_filter_drops_empty_strings_from_list():
    out = _comp_filter_from_body(
        {"filters": {"compensation": ["hourly", "", "per_task"]}}
    )
    assert out == {"hourly", "per_task"}


# ─── _passes_comp_filter ─────────────────────────────────────────


def test_passes_comp_filter_no_filter_excludes_per_task_by_default():
    """The whole point of the per_task default-off rule: when no explicit
    compensation filter is set, per_task users don't appear on the page."""
    assert PaymentService.passes_comp_filter("per_task", None) is False


def test_passes_comp_filter_no_filter_includes_everything_else():
    for model in ("hourly", "project_based"):
        assert PaymentService.passes_comp_filter(model, None) is True


def test_passes_comp_filter_explicit_filter_is_inclusion_only():
    """With an explicit set, only models in the set pass — including
    per_task. This is the ONLY way per_task users surface; flipping the
    default later is a one-line change."""
    f = {"per_task"}
    assert PaymentService.passes_comp_filter("per_task", f) is True
    assert PaymentService.passes_comp_filter("hourly", f) is False


def test_passes_comp_filter_explicit_multi_model_filter():
    f = {"hourly", "project_based"}
    assert PaymentService.passes_comp_filter("hourly", f) is True
    assert PaymentService.passes_comp_filter("project_based", f) is True
    assert PaymentService.passes_comp_filter("per_task", f) is False
