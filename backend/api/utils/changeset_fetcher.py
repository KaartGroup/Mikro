import time

import requests

_PAGE_SIZE = 100


def changesets_to_heatmap_points(changesets):
    """Convert OSM changeset JSON dicts to [[lat, lon, intensity], ...] heatmap points."""
    points = []
    for cs in changesets:
        min_lat = cs.get("min_lat")
        max_lat = cs.get("max_lat")
        min_lon = cs.get("min_lon")
        max_lon = cs.get("max_lon")
        if min_lat is not None and max_lat is not None and min_lon is not None and max_lon is not None:
            lat = (float(min_lat) + float(max_lat)) / 2
            lon = (float(min_lon) + float(max_lon)) / 2
            intensity = max(int(cs.get("changes_count", 0)), 1)
            points.append([lat, lon, intensity])
    return points


class ChangesetFetcher:
    """
    Fetches changeset metadata from the OSM API for a set of users and a time window.
    Returns plain changeset dicts; knows nothing about adiff or tag analysis.
    """

    def __init__(self, session=None):
        self.session = session or requests.Session()

    def fetch(self, osm_usernames, since, until=None, max_results=None):
        """Return a flat list of changeset dicts for all given usernames."""
        usernames = [u for u in osm_usernames if u]
        print(f"Collecting changesets for {len(usernames)} users...")
        all_changesets = []
        for username in usernames:
            all_changesets.extend(self._fetch_for_user(username, since, until, max_results=max_results))
        print(f"Collection done: {len(all_changesets)} total changesets")
        return all_changesets

    def _fetch_for_user(self, osm_username, since, until, max_results=None):
        print(f"  Fetching changesets for {osm_username}...")
        closed_after = since.strftime("%Y-%m-%dT%H:%M:%SZ")
        created_before = until.strftime("%Y-%m-%dT%H:%M:%SZ") if until else None
        all_changesets = []
        page = 1

        while True:
            print(f"    Page {page}: fetching up to {_PAGE_SIZE} changesets...")
            time_param = closed_after if created_before is None else f"{closed_after},{created_before}"
            url = (
                f"https://api.openstreetmap.org/api/0.6/changesets.json"
                f"?display_name={osm_username}&time={time_param}&limit={_PAGE_SIZE}"
            )
            resp = self._get_with_retry(url)
            resp.raise_for_status()
            changesets = resp.json().get("changesets", [])
            print(f"    Got {len(changesets)} changesets")
            all_changesets.extend(changesets)

            if max_results and len(all_changesets) >= max_results:
                return all_changesets[:max_results]

            if len(changesets) < _PAGE_SIZE:
                break

            # Results are newest-first; use oldest created_at as the next upper bound.
            created_before = changesets[-1]["created_at"]
            page += 1

        print(f"  Done {osm_username}: {len(all_changesets)} changesets collected")
        return all_changesets

    def _get_with_retry(self, url):
        for attempt in range(4):
            resp = self.session.get(url, timeout=30)
            if resp.status_code != 429:
                return resp
            print(f"    Rate limited, retrying in {2 ** attempt}s...")
            time.sleep(2 ** attempt)
        return resp
