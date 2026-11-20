"""Build the app's Siddur Edot HaMizrach (extras/sofer.js APP_BOOKS) from the website's siddur.

1. The website's own import (Sofer's word_layout.import_word_books, read only: it reads the siddur's
   pages in SoferShared/library/word_books and writes only into this tool's scratch folder) makes the
   book in Sefaria's JSON format, with SoferBooks' fixes and its shva na, kamatz katan and metegs.
2. The app's own changes (owner, 2026-11-20): the kavanah written after Hashem's name ("יְהֹוָה
   יאהדונהי") taken out - the name stays, and what follows it (a comma, a maqaf) stays where it was.
3. book.json zipped as siddur-edot-hamizrach-sofer.zip, with its md5 and size for APP_BOOKS.

    python tools/siddur/build_app_siddur.py <out dir>
    gh release create sofer-app-books-<date> --repo soferbooks/soferbooks-library-data --latest=false ...
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

SOFER = Path(r"C:/Users/morde/Sofer")
WORD_BOOKS = Path(r"C:/Users/morde/SoferShared/library/word_books")
TITLE = "Siddur Edot HaMizrach (Shaliehsaboo)"
VERSION_FILE = "Shaliehsaboo edition (Wikisource).json"

# the kavanah after the Name: יאהדונהי (with its own brackets, if any), after a space
KAVANAH = re.compile(r"\s+\(?יאהדונהי\)?(?=[\s,.:;׃״)־]|$)")


# (once in the source it is written stuck to the next word: "יאהדונהיאֶת־" -> " אֶת־")
GLUED = re.compile(r"\s+יאהדונהי(?=[א-ת])")


def without_kavanot(text: str) -> tuple[str, int]:
    text, n = KAVANAH.subn("", text)
    text, m = GLUED.subn(" ", text)
    return text, n + m


def strip_all(x, counter: Counter):
    if isinstance(x, str):
        out, n = without_kavanot(x)
        counter["kavanot taken out"] += n
        return out
    if isinstance(x, list):
        return [strip_all(y, counter) for y in x]
    if isinstance(x, dict):
        return {k: strip_all(v, counter) for k, v in x.items()}
    return x


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "siddur-build")
    root = out / "root"
    root.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(SOFER / "src"))
    from sofer import word_layout      # the website's code, read only
    written: list = []
    report: Counter = Counter()
    word_layout.import_word_books(WORD_BOOKS, root, written, report)
    src = next(root.rglob(VERSION_FILE))
    book = json.loads(src.read_text(encoding="utf-8"))
    counter: Counter = Counter()
    book["text"] = strip_all(book["text"], counter)
    left = json.dumps(book["text"], ensure_ascii=False).count("יאהדונהי")
    data = json.dumps(book, ensure_ascii=False).encode("utf-8")
    zip_path = out / "siddur-edot-hamizrach-sofer.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        info = zipfile.ZipInfo("book.json", date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, data)
    b = zip_path.read_bytes()
    print(json.dumps({"file": str(zip_path), "size": len(b), "md5": hashlib.md5(b).hexdigest(),
                      "kavanot_taken_out": counter["kavanot taken out"], "left": left}))


if __name__ == "__main__":
    main()
