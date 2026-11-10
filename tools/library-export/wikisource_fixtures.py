"""Expected results for the Wikisource conversion fixtures, made by Sofer's own importer.

For every __tests__/fixtures/wikisource/<name>.json (a book as Sofer's download keeps it: {title,
pages: [{page, name, depth, revid, html}]}, the pages as the site renders them) this runs Sofer's
importers._wiki_tree, _export_of (the text, and the editors' notes book) and _wiki_author
(C:\\Users\\morde\\Sofer\\src, read only) and writes <name>.sofer.json: {"author", "text", "nodes",
"notes", "notesNodes"}, which __tests__/extras.test.js compares with the phone's converter
(extras/wikisourceParse.js).

    python tools\\library-export\\wikisource_fixtures.py
    python tools\\library-export\\wikisource_fixtures.py C:\\tmp\\wslive   (books from fetch_wikisource_live.js)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SOFER_SRC = Path(r"C:\Users\morde\Sofer\src")
FIXTURES = Path(__file__).resolve().parents[2] / "__tests__" / "fixtures" / "wikisource"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.path.insert(0, str(SOFER_SRC))
    from sofer.importers import _export_of, _wiki_author, _wiki_tree    # noqa: E402  (Sofer's own code)
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else FIXTURES
    for f in sorted(folder.glob("*.json")):
        if f.name.endswith(".sofer.json") or f.name == "requests.json":
            continue
        book = json.loads(f.read_text(encoding="utf-8"))
        tree = _wiki_tree(book)
        text, nodes = _export_of(tree)
        out = {"author": _wiki_author(book), "text": text, "nodes": nodes}
        if tree.has_notes():
            out["notes"], out["notesNodes"] = _export_of(tree, notes=True)
        dest = f.with_name(f.stem + ".sofer.json")
        dest.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"{f.name}: {len(nodes)} sections{', notes' if 'notes' in out else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
