import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import requests

logger = logging.getLogger(__name__)

TRACKED_KEYS = {
    "oneway",
    "highway",
    "access",
    "barrier",
    "ref",
    "name",
    "construction",
    "type",
    "restriction",
}

_HIGH_PRIORITY_HIGHWAY = {
    "motorway", "motorway_link",
    "trunk", "trunk_link",
    "primary", "primary_link",
    "secondary", "secondary_link",
    "tertiary", "tertiary_link",
}

KEY_FILTERS = {
    # "highway": lambda old, new: old in _HIGH_PRIORITY_HIGHWAY or new in _HIGH_PRIORITY_HIGHWAY,
}


# ---------------------------------------------------------------------------
# Pure parsing helpers — no I/O, easy to unit-test directly
# ---------------------------------------------------------------------------

def _element_tag_values(container):
    """Return {key: value} for all tags in the first OSM element inside container."""
    if container is None:
        return {}
    for element in container:
        return {tag.get("k"): tag.get("v") for tag in element.findall("tag")}
    return {}


def parse_adiff_transitions(xml_text, tracked_keys, key_filters=None):
    """
    Parse adiff XML and return value transitions for each tracked key.

    Returns {key: {(old_val, new_val): count}} where None means the key was absent.
    Only records transitions where something actually changed (skips old == new).

    key_filters: optional {key: callable(old_val, new_val) -> bool}. When present
    for a key, only transitions that pass the filter are recorded.
    """
    key_filters = key_filters or {}
    root = ET.fromstring(xml_text)
    stats = {key: {} for key in tracked_keys}

    def record(key, old_val, new_val):
        if old_val == new_val:
            return
        f = key_filters.get(key)
        if f and not f(old_val, new_val):
            return
        t = (old_val, new_val)
        stats[key][t] = stats[key].get(t, 0) + 1

    for action in root.findall("action"):
        action_type = action.get("type")
        if action_type == "create":
            # osmcha places the created element directly under <action> (no <new> wrapper)
            new_tags = _element_tag_values(action)
            for key in tracked_keys:
                if key in new_tags:
                    record(key, None, new_tags[key])
        elif action_type == "delete":
            old_tags = _element_tag_values(action.find("old"))
            for key in tracked_keys:
                if key in old_tags:
                    record(key, old_tags[key], None)
        elif action_type == "modify":
            old_tags = _element_tag_values(action.find("old"))
            new_tags = _element_tag_values(action.find("new"))
            for key in tracked_keys:
                old_val = old_tags.get(key)
                new_val = new_tags.get(key)
                if old_val != new_val:
                    record(key, old_val, new_val)

    return stats


def merge_transitions(totals, stats):
    """Merge a per-changeset stats dict into running totals (mutates totals)."""
    for key, transitions in stats.items():
        for transition, count in transitions.items():
            totals[key][transition] = totals[key].get(transition, 0) + count


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

@dataclass
class AnalysisResult:
    changeset_count: int
    changes_count: int
    # {key: {(old_val, new_val): count}}
    tag_stats: dict
    # changeset dicts that had any tracked-key activity, each with 'tag_stats' added
    active_changesets: list


# ---------------------------------------------------------------------------
# AdiffAnalyzer
# ---------------------------------------------------------------------------

class AdiffAnalyzer:
    """
    Fetches adiffs from osmcha and analyzes tag transitions for a set of tracked keys.
    Accepts any list of changeset dicts; knows nothing about how they were fetched.
    """

    def __init__(self, tracked_keys=TRACKED_KEYS, key_filters=KEY_FILTERS, session=None):
        self.tracked_keys = frozenset(tracked_keys)
        self.key_filters = key_filters or {}
        self.session = session or requests.Session()

    def analyze(self, changesets):
        """Fetch and analyze adiffs for each changeset. Returns AnalysisResult."""
        tag_stats = {key: {} for key in self.tracked_keys}
        active_changesets = []
        changes_count = sum(cs.get("changes_count", 0) for cs in changesets)
        total = len(changesets)

        print(f"Analyzing {total} changesets...")
        for i, cs in enumerate(changesets, 1):
            print(f"  [{i}/{total}] changeset {cs['id']}...")
            cs_stats = self._fetch_adiff(cs["id"])
            merge_transitions(tag_stats, cs_stats)
            if any(cs_stats[k] for k in self.tracked_keys):
                active_changesets.append({**cs, "tag_stats": cs_stats})
                for key, transitions in cs_stats.items():
                    if transitions:
                        print(f"    ^ {key}: {transitions}")

        print(f"Analysis done: {changes_count} changes, {len(active_changesets)} changesets had activity")
        return AnalysisResult(total, changes_count, tag_stats, active_changesets)

    def fetch_adiff_xml(self, changeset_id):
        """Fetch the raw adiff XML string for a single changeset.

        Returns the XML string, or None if osmcha has no diff or returns an error.
        Use this when storing for later reprocessing.
        """
        url = f"https://adiffs.osmcha.org/changesets/{changeset_id}.adiff"
        try:
            resp = self.session.get(url, timeout=120)
            if resp.status_code == 404:
                logger.debug("No adiff for changeset %s", changeset_id)
                return None
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as e:
            logger.warning("Failed to fetch adiff for changeset %s: %s", changeset_id, e)
            return None

    def _fetch_adiff(self, changeset_id):
        url = f"https://adiffs.osmcha.org/changesets/{changeset_id}.adiff"
        resp = self.session.get(url, timeout=120)
        if resp.status_code == 404:
            print(f"  [no diff] changeset {changeset_id}")
            return {key: {} for key in self.tracked_keys}
        resp.raise_for_status()
        return parse_adiff_transitions(resp.text, self.tracked_keys, self.key_filters)
