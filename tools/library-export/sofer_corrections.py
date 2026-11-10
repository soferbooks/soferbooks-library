"""Sofer's text corrections, as patch operations on Sefaria's own mobile export.

The phone downloads Sefaria's books unchanged from Sefaria's mobile server.  Sofer's
corrections (``C:\\Users\\morde\\Sofer\\docs\\BOOK_CORRECTIONS.md``) are not edits of a
file either: Sofer applies them while an edition is read.  This module runs *Sofer's
own code* on the section files of a Sefaria mobile zip and records every text that
comes out different, as an operation the app applies when it reads that section file
(``corrections.js``):

    [path, from_hash, to_text]

* ``path``      keys/indices from the top of the section file's JSON to one string;
* ``from_hash`` the first 12 hex digits of md5(UTF-8 of the text Sefaria has there),
                or "" for a fill (a passage the edition lacks: applied only while the
                place is empty);
* ``to_text``   Sofer's text.

The hash makes the patch safe across Sefaria updates: once Sefaria changes a passage
the operation no longer matches and is skipped (the app never writes an old text over
a newer one); the next release rebuilds the operations from the new text.

What is included (the reading-time corrections Sofer applies to Sefaria's text):

* ``text_fills.apply``         passages missing from an edition, filled in (FILLS);
* ``text_fills.real_questions``  the Zohar's / Chok LeYisrael's "<word>. ?" -> "<word>?";
* ``text_fills.without_note_stars``  Hartman's note stars in his Maharal editions;
* ``text_fills.without_placeholders``  "אין פרק ג" placeholders read as empty;
* ``text_fills.inline_notes``  "[הערה: ...]" notes as Sefaria footnote markup;
* ``text_fills.without_publisher_notes``  publishers' notes / e-mail addresses read as empty;
* ``masorah.VERSE_CORRECTIONS``  Miqra according to the Masorah: the printed spelling,
  Minchas Shai readings and Vayikra 7:22 (Sofer's private shva-na / dagesh-chazak marks
  U+05C8 / U+05C9 are written as the plain shva / dagesh, as Sefaria's text has them).

What is NOT included, and why (see tools/library-export/README.md):

* splits (``splits.SPLITS``: Ben Ish Hai, the Tur and its commentaries, the Gate of Trust):
  new books with their own titles, table of contents and links - not a text patch; they
  ship in the "SoferBooks extras" pack instead.  Sefaria's whole book stays on the phone.
* Sofer's Wikitext copy of Miqra according to the Masorah: it carries Sofer's private
  marks and Wikitext's later edits, a different text, not a correction of Sefaria's.
* the Wikitext siddur fixes, ELYON_CORRECTIONS (Wikitext-only texts), printing-time
  restyling (markup.py / structure.py) and catalogue choices (preferred editions,
  aliases, licences, books not offered - the content filter's business).
"""
from __future__ import annotations

import copy
import hashlib
import json
import sys
import zipfile
from pathlib import Path

SOFER_SRC = r"C:\Users\morde\Sofer\src"

_sofer = None


def sofer():
    """Sofer's modules (imported on first use, so the search build works without Sofer)."""
    global _sofer
    if _sofer is None:
        if SOFER_SRC not in sys.path:
            sys.path.insert(0, SOFER_SRC)
        from sofer import masorah, text_fills  # noqa: E402
        _sofer = (text_fills, masorah)
    return _sofer


def text_hash(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:12]


def version_hash(version_title: str) -> str:
    return hashlib.md5(version_title.encode("utf-8")).hexdigest()[:8]


# ---------------------------------------------------------------- applying (mirrors corrections.js)

def _empty(x) -> bool:
    return x is None or (isinstance(x, str) and not x.strip())


def apply_ops(payload, ops):
    """``payload`` with the operations applied (in place); returns (payload, applied count)."""
    applied = 0
    for path, from_hash, to_text in ops:
        node = payload
        ok = True
        for key in path[:-1]:
            if isinstance(node, list) and isinstance(key, int) and 0 <= key < len(node):
                node = node[key]
            elif isinstance(node, dict) and isinstance(key, str) and key in node:
                node = node[key]
            else:
                ok = False
                break
        if not ok:
            continue
        last = path[-1]
        if isinstance(node, list) and isinstance(last, int) and last >= 0:
            current = node[last] if last < len(node) else None
        elif isinstance(node, dict) and isinstance(last, str):
            current = node.get(last)
        else:
            continue
        if from_hash == "":
            if not _empty(current):
                continue
        elif not isinstance(current, str) or text_hash(current) != from_hash:
            continue
        if isinstance(node, list):
            while len(node) <= last:
                node.append("")
        node[last] = to_text
        applied += 1
    return payload, applied


# ---------------------------------------------------------------- building

def _leaves(x, path=()):
    if isinstance(x, str):
        yield path, x
    elif isinstance(x, list):
        for i, y in enumerate(x):
            yield from _leaves(y, path + (i,))
    elif isinstance(x, dict):
        for k, y in x.items():
            yield from _leaves(y, path + (k,))


def _diff_ops(before, after):
    old = dict(_leaves(before))
    ops = []
    for path, text in _leaves(after):
        was = old.get(path)
        if was is not None and was != text:
            ops.append([list(path), text_hash(was), text])
    return ops


def _reading_fixes(title: str, version_title: str, payload):
    """Sofer's LocalExportProvider.get_version steps (after the fills), on one section."""
    text_fills, _ = sofer()
    fixed = text_fills.real_questions(title, payload)
    fixed = text_fills.without_note_stars(version_title, "", fixed)
    fixed = text_fills.without_placeholders(fixed)
    fixed = text_fills.inline_notes(fixed)
    fixed = text_fills.without_publisher_notes(fixed)
    return fixed


_PRIVATE_MARKS = str.maketrans({"\u05c8": "\u05b0", "\u05c9": "\u05bc"})


def _sections(z: zipfile.ZipFile, names):
    """{section file stem: metadata} for a book zip."""
    out = {}
    for n in names:
        if n.endswith(".metadata.json"):
            try:
                out[n[: -len(".metadata.json")]] = json.loads(z.read(n))
            except ValueError:
                continue
    return out


def book_ops(zip_path: Path, title: str) -> dict[str, list]:
    """{section file name without ".json": [op, ...]} for one Sefaria mobile book zip."""
    text_fills, masorah = sofer()
    files: dict[str, list] = {}
    with zipfile.ZipFile(zip_path) as z:
        names = set(z.namelist())
        metas = _sections(z, names)
        # 1. reading-time fixes, section file by section file
        for stem, meta in metas.items():
            # (depth 3+: a {ref, sections: {ref: {versions ...}}} wrapper, one file per version)
            versions = list(meta.get("versions") or [])
            if isinstance(meta.get("sections"), dict):
                for sub in meta["sections"].values():
                    versions += (sub or {}).get("versions") or []
            seen = set()
            for v in versions:
                vt, lang = v.get("versionTitle"), v.get("language")
                if not vt or not lang or (vt, lang) in seen:
                    continue
                seen.add((vt, lang))
                name = f"{stem}.{version_hash(vt)}.{lang}"
                if name + ".json" not in names:
                    continue
                try:
                    payload = json.loads(z.read(name + ".json"))
                except ValueError:
                    continue
                ops = _diff_ops(payload, _reading_fixes(title, vt, copy.deepcopy(payload)))
                if ops:
                    files.setdefault(name, []).extend(ops)

        # 2. fills (FILLS: book, edition, language -> {(chapter, ..., n): text})
        for (b, vt, lang), fills in text_fills.FILLS.items():
            if b != title:
                continue
            for path, value in fills.items():
                stem = f"{title} {':'.join(str(n) for n in path[:-1])}" if len(path) > 1 else title
                name = f"{stem}.{version_hash(vt)}.{lang}"
                if name + ".json" not in names:
                    continue
                payload = json.loads(z.read(name + ".json"))
                i = path[-1] - 1
                if isinstance(payload, list) and (i >= len(payload) or _empty(payload[i])):
                    files.setdefault(name, []).append([[i], "", value])

        # 3. Miqra according to the Masorah: Mordy's verse corrections
        chapters = sorted({c for b, c, _v in masorah.VERSE_CORRECTIONS if b == title})
        for c in chapters:
            name = f"{title} {c}.{version_hash(masorah.VERSION)}.he"
            if name + ".json" not in names:
                continue
            chapter = json.loads(z.read(name + ".json"))
            if not isinstance(chapter, list) or not all(isinstance(s, str) for s in chapter):
                continue
            # (the book's text with only this chapter in it: the other chapters' corrections
            #  find no verse and do nothing)
            text = [[] for _ in range(c)]
            text[c - 1] = list(chapter)
            new_chapter = masorah.corrected(title, text)[c - 1]
            ops = files.setdefault(name, [])
            for i, (old, new) in enumerate(zip(chapter, new_chapter)):
                if "\u05c8" not in old and "\u05c9" not in old:
                    new = new.translate(_PRIVATE_MARKS)
                if new != old:
                    ops[:] = [op for op in ops if op[0] != [i]]
                    ops.append([[i], text_hash(old), new])
            if not ops:
                del files[name]
    return files


def write_book_patch(path: Path, title: str, files: dict[str, list], last_updated: str | None):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {"title": title, "sefaria_last_updated": last_updated, "files": files}
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
