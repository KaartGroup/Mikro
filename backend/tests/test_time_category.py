import pytest
from types import SimpleNamespace

from api.views.reports.timekeeping_stats import _categorize_activity


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_activity_row(activity=None, subcategory_name=None, **kwargs):
    """Return a minimal row-like object for testing _categorize_activity.

    Mirrors the shape of a TimeEntry query row. Pass subcategory_name to
    exercise subcategory-based categorization logic.
    Extra kwargs let callers attach other fields tests need (e.g. seconds=3600).
    """
    return SimpleNamespace(activity=activity, subcategory_name=subcategory_name, **kwargs)


def test_qc_review_community_qc_maps_to_community_qc():
    row = make_activity_row(activity="qc_review", subcategory_name="Community QC")
    assert _categorize_activity(row.activity, row.subcategory_name) == "community_qc"

def test_qc_review_no_subcategory_maps_to_qc():
    row = make_activity_row(activity="qc_review", subcategory_name=None)
    assert _categorize_activity(row.activity, row.subcategory_name) == "qc"

def test_qc_review_kaart_qc_maps_to_qc():
    row = make_activity_row(activity="qc_review", subcategory_name="Kaart QC")
    assert _categorize_activity(row.activity, row.subcategory_name) == "qc"

def test_validating_community_project_maps_to_community_qc():
    row = make_activity_row(activity="validating", subcategory_name="Community Project")
    assert _categorize_activity(row.activity, row.subcategory_name) == "community_qc"

def test_validating_non_community_project_maps_to_validating():
    row = make_activity_row(activity="validating", subcategory_name=None)
    assert _categorize_activity(row.activity, row.subcategory_name) == "qc"

def test_validating_non_community_project_maps_to_validating():
    row = make_activity_row(activity="validating", subcategory_name="Kaart QC")
    assert _categorize_activity(row.activity, row.subcategory_name) == "qc"

def test_editing_maps_to_editing():
    row = make_activity_row(activity="editing", subcategory_name=None)
    assert _categorize_activity(row.activity, row.subcategory_name) == "editing"

def test_editing_project_maps_to_editing():
    row = make_activity_row(activity="editing", subcategory_name="project")
    assert _categorize_activity(row.activity, row.subcategory_name) == "editing"

def test_other_activities_map_to_other():
    row = make_activity_row(activity="other", subcategory_name="Mapping")
    assert _categorize_activity(row.activity, row.subcategory_name) == "other"

def test_documentation_maps_to_documentation():
    row = make_activity_row(activity="documentation", subcategory_name=None)
    assert _categorize_activity(row.activity, row.subcategory_name) == "documentation"

def test_documentation_wiki_documentation_maps_to_community_documentation():
    row = make_activity_row(activity="documentation", subcategory_name="Wiki Documentation")
    assert _categorize_activity(row.activity, row.subcategory_name) == "community_documentation"

def test_other_community_outreach_maps_to_community_outreach():
    row = make_activity_row(activity="other", subcategory_name="Community Outreach")
    assert _categorize_activity(row.activity, row.subcategory_name) == "community_outreach"

def test_other_does_fuzzy_matching_for_community_outreach():
    row = make_activity_row(activity="other", subcategory_name="Community outreach - IWD Event Indonesia")
    assert _categorize_activity(row.activity, row.subcategory_name) == "community_outreach"

def test_meeting_maps_to_meeting():
    row = make_activity_row(activity="meeting", subcategory_name=None)
    assert _categorize_activity(row.activity, row.subcategory_name) == "meeting"

def test_meeting_community_maps_to_community_meeting():
    row = make_activity_row(activity="meeting", subcategory_name="Community")
    assert _categorize_activity(row.activity, row.subcategory_name) == "community_meeting"

def test_meeting_internal_maps_to_meeting():
    row = make_activity_row(activity="meeting", subcategory_name="Internal Team Members")
    assert _categorize_activity(row.activity, row.subcategory_name) == "meeting"

def test_training_community_maps_to_community_training():
    row = make_activity_row(activity="training", subcategory_name="Community")
    assert _categorize_activity(row.activity, row.subcategory_name) == "community_training"

def test_training_internal_maps_to_training():
    row = make_activity_row(activity="training", subcategory_name="Internal / Kaart")
    assert _categorize_activity(row.activity, row.subcategory_name) == "training"

def test_imagery_capture_maps_to_imagery_capture():
    row = make_activity_row(activity="imagery_capture", subcategory_name="Narrow Road Imagery Collection")
    assert _categorize_activity(row.activity, row.subcategory_name) == "imagery_capture"

def test_project_creation_maps_to_project_creation():
    row = make_activity_row(activity="project_creation", subcategory_name=None)
    assert _categorize_activity(row.activity, row.subcategory_name) == "project_creation"

def test_project_creation_community_project_maps_to_project_creation():
    row = make_activity_row(activity="project_creation", subcategory_name="Community Project")
    assert _categorize_activity(row.activity, row.subcategory_name) == "project_creation"

def test_documentation_non_wiki_maps_to_documentation():
    row = make_activity_row(activity="documentation", subcategory_name="Project Workflow Documentation")
    assert _categorize_activity(row.activity, row.subcategory_name) == "documentation"

def test_other_community_typo_maps_to_community_outreach():
    row = make_activity_row(activity="other", subcategory_name="Communiry Event")
    assert _categorize_activity(row.activity, row.subcategory_name) == "community_outreach"

def test_other_community_qc_notes_maps_to_community_outreach():
    row = make_activity_row(activity="other", subcategory_name="Community QC/Notes Review")
    assert _categorize_activity(row.activity, row.subcategory_name) == "community_outreach"

def test_other_community_project_updates_maps_to_community_outreach():
    row = make_activity_row(activity="other", subcategory_name="community project/challenge updates")
    assert _categorize_activity(row.activity, row.subcategory_name) == "community_outreach"

def test_other_non_community_maps_to_other():
    row = make_activity_row(activity="other", subcategory_name="General")
    assert _categorize_activity(row.activity, row.subcategory_name) == "other"

def test_unhandled_known_activity_raises():
    # "mapping" is a legacy ACTIVITY_SLUG with no categorization branch yet.
    with pytest.raises(ValueError):
        _categorize_activity("mapping", None)


def activity_rows(*pairs):
    """Return a list of row-like objects from (activity, subcategory_name) pairs.

    Each element can be a plain string (subcategory_name=None) or a
    (activity, subcategory_name) tuple.

        activity_rows("editing", ("meeting", "Weekly Sync"), "other")
    """
    rows = []
    for p in pairs:
        if isinstance(p, tuple):
            activity, subcategory_name = p
        else:
            activity, subcategory_name = p, None
        rows.append(make_activity_row(activity=activity, subcategory_name=subcategory_name))
    return rows
