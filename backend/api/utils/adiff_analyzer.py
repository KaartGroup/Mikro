import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import requests

_STRIP_TAGS_RE = re.compile(r'<(?:nd|bounds)\b[^>]*/>|</?member\b[^>]*>')

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

    def fetch_adiff_xml(self, changeset_id):
        """Fetch adiff XML for a single changeset, stripping <nd> and <bounds> lines while streaming.

        Processes the response line by line so the full file is never held in memory.
        Returns the stripped XML string, or None if osmcha has no diff or returns an error.
        """
        url = f"https://adiffs.osmcha.org/changesets/{changeset_id}.adiff"
        try:
            resp = self.session.get(url, timeout=120, stream=True)
            if resp.status_code == 404:
                logger.debug("No adiff for changeset %s (404)", changeset_id)
                return None
            if resp.status_code != 200:
                logger.warning(
                    "Unexpected status %s for changeset %s — skipping",
                    resp.status_code, changeset_id,
                )
                resp.raise_for_status()
            encoding = resp.encoding or 'utf-8'
            lines = []
            for raw in resp.iter_lines():
                line = raw.decode(encoding) if isinstance(raw, bytes) else raw
                if not _STRIP_TAGS_RE.search(line):
                    lines.append(line)
            result = '\n'.join(lines)
            assert result.strip(), (
                f"Empty adiff body for changeset {changeset_id} "
                f"(status={resp.status_code} encoding={encoding})"
            )
            assert '<osm' in result, (
                f"Response for changeset {changeset_id} has no <osm> root — got: {result[:200]!r}"
            )
            assert '<action' in result, (
                f"Adiff for changeset {changeset_id} has no <action> elements — got: {result[:200]!r}"
            )
            logger.info(
                "Fetched adiff for changeset %s: %d lines, %d bytes",
                changeset_id, len(lines), len(result),
            )
            return result
        except (requests.RequestException, UnicodeDecodeError) as e:
            logger.warning("Failed to fetch adiff for changeset %s: %s", changeset_id, e)
            return None

