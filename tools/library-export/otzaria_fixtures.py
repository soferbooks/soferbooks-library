"""Expected results for the Otzaria conversion fixtures, made by Sofer's own importer.

For every __tests__/fixtures/otzaria/<name>.txt this runs Sofer's importers._otzaria_tree and
importers._export_of (C:\\Users\\morde\\Sofer\\src, read only) and writes <name>.sofer.json:
{"author": ..., "sections": [{"path": [headings], "paras": [...]}]} - the book's sections in
order, each with the headings above it ("" for an unnamed part), as __tests__/extras.test.js
compares them with the phone's converter (extras/otzaria.js).

    python tools\\library-export\\otzaria_fixtures.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SOFER_SRC = Path(r"C:\Users\morde\Sofer\src")
FIXTURES = Path(__file__).resolve().parents[2] / "__tests__" / "fixtures" / "otzaria"


def sections(nodes, text, trail):
    out = []
    for n in nodes:
        key = "" if n.get("default") else n["key"]
        name = "" if n.get("default") else n["heTitle"]
        t = text.get(key)
        if n.get("nodes"):
            out += sections(n["nodes"], t or {}, trail + [name])
        else:
            out.append({"path": trail + [name], "paras": t or []})
    return out


def main() -> int:
    sys.path.insert(0, str(SOFER_SRC))
    from sofer.importers import _otzaria_tree, _export_of     # noqa: E402  (Sofer's own code)
    for txt in sorted(FIXTURES.glob("*.txt")):
        tree, author = _otzaria_tree(txt.read_text(encoding="utf-8-sig"))
        text, nodes = _export_of(tree)
        out = {"author": author, "sections": sections(nodes, text, [])}
        txt.with_suffix(".sofer.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n",
                                                  encoding="utf-8")
        print(f"{txt.name}: {len(out['sections'])} sections")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
