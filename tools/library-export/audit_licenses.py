"""Audit the library for redistributable content (Soferia).

Walks the Sefaria-export style library (including Sofer's imported extras:
Dicta, Otzaria, Wikitext, Ben-Yehuda, Word files) and classifies every
edition with Sofer's own licence rules (``sofer.licenses``), plus Sofer's
"never offered" list (``sofer.not_offered``).

It reads only the first 16 KB of each edition file (the licence field lives
in the metadata at the start), so it is fast and does not load any text.

Output: a JSON report with
  * books excluded by name/author (not_offered.py)
  * split originals (schemas with sofer_split_of; their parts stay)
  * editions excluded for copyright / all rights reserved
  * editions kept, with their licence class (NC, unknown, review ...)

Usage:
    python audit_licenses.py --source <sefaria-export> \
        [--out audit-licenses.json] [--list-excluded]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

SOFER_SRC = r"C:\Users\morde\Sofer\src"
if SOFER_SRC not in sys.path:
    sys.path.insert(0, SOFER_SRC)

from sofer import licenses, not_offered  # noqa: E402
from sofer.library import _book_of  # noqa: E402
from sofer.paths import long_path  # noqa: E402


def read_schemas(root: Path) -> dict:
    """title -> schema dict (only the fields the filters need)."""
    out = {}
    for f in (root / "schemas").glob("*.json"):
        try:
            s = json.loads(long_path(f).read_text(encoding="utf-8-sig"))
        except (ValueError, OSError):
            continue
        if isinstance(s, dict) and s.get("title"):
            out[s["title"]] = s
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=r"C:\Users\morde\Sofer\data\sefaria-export")
    ap.add_argument("--out", default=r"C:\Users\morde\Soferia\audit-licenses.json")
    ap.add_argument("--list-excluded", action="store_true",
                    help="print every excluded title/edition, not just counts")
    args = ap.parse_args()

    root = Path(args.source)
    json_root = root / "json"
    schemas = read_schemas(root)

    # book-level filters (Sofer's catalogue: not offered, split originals)
    blocked_books: dict[str, str] = {}
    split_originals: set[str] = set()
    for title, s in schemas.items():
        b = _book_of(s)
        if not_offered.book(b):
            blocked_books[title] = "not_offered"
        if s.get("sofer_split_of"):
            split_originals.add(title)

    editions = defaultdict(list)     # title -> [(path, version_title, lang, raw_license)]
    for p in json_root.rglob("*.json"):
        parts = p.relative_to(json_root).parts
        if len(parts) < 3:
            continue
        lang, title = parts[-2], parts[-3]
        editions[title].append((p, p.stem, lang))

    kept, dropped, reviews = [], [], []
    counts = Counter()
    by_reason = Counter()

    for title in sorted(editions):
        if title in blocked_books:
            counts["books_not_offered"] += 1
            for p, vt, lang in editions[title]:
                dropped.append({"title": title, "version": vt, "language": lang,
                                "reason": "book not offered"})
            continue
        if title in split_originals:
            counts["books_split_original"] += 1
            for p, vt, lang in editions[title]:
                dropped.append({"title": title, "version": vt, "language": lang,
                                "reason": "split original"})
            continue

        kept_here = 0
        for p, vt, lang in editions[title]:
            try:
                raw = licenses.license_of_file(long_path(p))
            except OSError as e:
                print(f"  ! cannot read {p}: {e}", flush=True)
                raw = None
            lic = licenses.classify(raw, version_title=vt)
            info = lic.to_dict()
            info.pop("may_build", None)
            if not lic.may_build:
                dropped.append({"title": title, "version": vt, "language": lang,
                                "reason": "rights reserved",
                                "license_raw": raw, "display": lic.display})
                by_reason["rights reserved"] += 1
            else:
                kept.append({"title": title, "version": vt, "language": lang,
                             "license": info})
                kept_here += 1
                if lic.commercial_use == licenses.UNKNOWN:
                    counts["unknown_license"] += 1
                elif lic.commercial_use == licenses.REQUIRES_REVIEW:
                    counts["requires_review"] += 1
                elif lic.commercial_use == licenses.PROHIBITED:
                    counts["noncommercial"] += 1
                    reviews.append({"title": title, "version": vt, "language": lang,
                                    "license": info})
        if kept_here:
            counts["books_kept"] += 1
        else:
            counts["books_with_no_allowed_edition"] += 1

    report = {
        "source": str(root),
        "summary": dict(counts),
        "editions_total": len(kept) + len(dropped),
        "editions_kept": len(kept),
        "editions_dropped": len(dropped),
        "books_total": len(editions),
        "books_not_offered": sorted(blocked_books),
        "books_split_original": sorted(split_originals),
        "editions_dropped_list": dropped,
        "editions_kept_list": kept,
        "noncommercial_editions": reviews,
    }
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=1),
                              encoding="utf-8")

    print(f"Books: {report['books_total']}  kept: {counts['books_kept']}  "
          f"not offered: {counts['books_not_offered']}  "
          f"split originals: {counts['books_split_original']}  "
          f"no allowed edition: {counts['books_with_no_allowed_edition']}")
    print(f"Editions: {report['editions_total']}  kept: {len(kept)}  "
          f"dropped: {len(dropped)}")
    print(f"Kept licences: noncommercial {counts['noncommercial']}, "
          f"unknown {counts['unknown_license']}, review {counts['requires_review']}")
    print(f"Report -> {args.out}")

    if args.list_excluded:
        print("\nBooks not offered:")
        for t in sorted(blocked_books):
            print(f"  - {t}")
        print("\nEditions dropped for rights:")
        for d in dropped:
            if d["reason"] == "rights reserved":
                print(f"  - {d['title']} / {d['version']} [{d['language']}]")


if __name__ == "__main__":
    main()
