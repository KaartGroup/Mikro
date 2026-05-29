"""
Verify that ChangesetFetcher returns changesets newest-first.

Fetches a small window of real changesets from the OSM API for a known-active
mapper and asserts that created_at timestamps are in descending order.

Run with:
    python -m pytest tests/test_changeset_order.py -s
or directly:
    python tests/test_changeset_order.py
"""
import sys
import os
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api.utils.changeset_fetcher import ChangesetFetcher


# A well-known OSM mapper with frequent edits — substitute any active username.
TEST_USERNAME = "kaartense"
WINDOW_DAYS = 90


def test_changeset_order_is_newest_first():
    until = datetime.now(timezone.utc)
    since = until - timedelta(days=WINDOW_DAYS)

    fetcher = ChangesetFetcher()
    changesets = fetcher.fetch([TEST_USERNAME], since=since, until=until)

    assert changesets, f"No changesets returned for {TEST_USERNAME} in the last {WINDOW_DAYS} days"

    timestamps = [
        datetime.fromisoformat(cs["created_at"].replace("Z", "+00:00"))
        for cs in changesets
    ]

    for i in range(len(timestamps) - 1):
        assert timestamps[i] >= timestamps[i + 1], (
            f"Order violation at index {i}: "
            f"{timestamps[i].isoformat()} < {timestamps[i + 1].isoformat()}"
        )

    print(f"\nPassed: {len(changesets)} changesets are newest-first")
    print(f"  Newest: {timestamps[0].isoformat()}")
    print(f"  Oldest: {timestamps[-1].isoformat()}")


if __name__ == "__main__":
    test_changeset_order_is_newest_first()
    print("OK")
