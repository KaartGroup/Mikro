#!/usr/bin/env python3
"""
Fetch a changeset adiff live from osmcha, apply nd/bounds stripping, and write to a file.

Useful for previewing what will actually be stored before running a backfill.

Usage:
    python scripts/preview_adiff_fetch.py <changeset_id> [--out <path>] [--raw]

Examples:
    python scripts/preview_adiff_fetch.py 182487649
    python scripts/preview_adiff_fetch.py 182487649 --out /tmp/cs.xml

Run from the backend/ directory with the virtualenv active.
"""

import argparse
import os
import sys
import xml.dom.minidom


def _parse_args():
    p = argparse.ArgumentParser(description="Fetch and preview a stripped adiff XML from osmcha.")
    p.add_argument("changeset_id", type=int, help="OSM changeset ID")
    p.add_argument("--out", metavar="FILE", help="Output path (default: <changeset_id>_stripped.xml)")
    p.add_argument("--raw", action="store_true", help="Write raw XML without pretty-printing")
    return p.parse_args()


def main():
    args = _parse_args()

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from api.utils.adiff_analyzer import AdiffAnalyzer

    print(f"Fetching changeset {args.changeset_id} from osmcha (streaming)...")
    xml_text = AdiffAnalyzer().fetch_adiff_xml(args.changeset_id)

    if xml_text is None:
        print(f"No adiff found for changeset {args.changeset_id}.", file=sys.stderr)
        sys.exit(1)

    raw_bytes = len(xml_text.encode())
    print(f"Fetched and stripped: {raw_bytes:,} bytes ({raw_bytes / (1024*1024):.2f} MB)")

    if not args.raw:
        try:
            xml_text = xml.dom.minidom.parseString(xml_text).toprettyxml(indent="  ")
            lines = xml_text.splitlines()
            if lines and lines[0].startswith("<?xml"):
                xml_text = "\n".join(lines[1:]).lstrip("\n")
        except Exception:
            pass

    out_path = args.out or f"{args.changeset_id}_stripped.xml"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(xml_text)

    print(f"Wrote {len(xml_text):,} chars to {out_path}")


if __name__ == "__main__":
    main()
