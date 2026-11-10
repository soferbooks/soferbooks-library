"""Prepare the fidelity check of the phone's Dicta converter (compare_dicta.js).

Takes the Dicta books Sofer imported (C:\\Users\\morde\\Sofer\\data, read only): for each, writes
<out>\\NNN.json - what the phone's converter reads, as Sofer read it: Dicta's pages (from
data\\dicta\\files\\<fileName>.zip), Otzaria's DictaToOtzaria copy and the other collections'
copies of the same sefer (from Sofer's Otzaria release, as importers._otzaria_dicta_copies finds
them, each with Sofer's licence for its collection) - and books.json with the book's Dicta
fields and the path of Sofer's converted edition. compare_dicta.js then converts each with the
phone's code (extras/dicta.js) and compares it with Sofer's.

    python tools\\library-export\\dicta_fidelity.py <out>                 # all of them
    python tools\\library-export\\dicta_fidelity.py <out> --random 100
    node -r @babel/register tools\\library-export\\compare_dicta.js <out> --quiet
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import random
import re
import sys
import zipfile
from pathlib import Path

SOFER_SRC = Path(r"C:\Users\morde\Sofer\src")
SOFER_DATA = Path(r"C:\Users\morde\Sofer\data")
EXPORT = SOFER_DATA / "sefaria-export"
DICTA = SOFER_DATA / "dicta"
ZIP = SOFER_DATA / "otzaria" / "otzaria_latest.zip"
DICTA_FILE = re.compile(r'"dictaFile":\s*"((?:[^"\\]|\\.)*)"')


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out", type=Path)
    ap.add_argument("--random", type=int, default=0)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    sys.path.insert(0, str(SOFER_SRC))
    from sofer.importers import OTZARIA_LICENSES, norm_title     # noqa: E402  (Sofer's own code)
    args.out.mkdir(parents=True, exist_ok=True)

    # Sofer's converted Dicta books (not the nikud editions), by Dicta's file name
    manifest = json.loads((SOFER_DATA / "extra_import_manifest.json").read_text(encoding="utf-8"))
    sofer = {}
    for f in (f.replace("\\", "/") for f in manifest["files"]):
        if f.startswith("json/") and "/Dicta Library/" in f and "nikud by computer" not in f:
            with open(EXPORT / f, encoding="utf-8") as fh:
                m = DICTA_FILE.search(fh.read(8000))
            if m:
                sofer[json.loads(f'"{m.group(1)}"')] = f

    # Otzaria's copies, as importers._otzaria_dicta_copies (restricted ones are left out by the phone)
    copies: dict[str, list] = {}
    with zipfile.ZipFile(ZIP) as z:
        src_csv = next(n for n in z.namelist() if n.endswith("SourcesBooks.csv"))
        for name, path, source, _ in list(csv.reader(io.StringIO(z.read(src_csv).decode("utf-8-sig"))))[1:]:
            if OTZARIA_LICENSES.get(source, "unknown") is None and source != "Dicta":
                continue
            he = name[:-4] if name.endswith(".txt") else name
            copies.setdefault(norm_title(he), []).append((source, path))

        books = json.loads((DICTA / "books.json").read_text(encoding="utf-8-sig"))
        todo = [b for b in books if b.get("fileName") in sofer]
        if args.random:
            random.Random(args.seed).shuffle(todo)
            todo = todo[:args.random]
        out = []
        for i, b in enumerate(todo):
            key = f"{i:04d}"
            with zipfile.ZipFile(DICTA / "files" / f"{b['fileName']}.zip") as dz:
                names = sorted(n for n in dz.namelist() if n.endswith(".txt"))
                pages = [dz.read(n).decode("utf-8-sig", errors="replace") for n in names]
            he = (b.get("displayName") or "").strip()
            found = copies.get(norm_title(he), [])
            read = lambda p: z.read(p).decode("utf-8-sig", errors="replace")   # noqa: E731
            otz = next((read(p) for s, p in found if s == "Dicta"), None)
            others = [{"collection": s, "license": OTZARIA_LICENSES.get(s, "unknown"), "text": read(p)}
                      for s, p in found if s != "Dicta"]
            (args.out / f"{key}.json").write_text(json.dumps({"pages": pages, "otzaria": otz, "copies": others},
                                                             ensure_ascii=False), encoding="utf-8")
            out.append({"key": key, "he": he, "fileName": b["fileName"],
                        "printLocation": b.get("printLocationEnglish") or "", "printYear": b.get("printYear") or "",
                        "author": b.get("author", ""), "sofer": str(EXPORT / sofer[b["fileName"]])})
    (args.out / "books.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(out)} books -> {args.out} (Sofer has {len(sofer)} Dicta books)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
