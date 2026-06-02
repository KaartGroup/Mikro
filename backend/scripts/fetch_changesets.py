#!/usr/bin/env python3
"""
Fetch OSM changesets for a given user over the last 4 weeks.

Usage:
    python fetch_changesets.py
    python fetch_changesets.py --username "Rus Ionut"
    python fetch_changesets.py --username "Rus Ionut" --weeks 8
"""

import argparse
import xml.etree.ElementTree as ET
from datetime import date, timedelta

import requests


def fetch_user_changesets(username, start_str, end_str):
    # OSM caps at 100 per request with no offset parameter.
    # Paginate cursor-style: use the oldest changeset's created_at
    # as the new end time until a page returns fewer than 100.
    osm_url = "https://api.openstreetmap.org/api/0.6/changesets"
    changesets = []
    page_end = end_str
    page_num = 0

    while True:
        page_num += 1
        params = {
            "display_name": username,
            "time": f"{start_str},{page_end}",
            "closed": "true",
        }
        try:
            resp = requests.get(osm_url, params=params, timeout=30)
            if not resp.ok:
                print(f"OSM API returned {resp.status_code} on page {page_num}")
                break
        except requests.RequestException as e:
            print(f"Request failed on page {page_num}: {e}")
            break

        try:
            root = ET.fromstring(resp.text)
        except ET.ParseError as e:
            print(f"Failed to parse XML on page {page_num}: {e}")
            break

        page = []
        for cs in root.findall("changeset"):
            cs_id = cs.get("id")
            created = cs.get("created_at", "")
            if cs_id:
                page.append((cs_id, created))

        changesets.extend(page)
        print(f"  Page {page_num}: {len(page)} changesets (total so far: {len(changesets)})")

        if len(page) < 100:
            break

        oldest_created = min(created for _, created in page if created)
        page_end = oldest_created

    return username, changesets


def main():
    parser = argparse.ArgumentParser(description="Fetch OSM changesets for a user")
    parser.add_argument("--username", default="Josuer", help="OSM display name")
    parser.add_argument("--weeks", type=int, default=4, help="How many weeks back to search")
    args = parser.parse_args()

    today = date.today()
    start = today - timedelta(weeks=args.weeks)
    start_str = start.isoformat()
    end_str = today.isoformat()

    print(f"Fetching changesets for '{args.username}' from {start_str} to {end_str}...")

    username, changesets = fetch_user_changesets(args.username, start_str, end_str)

    if not changesets:
        print("No changesets found.")
        return

    print(f"\nFound {len(changesets)} changeset(s):\n")
    print(f"{'ID':<12} {'Created At'}")
    print("-" * 40)
    for cs_id, created in changesets:
        print(f"{cs_id:<12} {created}")


if __name__ == "__main__":
    main()
