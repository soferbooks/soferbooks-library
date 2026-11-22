"""Build the app's Siddur Edot HaMizrach (extras/sofer.js APP_BOOKS) from the website's siddur.

1. The website's own import (Sofer's word_layout.import_word_books, read only: it reads the siddur's
   pages in SoferShared/library/word_books and writes only into this tool's scratch folder) makes the
   book in Sefaria's JSON format, with SoferBooks' fixes and its shva na, kamatz katan and metegs.
2. The app's own changes (owner, 2026-11-20): the kavanah written after Hashem's name ("יְהֹוָה
   יאהדונהי") taken out - the name stays, and what follows it (a comma, a maqaf) stays where it was.
3. The page's own look kept (owner, 2026-11-22: "the small/big/bold didn't carry over"): each
   paragraph as the website's parser reads it (word_layout.sections_of: its runs' sizes and bold)
   in <small>, <big> and <b> - the import keeps only the words. The words, and so the paragraphs and
   their refs, are exactly the import's (checked here).
4. The contents as Wikisource has them (owner, 2026-11-22: "Siddur toc is all one. It should have
   main and sub categories like it has in wiki"): "sofer_contents", each part of the siddur (סדר ימי
   החול ...), its prayers, and the headings inside each prayer with the paragraph each starts at.
   The schema stays one list of sections, so every ref (a tab, history, a bookmark) stays the same;
   the phone makes the contents from this (extras/sofer.js siddurContents).
5. book.json zipped as siddur-edot-hamizrach-sofer.zip, with its md5 and size for APP_BOOKS.

    python tools/siddur/build_app_siddur.py <out dir>
    gh release create sofer-app-books-<date> --repo soferbooks/soferbooks-library-data --latest=false ...
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

SOFER = Path(r"C:/Users/morde/Sofer")
WORD_BOOKS = Path(r"C:/Users/morde/SoferShared/library/word_books")
FOLDER = "siddur-edot-hamizrach"
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


# ------------------------------------------------------------------ the page's look

def _styled_without_kavanot(chars: list) -> list:
    """[(char, size, bold)] with the kavanot taken out as without_kavanot takes them out of the words."""
    def cut(chars, pattern, put):
        text = "".join(c for c, _, _ in chars)
        out, at = [], 0
        for m in pattern.finditer(text):
            out += chars[at:m.start()]
            if put:
                out.append((put, *chars[m.start()][1:]))
            at = m.end()
        return out + chars[at:]
    return cut(cut(chars, KAVANAH, ""), GLUED, " ")


def _tag(size: float) -> tuple[str, str]:
    # (word_layout._Wiki's sizes: 0.65 the small letters inside an instruction, 0.83 an instruction,
    #  1.15 big; the reader's <small> is 0.8 of the text)
    if size < 0.75:
        return "<small><small>", "</small></small>"
    if size < 0.95:
        return "<small>", "</small>"
    if size > 1.05:
        return "<big>", "</big>"
    return "", ""


def styled_html(chars: list) -> str:
    """[(char, size, bold)] -> the paragraph in <small>/<big>/<b>"""
    out, run = [], []

    def flush():
        if not run:
            return
        text = html.escape("".join(c for c, _, _ in run), quote=False)
        _, size, bold = run[0]
        if text.strip():
            if bold:
                text = f"<b>{text}</b>"
            a, b = _tag(size)
            text = f"{a}{text}{b}"
        out.append(text)
        run.clear()
    for ch in chars:
        # (a space takes the look of the run it is in: no tag starts or ends on one)
        if run and (ch[1:] != run[0][1:]) and not (ch[0].isspace()):
            flush()
        run.append(ch if not ch[0].isspace() or not run else (ch[0], *run[0][1:]))
    flush()
    return "".join(out)


def paragraphs_of(sec) -> tuple[list[str], list[str], list[tuple[str, int]]]:
    """A section's paragraphs as the import makes them (its words), the same in HTML, and its
    headings with the paragraph (from 1) each comes before."""
    words, styled, marks = [], [], []

    def para(runs):
        chars = [(c, size, bold) for text, size, bold in runs for c in text]
        full = "".join(c for c, _, _ in chars)
        # (as Section.plain: each paragraph stripped, its lines the import's paragraphs)
        start = len(full) - len(full.lstrip())
        stripped = full.strip()
        at = start
        for line in stripped.split("\n"):
            piece = chars[at:at + len(line)]
            at += len(line) + 1
            if not line:
                continue
            words.append(without_kavanot(line)[0])
            styled.append(styled_html(_styled_without_kavanot(piece)))
    for it in sec.items:
        if it[0] == "mark":
            marks.append((" ".join(it[1].split()), len(words) + 1))
        elif it[0] == "p":
            para(it[2])
        elif it[0] == "cols":
            for p in it[2]:
                para(p[2])
    return words, styled, marks


def contents_of(sections, names: dict) -> list:
    """[{he: the part's name, secs: [{i: its place in the schema (from 0), he, subs: [[he, paragraph]]}]}]"""
    parts = []
    for i, sec in enumerate(sections):
        name = names.get(sec.group, sec.group)
        if not parts or parts[-1]["he"] != name:
            parts.append({"he": name, "secs": []})
        _, _, marks = paragraphs_of(sec)
        subs = [[t, n] for t, n in marks if t and t != sec.title]
        parts[-1]["secs"].append({"i": i, "he": sec.title, "subs": subs})
    return parts


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

    sections = word_layout.sections_of(WORD_BOOKS / FOLDER)
    nodes = book["schema"]["nodes"]
    assert len(sections) == len(nodes), (len(sections), len(nodes))
    for sec, node in zip(sections, nodes):
        words, styled, _ = paragraphs_of(sec)
        have = book["text"][node["key"]]
        assert node["heTitle"] == sec.picker_name, (node["heTitle"], sec.picker_name)
        assert words == have, f"{node['key']}: the parser's paragraphs are not the import's"
        bare = [html.unescape(re.sub(r"<[^>]+>", "", s)) for s in styled]
        assert bare == have, f"{node['key']}: the look changed the words"
        book["text"][node["key"]] = styled
    pages = json.loads((WORD_BOOKS / f"{FOLDER}-wikitext" / "pages.json").read_text(encoding="utf-8"))["pages"]
    names = {p["name"].removeprefix("סדר ").strip(): p["name"] for p in pages}
    book["sofer_contents"] = contents_of(sections, names)

    data = json.dumps(book, ensure_ascii=False).encode("utf-8")
    zip_path = out / "siddur-edot-hamizrach-sofer.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        info = zipfile.ZipInfo("book.json", date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, data)
    b = zip_path.read_bytes()
    print(json.dumps({"file": str(zip_path), "size": len(b), "md5": hashlib.md5(b).hexdigest(),
                      "kavanot_taken_out": counter["kavanot taken out"], "left": left,
                      "parts": len(book["sofer_contents"]),
                      "headings": sum(len(s["subs"]) for p in book["sofer_contents"] for s in p["secs"])}))


if __name__ == "__main__":
    main()
