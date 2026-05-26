#!/usr/bin/env python3
"""
Fetch a ChangesetAdiff record from the database and write its XML to a file.

Usage:
    python scripts/fetch_adiff.py <changeset_id> [--org <org_id>] [--out <path>]

Examples:
    python scripts/fetch_adiff.py 123456789
    python scripts/fetch_adiff.py 123456789 --org myorg --out /tmp/cs.xml

Reads DATABASE_URL (or DB_* vars) from the environment, the same way the app does.
Run from the backend/ directory with the virtualenv active.
"""

import argparse
import os
import sys
import xml.dom.minidom


def _parse_args():
    p = argparse.ArgumentParser(description="Fetch a changeset adiff XML from the DB.")
    p.add_argument("changeset_id", type=int, help="OSM changeset ID")
    p.add_argument("--org", metavar="ORG_ID", help="Filter by org_id (optional)")
    p.add_argument("--out", metavar="FILE", help="Output path (default: <changeset_id>.xml)")
    p.add_argument("--raw", action="store_true", help="Write raw XML without pretty-printing")
    return p.parse_args()


def main():
    args = _parse_args()

    # Bootstrap the Flask app so SQLAlchemy is wired up.
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from app import create_app
    from api.database import ChangesetAdiff

    app = create_app()
    with app.app_context():
        q = ChangesetAdiff.query.filter_by(changeset_id=args.changeset_id)
        if args.org:
            q = q.filter_by(org_id=args.org)
        row = q.first()

    if row is None:
        org_hint = f" (org={args.org})" if args.org else ""
        print(f"No record found for changeset {args.changeset_id}{org_hint}.", file=sys.stderr)
        sys.exit(1)

    if row.adiff_xml is None:
        print(f"Record found but adiff_xml is NULL for changeset {args.changeset_id}.", file=sys.stderr)
        sys.exit(1)

    xml_text = row.adiff_xml
    if not args.raw:
        try:
            xml_text = xml.dom.minidom.parseString(xml_text).toprettyxml(indent="  ")
            # minidom adds an XML declaration; strip it if the source didn't have one
            lines = xml_text.splitlines()
            if lines and lines[0].startswith("<?xml"):
                xml_text = "\n".join(lines[1:]).lstrip("\n")
        except Exception:
            pass  # fall back to raw if parsing fails

    out_path = args.out or f"{args.changeset_id}.xml"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(xml_text)

    print(f"Wrote {len(xml_text):,} chars to {out_path}")
    print(f"  org_id:      {row.org_id}")
    print(f"  osm_user:    {row.osm_user}")
    print(f"  created_at:  {row.created_at}")


if __name__ == "__main__":
    main()
