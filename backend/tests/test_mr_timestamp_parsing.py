"""
Unit tests for the MapRoulette extract timestamp parser.

No database and no API: these exercise ``_parse_mr_timestamp`` directly, so
they run anywhere the backend deps are installed.

Context: the sync used to stamp ``date_mapped``/``date_validated`` with
``func.now()`` and throw away the ``MappedOn``/``ReviewedAt`` columns the
extract already carries, which dated every historical task to whenever the
sync first reached it.
"""

from datetime import datetime

import pytest

from api.views.MapRoulette import _parse_mr_timestamp


@pytest.mark.parametrize(
    "raw,expected",
    [
        # Bare date -- what the extract emits for older challenges.
        ("2024-01-01", datetime(2024, 1, 1, 0, 0)),
        # Full instant with the Z suffix MapRoulette actually sends.
        ("2026-08-25T19:11:17.727Z", datetime(2026, 8, 25, 19, 11, 17, 727000)),
        ("2026-08-25T19:11:17Z", datetime(2026, 8, 25, 19, 11, 17)),
        # Explicit UTC offset.
        (
            "2026-08-25T19:11:17.727+00:00",
            datetime(2026, 8, 25, 19, 11, 17, 727000),
        ),
        # Space separator instead of "T".
        ("2025-01-09 11:29:46.261", datetime(2025, 1, 9, 11, 29, 46, 261000)),
        # Surrounding whitespace.
        ("  2024-01-01  ", datetime(2024, 1, 1, 0, 0)),
    ],
)
def test_parses_the_shapes_the_extract_emits(raw, expected):
    assert _parse_mr_timestamp(raw) == expected


def test_non_utc_offset_is_normalised_to_utc_wall_time():
    """
    date_mapped / date_validated are TIMESTAMP WITHOUT TIME ZONE, so an
    offset-bearing value has to be converted rather than truncated -- keeping
    the local wall time would shift the task by the offset.
    """
    got = _parse_mr_timestamp("2026-06-24T10:28:47.556-06:00")
    assert got == datetime(2026, 6, 24, 16, 28, 47, 556000)


def test_result_is_always_naive():
    """An aware value in a naive column mixes conventions in one column."""
    assert _parse_mr_timestamp("2026-08-25T19:11:17.727Z").tzinfo is None
    assert _parse_mr_timestamp("2024-01-01").tzinfo is None


@pytest.mark.parametrize("raw", ["", "   ", None, "not a date", "0000-00-00"])
def test_unusable_values_return_none_so_the_caller_can_fall_back(raw):
    assert _parse_mr_timestamp(raw) is None
