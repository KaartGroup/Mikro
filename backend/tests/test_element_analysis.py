"""
Tests for element analysis XML parsing and category counting.

Structured in three layers:
  1. parse_adiff_transitions — real XML fixtures, no mocking
  2. build_category_data     — pure categorization logic, no DB
  3. get_element_analysis    — DB wiring only (mocked)
"""

from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from api.utils.adiff_analyzer import (
    TRACKED_KEYS,
    KEY_FILTERS,
    parse_adiff_transitions,
    merge_transitions,
)
from api.views.reports.element_analysis import build_category_data, get_element_analysis

FIXTURES = Path(__file__).parent / "fixtures"
ORG = "org_test"
START = datetime(2024, 1, 1)
END = datetime(2024, 1, 31)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load(filename):
    return (FIXTURES / filename).read_text()


def _parse(filename):
    return parse_adiff_transitions(_load(filename), TRACKED_KEYS, KEY_FILTERS)


def _day_stats(*filenames):
    """Merge one or more fixture files into a single-day stats dict keyed by date(2024,1,1)."""
    stats = {key: {} for key in TRACKED_KEYS}
    for fname in filenames:
        merge_transitions(stats, _parse(fname))
    return defaultdict(lambda: {key: {} for key in TRACKED_KEYS}, {date(2024, 1, 1): stats})


def _cat(categories, title):
    return next(c for c in categories if c["title"] == title)


def _d0(categories, title):
    """First day entry for a category."""
    return _cat(categories, title)["data"][0]


# ---------------------------------------------------------------------------
# 1. parse_adiff_transitions — real XML fixtures
# ---------------------------------------------------------------------------

class TestParseAdiffTransitions:
    # --- access ---

    def test_access_added(self):
        # modify: highway=service way gains access=private
        stats = _parse("182054401.xml")
        assert stats["access"] == {(None, "private"): 1}

    def test_access_highway_unchanged_when_same_value(self):
        # highway=service present on both old and new — no transition
        stats = _parse("182054401.xml")
        assert stats["highway"] == {}

    # --- name ---

    def test_name_added_via_create_action(self):
        # osmcha create action (element directly under <action>, no <new> wrapper)
        stats = _parse("182054462.xml")
        assert stats["name"] == {(None, "Neuquén"): 1}

    # --- highway ---

    def test_highway_modify_secondary_to_residential(self):
        # secondary IS high-priority → passes KEY_FILTER even though new value is not
        stats = _parse("182135772.xml")
        assert stats["highway"] == {("secondary", "residential"): 1}

    def test_highway_residential_create_ignored(self):
        # create adds highway=residential — not in _HIGH_PRIORITY_HIGHWAY, filtered out
        stats = _parse("182054462.xml")
        assert stats["highway"] == {}

    # --- barrier ---

    def test_barrier_modify_and_add(self):
        # gate → lift_gate (modify) AND a new lift_gate (add)
        stats = _parse("182434007_barrier.xml")
        assert stats["barrier"][("gate", "lift_gate")] == 1
        assert stats["barrier"][(None, "lift_gate")] == 1

    # --- ref ---

    def test_ref_added(self):
        stats = _parse("182433203_ref.xml")
        assert stats["ref"] == {(None, "447517"): 1}

    # --- construction ---

    def test_construction_added(self):
        stats = _parse("182164518_construction.xml")
        assert stats["construction"] == {(None, "residential"): 1}

    # --- oneway ---

    def test_oneway_added(self):
        stats = _parse("182164518_construction.xml")
        assert stats["oneway"] == {(None, "no"): 2}

    # --- restriction + type ---

    def test_restriction_modify_and_add(self):
        stats = _parse("182436200_restriction.xml")
        assert stats["restriction"][("no_left_turn", "no_u_turn")] == 1
        assert stats["restriction"][(None, "no_left_turn")] == 2

    def test_type_restriction_added(self):
        stats = _parse("182436200_restriction.xml")
        assert stats["type"][(None, "restriction")] == 2

    # --- oneway on residential road ---

    def test_adding_oneway_to_residential_road_is_counted(self):
        # oneway has no KEY_FILTER — any transition counts regardless of road class.
        # This verifies that highway=residential does not suppress the oneway add.
        xml = """<osm>
  <action type="modify">
    <old><way><tag k="highway" v="residential"/></way></old>
    <new><way><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way></new>
  </action>
</osm>"""
        stats = parse_adiff_transitions(xml, TRACKED_KEYS, KEY_FILTERS)
        assert stats["oneway"] == {(None, "yes"): 1}
        assert stats["highway"] == {}  # residential unchanged, filtered out

    # --- multi-key changesets ---

    def test_182097240_six_keys(self):
        stats = _parse("182097240_multi_highway_name_oneway_ref_restriction_type.xml")
        assert stats["ref"][(None, "66")] == 1
        assert stats["oneway"][(None, "yes")] == 3
        assert stats["oneway"][("yes", None)] == 2
        assert stats["highway"][(None, "trunk")] == 1
        assert stats["restriction"][(None, "no_left_turn")] == 1
        assert stats["name"][(None, "Avenida Carrera 27")] == 1
        assert stats["type"][(None, "restriction")] == 1
        assert stats["access"] == {}
        assert stats["barrier"] == {}
        assert stats["construction"] == {}

    def test_182054191_seven_keys(self):
        stats = _parse("182054191_multi_access_highway_name_oneway_ref_restriction_type.xml")
        assert stats["access"][(None, "private")] == 1
        assert stats["highway"][("trunk", "primary")] == 16
        assert stats["highway"][("trunk_link", "primary_link")] == 4
        assert stats["oneway"][("yes", None)] == 1
        assert stats["ref"][(None, "45A")] == 2
        assert stats["restriction"][(None, "no_left_turn")] == 2
        assert stats["type"][(None, "restriction")] == 2
        assert stats["barrier"] == {}
        assert stats["construction"] == {}

    # --- no-transition files ---

    def test_geometry_only_changeset_has_no_transitions(self):
        # modify changes geometry only, no tag changes
        stats = _parse("182054655.xml")
        assert not any(stats[k] for k in TRACKED_KEYS)


# ---------------------------------------------------------------------------
# 2. build_category_data — pure categorization logic
# ---------------------------------------------------------------------------

class TestBuildCategoryData:
    def test_empty_stats_returns_all_eight_categories(self):
        cats = build_category_data({})
        assert [c["title"] for c in cats] == [
            "Oneways", "Access & Barriers", "Highways", "Refs",
            "Turn Restrictions", "Names", "Construction", "Classifications",
        ]

    def test_empty_stats_no_data_points(self):
        cats = build_category_data({})
        for cat in cats:
            assert cat["data"] == []

    def test_access_and_barrier_category(self):
        # access add + barrier modify + barrier add — all land in "Access & Barriers"
        cats = build_category_data(_day_stats("182054401.xml", "182434007_barrier.xml"))
        d = _d0(cats, "Access & Barriers")
        assert d["added"] >= 2    # access=private + barrier lift_gate
        assert d["modified"] >= 1  # gate → lift_gate

    def test_name_add_category(self):
        cats = build_category_data(_day_stats("182054462.xml"))
        d = _d0(cats, "Names")
        assert d == {"day": "2024-01-01", "added": 1, "modified": 0, "deleted": 0}

    def test_highway_modify_category(self):
        cats = build_category_data(_day_stats("182135772.xml"))
        d = _d0(cats, "Highways")
        assert d == {"day": "2024-01-01", "added": 0, "modified": 1, "deleted": 0}

    def test_residential_highway_excluded_from_highways_category(self):
        cats = build_category_data(_day_stats("182054462.xml"))
        assert _d0(cats, "Highways")["added"] == 0

    def test_ref_add_category(self):
        cats = build_category_data(_day_stats("182433203_ref.xml"))
        d = _d0(cats, "Refs")
        assert d["added"] == 1

    def test_construction_add_category(self):
        cats = build_category_data(_day_stats("182164518_construction.xml"))
        d = _d0(cats, "Construction")
        assert d["added"] == 1

    def test_oneway_add_category(self):
        cats = build_category_data(_day_stats("182164518_construction.xml"))
        d = _d0(cats, "Oneways")
        assert d["added"] == 2

    def test_turn_restrictions_from_real_xml(self):
        # restriction key (modify + add) and type=restriction (add)
        cats = build_category_data(_day_stats("182436200_restriction.xml"))
        d = _d0(cats, "Turn Restrictions")
        assert d["added"] >= 4    # 2 restriction adds + 2 type=restriction adds
        assert d["modified"] >= 1  # no_left_turn → no_u_turn

    def test_type_non_restriction_excluded_from_turn_restrictions(self):
        # type=multipolygon should NOT count in Turn Restrictions
        cats = build_category_data(_day_stats("182432384_type_multipolygon.xml"))
        d = _d0(cats, "Turn Restrictions")
        assert d["added"] == 0

    def test_no_transitions_file_produces_zeros(self):
        cats = build_category_data(_day_stats("182054655.xml"))
        for cat in cats:
            assert cat["data"][0]["added"] == cat["data"][0]["modified"] == cat["data"][0]["deleted"] == 0

    def test_multi_day_grouping(self):
        d1, d2 = date(2024, 1, 1), date(2024, 1, 5)
        stats = defaultdict(lambda: {key: {} for key in TRACKED_KEYS}, {
            d1: {**{key: {} for key in TRACKED_KEYS}, "oneway": {(None, "yes"): 1}},
            d2: {**{key: {} for key in TRACKED_KEYS}, "oneway": {(None, "yes"): 3}},
        })
        cat = _cat(build_category_data(stats), "Oneways")
        by_day = {d["day"]: d for d in cat["data"]}
        assert by_day["2024-01-01"]["added"] == 1
        assert by_day["2024-01-05"]["added"] == 3

    def test_category_order_is_stable(self):
        cats = build_category_data({})
        assert [c["title"] for c in cats] == [
            "Oneways", "Access & Barriers", "Highways", "Refs",
            "Turn Restrictions", "Names", "Construction", "Classifications",
        ]

    # --- pure inline tests (no fixture files) ---

    def _one_day(self, **key_transitions):
        """Build a single day_key_stats dict from {key: [(old, new, count)]}."""
        day_entry = {key: {} for key in TRACKED_KEYS}
        for key, triples in key_transitions.items():
            for old_val, new_val, count in triples:
                day_entry[key][(old_val, new_val)] = count
        return defaultdict(lambda: {key: {} for key in TRACKED_KEYS},
                           {date(2024, 1, 1): day_entry})

    def test_delete_counted_in_deleted_field(self):
        cats = build_category_data(self._one_day(oneway=[("yes", None, 1)]))
        assert _d0(cats, "Oneways") == {"day": "2024-01-01", "added": 0, "modified": 0, "deleted": 1}

    def test_modify_counted_in_modified_field(self):
        cats = build_category_data(self._one_day(oneway=[("yes", "no", 1)]))
        assert _d0(cats, "Oneways") == {"day": "2024-01-01", "added": 0, "modified": 1, "deleted": 0}

    def test_transition_count_greater_than_one_accumulates(self):
        cats = build_category_data(self._one_day(oneway=[(None, "yes", 7)]))
        assert _d0(cats, "Oneways")["added"] == 7

    def test_add_modify_delete_all_counted_in_one_day(self):
        cats = build_category_data(self._one_day(oneway=[
            (None, "yes", 2),
            ("yes", "no", 1),
            ("no", None, 3),
        ]))
        assert _d0(cats, "Oneways") == {"day": "2024-01-01", "added": 2, "modified": 1, "deleted": 3}

    def test_multi_key_category_sums_both_keys_inline(self):
        # Access & Barriers: access add + barrier delete
        cats = build_category_data(self._one_day(
            access=[(None, "private", 1)],
            barrier=[("gate", None, 2)],
        ))
        d = _d0(cats, "Access & Barriers")
        assert d["added"] == 1
        assert d["deleted"] == 2
        assert d["modified"] == 0

    def test_classifications_includes_all_type_values(self):
        # "Classifications" maps ["type"] with no filter — type=multipolygon counts
        cats = build_category_data(self._one_day(type=[(None, "multipolygon", 3)]))
        assert _d0(cats, "Classifications")["added"] == 3

    def test_type_restriction_lands_in_both_turn_restrictions_and_classifications(self):
        # type=restriction passes the Turn Restrictions filter AND the unfiltered Classifications
        cats = build_category_data(self._one_day(type=[(None, "restriction", 2)]))
        assert _d0(cats, "Turn Restrictions")["added"] == 2
        assert _d0(cats, "Classifications")["added"] == 2

    def test_type_non_restriction_excluded_from_turn_restrictions_inline(self):
        cats = build_category_data(self._one_day(type=[(None, "multipolygon", 5)]))
        assert _d0(cats, "Turn Restrictions")["added"] == 0

    def test_keys_do_not_bleed_across_categories(self):
        # oneway data must not affect Highways or any other category
        cats = build_category_data(self._one_day(oneway=[(None, "yes", 4)]))
        for title in ["Highways", "Access & Barriers", "Refs", "Turn Restrictions",
                      "Names", "Construction", "Classifications"]:
            d = _d0(cats, title)
            assert d["added"] == 0 and d["modified"] == 0 and d["deleted"] == 0

    def test_days_appear_in_ascending_order(self):
        d1, d2, d3 = date(2024, 3, 1), date(2024, 1, 1), date(2024, 2, 1)
        stats = defaultdict(lambda: {key: {} for key in TRACKED_KEYS}, {
            d1: {**{key: {} for key in TRACKED_KEYS}, "oneway": {(None, "yes"): 1}},
            d2: {**{key: {} for key in TRACKED_KEYS}, "oneway": {(None, "yes"): 2}},
            d3: {**{key: {} for key in TRACKED_KEYS}, "oneway": {(None, "yes"): 3}},
        })
        days = [d["day"] for d in _cat(build_category_data(stats), "Oneways")["data"]]
        assert days == ["2024-01-01", "2024-02-01", "2024-03-01"]


# ---------------------------------------------------------------------------
# 3. get_element_analysis — DB wiring
# ---------------------------------------------------------------------------

_PATCH_TARGET = "api.views.reports.element_analysis.ChangesetAdiff"


class _MockColumn:
    """Supports SQLAlchemy comparison operators so MagicMock patches work in Python 3.14+."""
    def __eq__(self, _): return MagicMock()
    def __ge__(self, _): return MagicMock()
    def __le__(self, _): return MagicMock()
    def __lt__(self, _): return MagicMock()
    def isnot(self, _): return MagicMock()
    def in_(self, _): return MagicMock()
    def __hash__(self): return id(self)


def _db_run(rows, team_ids=None):
    with patch(_PATCH_TARGET) as MockAdiff:
        MockAdiff.org_id = _MockColumn()
        MockAdiff.created_at = _MockColumn()
        MockAdiff.adiff_xml = _MockColumn()
        MockAdiff.team_id = _MockColumn()
        mock_q = MagicMock()
        MockAdiff.query.filter.return_value = mock_q
        mock_q.filter.return_value = mock_q
        mock_q.order_by.return_value.all.return_value = rows
        return get_element_analysis(ORG, team_ids, START, END)


def _db_row(filename, created_at):
    row = MagicMock()
    row.adiff_xml = _load(filename)
    row.created_at = created_at
    return row


class TestGetElementAnalysis:
    def test_empty_db_returns_200_with_no_data(self):
        result = _db_run([])
        assert result["status"] == 200
        assert result["lastUpdated"] is None
        for cat in result["categories"]:
            assert cat["data"] == []

    def test_real_xml_row_produces_correct_category_counts(self):
        rows = [_db_row("182054401.xml", datetime(2024, 1, 10, 12, 0, 0))]
        result = _db_run(rows)
        cat = _cat(result["categories"], "Access & Barriers")
        assert cat["data"][0]["added"] == 1

    def test_last_updated_set_from_row_created_at(self):
        rows = [_db_row("182054401.xml", datetime(2024, 1, 10, 15, 30, 0))]
        result = _db_run(rows)
        assert result["lastUpdated"] == "2024-01-10T15:30:00Z"

    def test_team_ids_none_skips_team_filter(self):
        with patch(_PATCH_TARGET) as MockAdiff:
            MockAdiff.org_id = _MockColumn()
            MockAdiff.created_at = _MockColumn()
            MockAdiff.adiff_xml = _MockColumn()
            MockAdiff.team_id = _MockColumn()
            mock_q = MagicMock()
            MockAdiff.query.filter.return_value = mock_q
            mock_q.order_by.return_value.all.return_value = []
            get_element_analysis(ORG, None, START, END)
            mock_q.filter.assert_not_called()

    def test_team_ids_provided_applies_team_filter(self):
        with patch(_PATCH_TARGET) as MockAdiff:
            MockAdiff.org_id = _MockColumn()
            MockAdiff.created_at = _MockColumn()
            MockAdiff.adiff_xml = _MockColumn()
            MockAdiff.team_id = _MockColumn()
            mock_q = MagicMock()
            MockAdiff.query.filter.return_value = mock_q
            mock_q.filter.return_value = mock_q
            mock_q.order_by.return_value.all.return_value = []
            get_element_analysis(ORG, [1, 2], START, END)
            mock_q.filter.assert_called_once()
