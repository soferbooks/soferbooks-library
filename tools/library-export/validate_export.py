"""Check an export-v7 folder for the problems that break the app.

Run after an export:
    python tools/library-export/validate_export.py --export C:\\Users\\morde\\Soferia\\export-v7

Checks per book:
  * the book zip exists and contains <Title>_index.json
  * the toc's firstSection has a matching .metadata.json in the zip
  * no duplicate file names inside the zip
  * how many sections actually have text (books with none are listed)
Also compares packages.json sizes with the real zip sizes.
"""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path


def flatten_toc(toc):
    for item in toc:
        if "title" in item:
            yield item
        if "contents" in item:
            yield from flatten_toc(item["contents"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--limit-list", type=int, default=40)
    args = ap.parse_args()
    out = Path(args.export)

    toc = json.loads((out / "toc.json").read_text(encoding="utf-8"))
    books = list(flatten_toc(toc))
    problems = {
        "missing_zip": [],
        "missing_index": [],
        "missing_first_section": [],
        "no_first_section": [],
        "duplicate_names": [],
        "empty_books": [],
    }
    empty_sections = {}
    sections = {}

    for item in books:
        title = item["title"]
        first = item.get("firstSection")
        if not first:
            problems["no_first_section"].append(title)
        path = out / f"{title}.zip"
        if not path.is_file():
            problems["missing_zip"].append(title)
            continue
        try:
            with zipfile.ZipFile(path) as z:
                names = z.namelist()
                nameset = set(names)
                if f"{title}_index.json" not in nameset:
                    problems["missing_index"].append(title)
                dups = [n for n, c in Counter(names).items() if c > 1]
                if dups:
                    problems["duplicate_names"].append(title)
                metas = [n for n in names if n.endswith(".metadata.json")]
                sections[title] = len(metas)
                # section refs actually present: depth-3 metadata files keep
                # their verses in a `sections` map instead of separate files
                available = set()
                with_text = 0
                for name in metas:
                    meta = json.loads(z.read(name))
                    subs = meta.get("sections")
                    if isinstance(subs, dict) and subs:
                        available.update(subs)
                        if any(sub.get("versions") for sub in subs.values()):
                            with_text += 1
                    else:
                        ref = meta.get("ref") or meta.get("sectionRef")
                        if ref:
                            available.add(ref)
                        if meta.get("versions"):
                            with_text += 1
                if first and first not in available:
                    problems["missing_first_section"].append(f"{title} -> {first}")
                empty_sections[title] = len(metas) - with_text
                if with_text == 0:
                    problems["empty_books"].append(title)
        except (OSError, zipfile.BadZipFile, ValueError):
            problems["missing_zip"].append(title)

    packages_path = out / "packages.json"
    size_mismatch = []
    if packages_path.is_file():
        def book_size(title):
            """What a package download costs: the book zip plus its search text."""
            n = 0
            zip_file = out / f"{title}.zip"
            if zip_file.is_file():
                n += zip_file.stat().st_size
            search_file = out / "_search" / f"{title}.txt"
            if search_file.is_file():
                n += search_file.stat().st_size
            return n

        def index_size(package_name):
            path = out / "_index" / f"{package_name}.idx"
            return path.stat().st_size if path.is_file() else 0

        packages = json.loads(packages_path.read_text(encoding="utf-8"))
        for pkg in packages:
            if not pkg.get("indexes"):
                actual = sum(book_size(i["title"]) for i in books)
            else:
                actual = sum(book_size(t) for t in pkg["indexes"])
            actual += index_size(pkg["en"])
            if pkg.get("size") != actual:
                size_mismatch.append({"package": pkg["en"],
                                      "declared": pkg.get("size"), "actual": actual})

    report = {
        "books": len(books),
        "sections": sections,
        "empty_sections": empty_sections,
        "problems": problems,
        "package_size_mismatch": size_mismatch,
    }
    (out / "_validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=1),
                                          encoding="utf-8")

    print(f"books in toc: {len(books)}")
    for key, value in problems.items():
        print(f"{key}: {len(value)}")
        for line in value[: args.limit_list]:
            print("   ", line)
    if size_mismatch:
        print("package size mismatch:", len(size_mismatch))
        for m in size_mismatch[: args.limit_list]:
            print("   ", m)
    print("report ->", out / "_validation.json")
    return 1 if any(problems.values()) or size_mismatch else 0


if __name__ == "__main__":
    sys.exit(main())
