"""Which of Dicta's books are Sefaria's already: extras/dictaRules.json for the app.

Sofer's importers.import_dicta leaves out a Dicta book whose name is one of Sefaria's books' Hebrew
names, or other Hebrew names ("dicta: already in the library") - Dicta's "אבן עזרא הקצר על שמות"
is Sefaria's "Ibn Ezra HaKatzar on Exodus" (its other name), which Sefaria links to Exodus verse by
verse. The phone's toc has each book's main Hebrew name only (extras/catalog.js), so it offered
Dicta's copy too: a second, unconnected copy. This writes the Dicta names Sofer leaves out, for the
app to bundle (extras/dicta.js parseCatalog), as otzaria_rules.py does for Otzaria's.

    python tools\\library-export\\dicta_rules.py [--books <Dicta's books.json> ...]

Without --books: Sofer's copy of Dicta's books.json (C:\\Users\\morde\\Sofer\\data\\dicta).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOFER_SRC = Path(r"C:\Users\morde\Sofer\src")
OUT = HERE.parents[1] / "extras" / "dictaRules.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--books", type=Path, nargs="*", default=[SOFER_SRC.parent / "data" / "dicta" / "books.json"])
    ap.add_argument("--sofer-data", type=Path, default=SOFER_SRC.parent / "data")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    sys.path.insert(0, str(SOFER_SRC))
    sys.path.insert(0, str(HERE))
    from sofer.importers import norm_title          # noqa: E402  (Sofer's own rule, reused)
    from otzaria_rules import sefaria_hebrew_names  # noqa: E402
    names = sefaria_hebrew_names(args.sofer_data)
    found = set()
    for f in args.books:
        for b in json.loads(f.read_text(encoding="utf-8-sig")):
            he = (b.get("displayName") or "").strip()
            if he and norm_title(he) in names:
                found.add(he)
    args.out.write_text(json.dumps({"in_sefaria": sorted(found)}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(found)} of Dicta's books are Sefaria's already -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
