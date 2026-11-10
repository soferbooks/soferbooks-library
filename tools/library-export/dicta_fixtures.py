"""Expected results for the Dicta conversion fixtures, made by Sofer's own importer.

Each __tests__/fixtures/dicta/<name>.json is one Dicta book as the phone's converter reads it:
{"book": its books.json entry, "pages": Dicta's pages, "otzaria": [{"source", "name", "text"}]
Otzaria's copies of it (source as Otzaria's SourcesBooks.csv names it: "Dicta" for its
DictaToOtzaria layout)}. This script puts each in a Dicta folder and an Otzaria release zip of
its own and runs Sofer's importers.import_dicta on them (C:\\Users\\morde\\Sofer\\src, read only),
then writes <name>.sofer.json: {"kind", "versionTitle", "versionSource", "license", "author",
"sections": [{"path", "paras"}]}, which __tests__/dicta.test.js compares with extras/dicta.js.

    python tools\\library-export\\dicta_fixtures.py                          # the expected results
    python tools\\library-export\\dicta_fixtures.py --take <fileName> <name>  # a real book from Sofer's data
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import tempfile
import zipfile
from collections import Counter
from pathlib import Path

SOFER_SRC = Path(r"C:\Users\morde\Sofer\src")
SOFER_DATA = Path(r"C:\Users\morde\Sofer\data")
FIXTURES = Path(__file__).resolve().parents[2] / "__tests__" / "fixtures" / "dicta"


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


def take(file_name: str, name: str) -> None:
    """A real book: its books.json entry, Dicta's pages and Otzaria's copies, as Sofer read them."""
    from sofer.importers import norm_title     # noqa: E402
    books = json.loads((SOFER_DATA / "dicta" / "books.json").read_text(encoding="utf-8-sig"))
    book = next(b for b in books if b["fileName"] == file_name)
    with zipfile.ZipFile(SOFER_DATA / "dicta" / "files" / f"{file_name}.zip") as z:
        pages = [z.read(n).decode("utf-8-sig", errors="replace") for n in sorted(z.namelist()) if n.endswith(".txt")]
    copies = []
    with zipfile.ZipFile(SOFER_DATA / "otzaria" / "otzaria_latest.zip") as z:
        src_csv = next(n for n in z.namelist() if n.endswith("SourcesBooks.csv"))
        for fname, path, source, _ in list(csv.reader(io.StringIO(z.read(src_csv).decode("utf-8-sig"))))[1:]:
            if norm_title(fname[:-4]) == norm_title(book["displayName"].strip()):
                copies.append({"source": source, "name": fname[:-4],
                               "text": z.read(path).decode("utf-8-sig", errors="replace")})
    keep = {k: book[k] for k in ("fileName", "author", "authorEnglish", "category", "categoryEnglish", "subcategory",
                                 "subcategoryEnglish", "displayName", "displayNameEnglish", "printLocation",
                                 "printLocationEnglish", "printYear", "textFileURL") if k in book}
    (FIXTURES / f"{name}.json").write_text(json.dumps({"book": keep, "pages": pages, "otzaria": copies},
                                                      ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{name}: {len(pages)} pages, {len(copies)} Otzaria copies")


def expected(fixture: Path) -> dict:
    from sofer import importers                 # noqa: E402  (Sofer's own code)
    data = json.loads(fixture.read_text(encoding="utf-8"))
    book = data["book"]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dicta = tmp / "dicta"
        (dicta / "files").mkdir(parents=True)
        (dicta / "books.json").write_text(json.dumps([book], ensure_ascii=False), encoding="utf-8")
        with zipfile.ZipFile(dicta / "files" / f"{book['fileName']}.zip", "w") as z:
            for i, page in enumerate(data["pages"]):
                z.writestr(f"{book['fileName']}-{i + 1:03d}.txt", page.encode("utf-8"))
        otz = tmp / "otzaria.zip"
        rows = [["שם הקובץ", "נתיב הקובץ", "תיקיית המקור", "מספר שורות"]]
        with zipfile.ZipFile(otz, "w") as z:
            for i, c in enumerate(data["otzaria"]):
                path = f"אוצריא/{i}/{c['name']}.txt"
                z.writestr(path, c["text"].encode("utf-8"))
                rows.append([f"{c['name']}.txt", path, c["source"], "0"])
            buf = io.StringIO()
            csv.writer(buf).writerows(rows)
            z.writestr("SourcesBooks.csv", buf.getvalue().encode("utf-8-sig"))
        root = tmp / "export"
        written: list = []
        importers.import_dicta(dicta, root, set(), written, Counter(), otzaria_zip=otz)
        vf = next(root / f for f in written if f.replace("\\", "/").startswith("json/"))
        doc = json.loads(vf.read_text(encoding="utf-8"))
    return {"kind": doc["sofer_source"], "versionTitle": doc["versionTitle"], "versionSource": doc["versionSource"],
            "license": doc["license"], "author": doc.get("author", ""),
            "sections": sections(doc["schema"]["nodes"], doc["text"], [])}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--take", nargs=2, metavar=("FILENAME", "NAME"))
    args = ap.parse_args()
    sys.path.insert(0, str(SOFER_SRC))
    FIXTURES.mkdir(parents=True, exist_ok=True)
    if args.take:
        take(*args.take)
        return 0
    for f in sorted(FIXTURES.glob("*.json")):
        if f.name.endswith(".sofer.json"):
            continue
        out = expected(f)
        f.with_name(f.stem + ".sofer.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"{f.name}: {out['kind']}, {len(out['sections'])} sections")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
