"""Prepare the fidelity check of the phone's Otzaria converter (compare_otzaria.js).

Takes books Sofer imported from Otzaria's release (C:\\Users\\morde\\Sofer\\data, read only):
writes each book's Otzaria text as Sofer read it (<out>\\NN.txt) and its path to Sofer's
converted edition (books.json), then compare_otzaria.js converts the text with the phone's code
and compares sections, headings, paragraphs and the author line with Sofer's.

    python tools\\library-export\\otzaria_fidelity.py <out> --random 200
    python tools\\library-export\\otzaria_fidelity.py <out> "זמרת הארץ" "תקנת עזרא"
    node -r @babel/register tools\\library-export\\compare_otzaria.js <out>
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import random
import re
import zipfile
from pathlib import Path

SOFER_DATA = Path(r"C:\Users\morde\Sofer\data")
ZIP = SOFER_DATA / "otzaria" / "otzaria_latest.zip"
EXPORT = SOFER_DATA / "sefaria-export"


def safe(name: str) -> str:
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "-", name).strip().rstrip(".")
    return re.sub(r"\s+", " ", s)[:120] or "untitled"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out", type=Path)
    ap.add_argument("names", nargs="*", help="books by their Hebrew names (default: a random sample)")
    ap.add_argument("--random", type=int, default=0)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((SOFER_DATA / "extra_import_manifest.json").read_text(encoding="utf-8"))
    sofer = {}
    for f in (f.replace("\\", "/") for f in manifest["files"]):
        if f.startswith("json/") and "/Otzaria/" in f and "/Notes/" not in f:
            sofer.setdefault(f.split("/")[-3], f)
    with zipfile.ZipFile(ZIP) as z:
        src_csv = next(n for n in z.namelist() if n.endswith("SourcesBooks.csv"))
        rows = list(csv.reader(io.StringIO(z.read(src_csv).decode("utf-8-sig"))))[1:]
        found = [(name[:-4], path, source) for name, path, source, _ in rows
                 if safe(name[:-4]) in sofer and source != "Dicta"]
        if args.names:
            found = [f for f in found if f[0] in args.names]
        elif args.random:
            random.Random(args.seed).shuffle(found)
            found = found[:args.random]
        books = []
        for i, (he, path, source) in enumerate(found):
            key = f"{i:03d}"
            (args.out / f"{key}.txt").write_bytes(z.read(path))
            books.append({"key": key, "he": he, "source": source, "path": path,
                          "sofer": str(EXPORT / sofer[safe(he)])})
    (args.out / "books.json").write_text(json.dumps(books, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(books)} books -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
