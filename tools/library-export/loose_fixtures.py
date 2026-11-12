"""Sofer's loose placement of Dicta's commentaries on the Gemara, with its inputs, for checking the
phone's port (extras/inferred.js looseComments) against it: compare_loose.js runs the port on the
same Gemara, comments, Rashi's and Tosafos' dibburim and perakim, and compares place for place.

Runs Sofer's own code (C:\\Users\\morde\\Sofer\\src, read only) as its tests do
(tests/test_loose_placement.py ``_placed``: mg_books.choose_edition, mg_books._loose_place), with
Sofer's LoosePlacer watched to record what it was given and what it gave.

    C:\\Users\\morde\\Sofer\\.venv\\Scripts\\python.exe tools\\library-export\\loose_fixtures.py <out dir>
    node -r @babel/register tools\\library-export\\compare_loose.js <out dir>

Writes <out dir>/<commentary>.json: {book, commentary, units: {keys, htmls, amuds, lines, chapters},
dibburim: {amud: [[who, words, text, line]]}, raw: {rashi, tosafot: [[amud, lines]]}, perakim,
comments: [[heads, chapter, html]], result: [[key, how]] | null}.
"""
from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path

SOFER_SRC = r"C:\Users\morde\Sofer\src"
LIB = Path(r"C:\Users\morde\Sofer\data\sefaria-export")
sys.path.insert(0, SOFER_SRC)

from sofer import dibburim as dib_mod, loose_placement as lp, mg_books  # noqa: E402
from sofer.library import Library  # noqa: E402
from sofer.text_providers import LocalExportProvider  # noqa: E402

# (the text, the commentary): Sofer's tests' books (tests/test_loose_placement.py BOOKS, ESSAYS)
BOOKS = [
    ("Berakhot", "Rishon Letzion (Berakhot)"),
    ("Gittin", "Tiferet Ya’akov (Gittin)"),
    ("Menachot", "Levush Mordechai Menachot"),
    ("Bava Batra", "Chiddushei R. Yosef Migash on Bava Batra"),
    ("Yevamot", "Levush Mordechai Yevamot"),
    ("Zevachim", "Levush Mordechai Zvachim"),
    ("Bava Kamma", "חידושי רבי שמעון על בבא קמא"),
    ("Kiddushin", "חידושי רבי שמעון על קידושין"),
    ("Kiddushin", "Atzmot Yosef (Kiddushin)"),
    ("Yevamot", "Yam Shel Shlomo (Yevamot)"),
]


def raw_commentary(masechta: str) -> dict:
    """Rashi's and Tosafos' text on the masechta, as dibburim.load reads it: {who: [[amud, lines]]}."""
    out = {}
    for who in ("rashi", "tosafot"):
        f = dib_mod._text_file(LIB, who, masechta)
        text = json.loads(f.read_text(encoding="utf-8")).get("text") if f else None
        out[who] = [[ai, a] for ai, a in enumerate(text if isinstance(text, list) else []) if a]
    return out


def main() -> int:
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[2:])
    p = LocalExportProvider(LIB)
    lib = Library(p, cache=Path(tempfile.gettempdir()) / "loose_fixtures_library.json")   # (never Sofer's own cache)
    got: dict = {}
    init, place = lp.LoosePlacer.__init__, lp.LoosePlacer.place

    def watched_init(self, keys, htmls, amuds=None, chapters=None, lines=None, dibburim=None, perakim=None):
        got.update(keys=keys, htmls=htmls, amuds=amuds, chapters=chapters, lines=lines, dibburim=dibburim,
                   perakim=perakim)
        init(self, keys, htmls, amuds, chapters, lines, dibburim, perakim)

    def watched_place(self, comments):
        got["comments"] = comments
        return place(self, comments)

    lp.LoosePlacer.__init__, lp.LoosePlacer.place = watched_init, watched_place
    for book, commentary in BOOKS:
        if only and commentary not in only:
            continue
        got.clear()
        info, b = lib.get(book), lib.get(commentary)
        if info is None or b is None:
            print(f"{commentary}: not in the library", flush=True)
            continue
        base = mg_books.choose_edition(p, info.folder("Hebrew"), (), None)[0]
        ver = mg_books.choose_edition(p, b.folder("Hebrew"), (), None)[0]
        in_order = [(path, path, html) for path, html in mg_books.leaves(ver.text)]
        result = mg_books._loose_place(p, ver, in_order, base, (), info.categories[:2] == ("Talmud", "Bavli"), {})
        doc = {
            "book": book, "heBook": info.he_title, "commentary": commentary, "edition": ver.version_title,
            "baseEdition": base.version_title,
            "units": {k: [list(x) if isinstance(x, tuple) else x for x in got[k]] if got.get(k) is not None else None
                      for k in ("keys", "htmls", "amuds", "chapters", "lines")},
            "dibburim": {str(a): [[d.who, d.words, d.text, d.line] for d in v] for a, v in (got["dibburim"] or {}).items()},
            "raw": raw_commentary(book),
            "perakim": [list(x) for x in got["perakim"] or []],
            "comments": [[list(h), c, html] for h, c, html in got["comments"]],
            "result": [[list(k) if k is not None else None, how] for k, how in result] if result is not None else None,
        }
        name = re.sub(r"[^\w\u0590-\u05ff]+", "_", commentary).strip("_")
        (out_dir / f"{name}.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        found = sum(how in ("loose", "dibbur") for _, how in result or [])
        print(f"{commentary} on {book}: {len(doc['comments'])} comments, "
              f"{'none placed' if result is None else f'{found} by quote / dibbur'}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
