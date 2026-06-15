#!/usr/bin/env python3
"""
Inspect the task statuses of a MapRoulette challenge.

Standalone CLI (no Flask app context required). Uses the official
`maproulette` API wrapper (https://pypi.org/project/maproulette/).

Two data sources, both single-request:

    * Summary (default): Challenge.get_challenge_statistics_by_id()
        -> GET /data/challenge/{id}. ~266 bytes; aggregate status counts.

    * Per-task (--detailed / --csv): Challenge.extract_task_summaries()
        -> GET /challenge/{id}/tasks/extract (CSV). One row per task with
        status AND the OSM usernames of mapper + reviewer + review status.

GOTCHA: the extract endpoint's default (empty) status filter is NOT "all" --
it silently omits the completed statuses (Fixed/FalsePositive/AlreadyFixed).
You must pass an explicit status filter to get every task, so this script
always sends status="0,1,2,3,4,5,6".

NOTE: /data/challenge and /tasks/extract are user-scoped endpoints. They need
an API key tied to a real MR account (the "userId|token" form), not a bare
token. Set MR_API_KEY accordingly.

Usage:
    python scripts/maproulette_script.py                 # challenge 25460, summary
    python scripts/maproulette_script.py -c 25460 --detailed
    python scripts/maproulette_script.py -c 25460 --csv out.csv
    python scripts/maproulette_script.py -c 25460 --csv out.csv --status 1,5

Auth: reads MR_API_KEY (and optional MR_API_URL) from the environment or
from backend/.env.
"""

import argparse
import csv
import io
import os
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

import maproulette

DEFAULT_CHALLENGE_ID = 25460

# Every status code, used to force the extract endpoint to return all tasks.
ALL_STATUSES = "0,1,2,3,4,5,6"

# Maps the /data/challenge summary's action keys to human-readable labels.
# (`available` = Created, `tooHard` = Can't Complete.)
SUMMARY_LABELS = [
    ("available", "Created"),
    ("fixed", "Fixed"),
    ("falsePositive", "False Positive"),
    ("skipped", "Skipped"),
    ("deleted", "Deleted"),
    ("alreadyFixed", "Already Fixed"),
    ("tooHard", "Can't Complete"),
]

# Columns kept from the extract CSV when writing per-task output.
CSV_COLUMNS = [
    "TaskID",
    "TaskStatus",
    "TaskPriority",
    "MappedOn",
    "Mapper",
    "ReviewStatus",
    "Reviewer",
    "ReviewedAt",
]


def load_env():
    """Populate os.environ from backend/.env if not already set."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    try:
        from dotenv import load_dotenv

        load_dotenv(env_path)
        return
    except ImportError:
        pass

    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def build_challenge_client():
    """Construct a maproulette.Challenge from MR_API_KEY / MR_API_URL."""
    api_key = os.environ.get("MR_API_KEY")
    if not api_key:
        sys.exit("MR_API_KEY not set (checked environment and backend/.env)")

    # The wrapper takes hostname/protocol/api_version rather than a full URL,
    # so split MR_API_URL if one is provided.
    api_url = os.environ.get("MR_API_URL")
    kwargs = {"api_key": api_key}
    if api_url:
        parsed = urlparse(api_url)
        if parsed.hostname:
            kwargs["hostname"] = parsed.hostname
        if parsed.scheme:
            kwargs["protocol"] = parsed.scheme
        if parsed.path and parsed.path != "/":
            kwargs["api_version"] = parsed.path.rstrip("/")

    config = maproulette.Configuration(**kwargs)
    return maproulette.Challenge(config)


def print_summary(challenge_client, challenge_id):
    """Fast aggregate status breakdown via /data/challenge/{id}."""
    resp = challenge_client.get_challenge_statistics_by_id(challenge_id)
    data = resp["data"]
    if isinstance(data, list):
        data = data[0] if data else {}
    name = data.get("name")
    actions = data.get("actions", {})
    total = actions.get("total", 0)

    print(f"Challenge {challenge_id}: {name or '(name unavailable)'}")
    print(f"\nTotal tasks: {total:,}")
    print("\nBy status")
    print("-" * len("By status"))
    for key, label in SUMMARY_LABELS:
        count = actions.get(key, 0)
        pct = (count / total * 100) if total else 0
        print(f"  {label:<16} {count:>8,}  {pct:5.1f}%")

    validated = actions.get("validated")
    avg = actions.get("avgTimeSpent")
    if validated is not None:
        print(f"\n  validated: {validated:,}   avgTimeSpent: {avg}")
    return total


def fetch_extract_rows(challenge_client, challenge_id, status):
    """Per-task rows from /challenge/{id}/tasks/extract (CSV -> list of dicts)."""
    resp = challenge_client.extract_task_summaries(
        challenge_id, limit=100000, status=status or ALL_STATUSES
    )
    return list(csv.DictReader(io.StringIO(resp["data"])))


def print_detailed(rows):
    total = len(rows)
    print(f"\nPer-task rows: {total:,}")

    print("\nBy status (per-task)")
    print("-" * len("By status (per-task)"))
    for label, count in sorted(Counter(r["TaskStatus"] for r in rows).items()):
        pct = (count / total * 100) if total else 0
        print(f"  {label:<18} {count:>8,}  {pct:5.1f}%")

    print("\nBy review status")
    print("-" * len("By review status"))
    review = Counter((r["ReviewStatus"] or "(none)") for r in rows)
    for label, count in sorted(review.items()):
        pct = (count / total * 100) if total else 0
        print(f"  {label:<24} {count:>8,}  {pct:5.1f}%")

    mapped = sum(1 for r in rows if r["Mapper"])
    reviewed = sum(1 for r in rows if r["Reviewer"])
    print(f"\n  rows with Mapper: {mapped:,}   rows with Reviewer: {reviewed:,}")


def write_csv(rows, path):
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for r in rows:
            writer.writerow(r)
    print(f"\nWrote {len(rows):,} rows to {path}")


def main():
    parser = argparse.ArgumentParser(
        description="Report task statuses for a MapRoulette challenge."
    )
    parser.add_argument(
        "-c",
        "--challenge",
        type=int,
        default=DEFAULT_CHALLENGE_ID,
        help=f"Challenge id (default: {DEFAULT_CHALLENGE_ID})",
    )
    parser.add_argument(
        "--detailed",
        action="store_true",
        help="Pull per-task rows (status + mapper + reviewer) from extract",
    )
    parser.add_argument(
        "--status",
        help="Comma-separated status codes to include (default: all)",
    )
    parser.add_argument(
        "--csv",
        metavar="PATH",
        help="Write per-task rows to this CSV file (implies --detailed)",
    )
    args = parser.parse_args()

    load_env()
    challenge_client = build_challenge_client()
    challenge_id = args.challenge

    print_summary(challenge_client, challenge_id)

    if args.detailed or args.csv:
        rows = fetch_extract_rows(challenge_client, challenge_id, args.status)
        print_detailed(rows)
        if args.csv:
            write_csv(rows, args.csv)


if __name__ == "__main__":
    main()
