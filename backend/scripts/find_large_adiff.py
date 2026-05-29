"""
Identify the changeset whose adiff XML caused an OOM crash in window 5
(2026-05-09 → 2026-05-11).

Fetches the same changeset list the backfill job would collect, then
HEAD-checks osmcha for each one to find the size. Skips anything that
was already in the DB (the 242 existing ones didn't cause the crash).

Run from backend/:
    python scripts/find_large_adiff.py
"""

import os
import sys

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

from datetime import datetime, timezone
import requests

from api.utils.changeset_fetcher import ChangesetFetcher

WINDOW_START = datetime(2026, 5, 9, tzinfo=timezone.utc)
WINDOW_END   = datetime(2026, 5, 11, tzinfo=timezone.utc)

# Users that had changesets in this window (from the logs).
ACTIVE_USERS = [
    "Josuer", "amtplskaart", "felipeeugenio", "AndresDuhour",
    "Timmy_Tesseract", "Ezra Edwards", "jptolosa", "luisrobledomx1",
    "Stephanievanr", "kaartense", "VMPanes", "JuanMelo", "mapitero",
]


def adiff_size(changeset_id, session):
    """Return (size_bytes, status_code) for the osmcha adiff of this changeset.

    Uses a streaming GET (reads up to 1 byte) rather than HEAD because
    osmcha doesn't always populate Content-Length on HEAD responses.
    """
    url = f"https://adiffs.osmcha.org/changesets/{changeset_id}.adiff"
    try:
        resp = session.get(url, timeout=30, stream=True)
        cl = resp.headers.get("Content-Length")
        resp.close()
        size = int(cl) if cl else None
        return size, resp.status_code
    except requests.RequestException as e:
        return None, str(e)


def main():
    print(f"Fetching changesets for window {WINDOW_START.date()} → {WINDOW_END.date()}")
    print("(only querying users that had activity in this window)")
    print()

    fetcher = ChangesetFetcher()
    changesets = fetcher.fetch(ACTIVE_USERS, WINDOW_START, WINDOW_END)

    # Sort largest-changes-count first — the OOM culprit will be near the top.
    changesets.sort(key=lambda cs: cs.get("changes_count", 0), reverse=True)

    print(f"\n{'ID':>12}  {'changes':>8}  {'user':<25}  {'created_at'}")
    print("-" * 75)
    for cs in changesets[:30]:
        print(
            f"{cs['id']:>12}  {cs.get('changes_count', '?'):>8}  "
            f"{cs.get('user', '?'):<25}  {cs.get('created_at', '?')}"
        )

    print(f"\nChecking adiff sizes for top 15 by changes_count…")
    session = requests.Session()
    session.headers["User-Agent"] = "Mikro-diagnostic/1.0"

    print(f"\n{'ID':>12}  {'changes':>8}  {'adiff_bytes':>14}  {'adiff_MB':>10}  status")
    print("-" * 65)
    for cs in changesets[:15]:
        size, status = adiff_size(cs["id"], session)
        mb = f"{size / 1024 / 1024:.1f}" if isinstance(size, int) else "?"
        print(
            f"{cs['id']:>12}  {cs.get('changes_count', '?'):>8}  "
            f"{str(size) if size else '?':>14}  {mb:>10}  {status}"
        )

    print("\nDone. Any adiff_MB > 50 would have triggered an OOM on a constrained container.")


if __name__ == "__main__":
    main()
