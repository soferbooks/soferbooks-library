"""The Wikisource books the phone offers (extras/wikisourceBooks.json), from Sofer's own code.

Sofer (C:\\Users\\morde\\Sofer, read only) decides which Hebrew Wikisource books are whole sefarim
the library lacks: src/sofer/wikisource.py (the site's "complete" category, NOT_SEFARIM, CHOSEN,
PREFERRED, IN_LIBRARY ...) and scripts/download_wikisource.py, whose list and downloaded books are
in data/wikisource/. This writes that list for the phone: each book's page, shelf (category_of),
the names it may have in the library (importers.wiki_keys), whether it is used instead of another
source's copy (PREFERRED), and how many pages Sofer's walk found; and "others": the title pages of
all the site's complete books, which are never parts of another book (download_wikisource's skip).

Left out: books the library has from Sefaria (IN_LIBRARY), vowelled editions of another book
(NIKUD_PARTS), and two books Sofer makes into other books than the page: a page holding several
versions (VERSIONS: Megillat Antiochus - the sefer and its Targum) and a book split by masechta
(BY_MASECHTA: Chashukei Chemed on each masechta, arranged by amud). Those come from the Sofer
Library instead, exported from Sofer's own import of the same pages (build_sofer_library.py:
wikitext_not_on_phone), so the phone has them exactly as Sofer converts them.

    python tools\\library-export\\wikisource_books.py
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

SOFER = Path(r"C:\Users\morde\Sofer")
OUT = Path(__file__).resolve().parents[2] / "extras" / "wikisourceBooks.json"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.path.insert(0, str(SOFER / "src"))
    from sofer import wikisource as ws               # noqa: E402  (Sofer's own code)
    from sofer.importers import wiki_keys            # noqa: E402
    folder = SOFER / "data" / "wikisource"
    plan = json.loads((folder / "books.json").read_text(encoding="utf-8"))
    have = {}
    for f in sorted((folder / "books").glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        have[d["title"]] = d
    # (download_wikisource.plan: every complete book is fetched, skipped, or kept unchanged)
    others = sorted({b["title"] for b in plan["fetch"] + plan["skipped"]} | set(have) | set(ws.CHOSEN) | set(ws.PREFERRED))
    books, left = [], []
    for title, d in sorted(have.items()):
        why = ("in the library (Sefaria)" if ws.in_library(title) and title not in ws.PREFERRED else
               "a vowelled edition of another book" if title in ws.NIKUD_PAGES else
               "several versions on one page (in the Sofer Library)" if title in ws.VERSIONS else
               "split by masechta (in the Sofer Library)" if title in ws.BY_MASECHTA else "")
        if why:
            left.append({"page": title, "why": why})
            continue
        b = {"page": title, "category": ws.category_of(d.get("categories", []), title),
             "names": wiki_keys(title), "pages": len(d["pages"])}
        if title in ws.PREFERRED:
            b.update(preferred=True, replaces=list(ws.PREFERRED[title]))
        books.append(b)
    out = {"made": dt.date.today().isoformat(),
           "from": "Sofer src/sofer/wikisource.py and data/wikisource (tools/library-export/wikisource_books.py)",
           "books": books, "left_out": left, "others": others}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(books)} books ({sum(b['pages'] for b in books)} pages), {len(left)} left out, "
          f"{len(others)} title pages -> {OUT}")
    for x in left:
        print(f"  left out: {x['page']} - {x['why']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
