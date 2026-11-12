"""Soferia offline library exporter.

Converts a Sefaria-export style library (as Sofer keeps it in
``C:\\Users\\morde\\Sofer\\data\\sefaria-export``) into the "schema version 7"
mobile bundle format that the Sefaria-Mobile reader (Soferia) consumes:

    <out>/<Title>.zip                       per-book bundle
        <Title>_index.json
        <sectionRef>.metadata.json          depth 1-2 books
        <sectionRef>.<vhash8>.<lang>.json
        (depth >= 3 books use a {ref, sections:{...}} wrapper instead)

    <out>/packages.json, toc.json, last_updated.json, search_toc.json,
         topic_toc.json, people.json, calendar.json, hebrew_categories.json
    <out>/bundles/<Package>/<N>.zip         split archives per package
    <out>/.md5 files                        per the app's download protocol

The text reading goes through Sofer's own LocalExportProvider, so all of
Sofer's reading-time corrections (text_fills etc.) are applied exactly as in
his own readers.

Usage:
    python export_v7.py --out <out_dir>            # full export
    python export_v7.py --books "Genesis,Berakhot,Siddur Ashkenaz"
    python export_v7.py --books-file failed.txt --patch   # re-export a few books
    python export_v7.py --core-only                # rebuild toc/packages from zips
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import re
import shutil
import string
import sys
import time
import traceback
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

SOFER_SRC = r"C:\Users\morde\Sofer\src"
if SOFER_SRC not in sys.path:
    sys.path.insert(0, SOFER_SRC)

from sofer.text_providers.local_export import LocalExportProvider, version_from_json  # noqa: E402
from sofer.hebrew import gematria  # noqa: E402
from sofer import licenses, not_offered  # noqa: E402
from sofer.library import _book_of  # noqa: E402
from sofer.paths import long_path  # noqa: E402

SCHEMA_VERSION = "7"

# Editions Sefaria/Sofer build out of other editions: their licence is the parts'.
_DERIVED_EDITIONS = ("merged", "Combined editions")
_LICENCE_RANK = {licenses.UNKNOWN: 3, licenses.REQUIRES_REVIEW: 2,
                 licenses.PROHIBITED: 1, licenses.ALLOWED: 0}

# ---------------------------------------------------------------- gematria / addresses

_DAF_EN = {0: "a", 1: "b"}
# a Talmud-addressed text's first amud in the array: 2a (Sefaria's refs and its official export start
# there - "Berakhot 2a", prev null; 1a and 1b do not exist)
TALMUD_FIRST = 2


def format_address(address_type: str, n: int, lang: str) -> str:
    """Format one address number the way Sefaria refs do.

    `n` is the address value in Sefaria's own numbering: for normal 1-based
    types (Perek, Pasuk, Integerâ€¦) the ref number is n; for Talmud n is the
    amud's index in the text array, as Sefaria's arrays have it: 0 = 1a, 1 = 1b,
    2 = "2a" (the official export's "Berakhot 2a" is the array's third entry; the
    first two are always empty: TALMUD_FIRST).
    """
    if address_type == "Talmud":
        page, amud = (n >> 1) + 1, n & 1
        if lang == "en":
            return f"{page}{_DAF_EN[amud]}"
        # (the amud's own letter keeps no geresh: "ברכות י׳ א" - Sefaria's heRefs)
        return f"{_he_num(page)} {'א' if not amud else 'ב'}"
    if lang == "en":
        return str(n)
    return _he_num(n)


_HE_ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"]
_HE_TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"]
_HE_HUNDREDS = ["", "ק", "ר", "ש", "ת"]


def _he_num(n: int) -> str:
    """A Hebrew number exactly as Sefaria's refs write it: a geresh after a single letter
    ("י׳"), gershayim before the last of several ("נ״ו", "ט״ו", "תקט״ו").  Sefaria's spelling,
    not Sofer's: it rearranges only רע (270-279: "ע״ר", "ער״ד"), while Sofer's gematria also
    rearranges 298, 304, 344 ... (Sefaria: "רצ״ח", "ש״ד", "שמ״ד" - its mobile export's heRefs).
    From 1000 on, Sofer's gematria (Sefaria's refs never go that far in these books)."""
    if n > 999 or n < 1:
        return gematria(n)
    hundreds, rest = divmod(n, 100)
    g = "ת" * (hundreds // 4) + _HE_HUNDREDS[hundreds % 4]
    if rest in (15, 16):
        g += "ט" + _HE_ONES[rest - 9]
    else:
        g += _HE_TENS[rest // 10] + _HE_ONES[rest % 10]
    g = g.replace("רע", "ער")
    return g + "׳" if len(g) == 1 else g[:-1] + "״" + g[-1]


# ---------------------------------------------------------------- schema machinery

def iter_leaves(node, path=()):
    """Yield (node, path) for every text-bearing leaf node in a schema.

    path is a tuple of parent nodes (root first, end at the leaf's parent).
    """
    ntype = node.get("nodeType")
    if ntype == "JaggedArrayNode":
        yield node, path
        return
    if ntype == "SpacedStringNode" or node.get("isVirtual") or ntype == "ArrayMapNode" and node.get("isVirtual"):
        return
    for child in node.get("nodes") or []:
        yield from iter_leaves(child, path + (node,))
    # ArrayMapNodes keep refs to other indices
    for jile in node.get("jaggedArrayNodes") or []:
        yield from iter_leaves(jile, path + (node,))


def node_primary_title(node, lang="en"):
    """Primary title of a node in `lang`, or None."""
    if lang == "he":
        t = node.get("heTitle")
        if t:
            return t
    for title in node.get("titles") or []:
        if title.get("lang") == lang and title.get("primary"):
            return title.get("text")
    # fall back: first title in lang, or sharedTitle
    for title in node.get("titles") or []:
        if title.get("lang") == lang:
            return title.get("text")
    if lang == "en" and node.get("key"):
        return str(node.get("key"))
    return None


def node_ref_part(node, lang, siblings=None):
    """The ref part a node contributes ("Bereshit", "Maggid", or an ordinal)."""
    part = node_primary_title(node, lang)
    if part:
        return part
    # no title: a number
    if siblings is not None:
        try:
            ordinal = list(siblings).index(node) + 1
        except ValueError:
            ordinal = 1
    else:
        ordinal = 1
    return gematria(ordinal)


def leaf_address_types(leaf):
    return leaf.get("addressTypes") or []


def leaf_depth(leaf):
    d = leaf.get("depth")
    if d is not None:
        return d
    # can also be a list in older nodes
    if isinstance(leaf.get("depth"), list):
        return len(leaf["depth"])
    return len(leaf_address_types(leaf))


def leaf_lengths(leaf):
    return leaf.get("lengths") or []


def complete_lengths(leaf, texts, depth):
    """Fill in (and return) a leaf's section lengths: the largest count each level
    reaches in any edition.  Sefaria's split schemas and some imported ones carry
    a depth but no lengths, and some imported schemas carry stale placeholder
    counts (e.g. one halakhah per chapter) that hide the real text, so the text
    always gets a say."""
    lengths = list(leaf_lengths(leaf))
    derived = [0] * depth
    queue = [(t, 0) for t in texts]
    while queue:
        node, level = queue.pop()
        if level >= depth or not isinstance(node, list):
            continue
        if len(node) > derived[level]:
            derived[level] = len(node)
        if level + 1 < depth:
            queue.extend((child, level + 1) for child in node)
    for i in range(len(lengths), depth):
        lengths.append(derived[i])
    for i in range(depth):
        lengths[i] = max(lengths[i], derived[i])
    leaf["lengths"] = lengths
    return lengths


def leaf_section_names(leaf, lang):
    if lang == "he":
        return leaf.get("heSectionNames") or leaf.get("sectionNames") or []
    return leaf.get("sectionNames") or []


def text_at(text, indices):
    """text (nested arrays) indexed by 0-based indices; None when absent."""
    for i in indices:
        if not isinstance(text, list) or i >= len(text):
            return None
        text = text[i]
    return text


def node_text_keys(node):
    """Possible keys of a schema node in a dict-shaped version text.

    Composite books (Siddur, Mishneh Torah parts, ...) store their text as nested
    dictionaries keyed by section name, and the keys stay in the canonical
    English title even in Hebrew editions.
    """
    keys = []
    for key in (node.get("title"), node.get("key"), node_primary_title(node, "en"),
                node.get("sharedTitle"), node.get("heTitle"),
                node_primary_title(node, "he")):
        if key and key not in keys:
            keys.append(key)
    return keys


def text_for_leaf(text, leaf, path):
    """The part of a version text that belongs to one schema leaf.

    Array-shaped books are ready to use (their leaf text is the whole array).
    Dict-shaped books are walked by section name, skipping the root envelope.
    """
    if not isinstance(text, dict):
        return text
    for node in path[1:] + (leaf,):
        if not isinstance(text, dict):
            return text
        for key in node_text_keys(node):
            if key in text:
                text = text[key]
                break
        else:
            # a schema node with no name ("default": true) stores its section
            # under the empty key in Sefaria's export
            if "" in text:
                text = text[""]
            else:
                return None
    return text


def is_empty_text(t):
    if t is None:
        return True
    if isinstance(t, str):
        return not t.strip()
    if isinstance(t, dict):
        return all(is_empty_text(x) for x in t.values())
    if isinstance(t, list):
        return all(is_empty_text(x) for x in t)
    return not str(t).strip()


# ---------------------------------------------------------------- book data structure

class Book:
    def __init__(self, title):
        self.title = title
        self.versions = []          # list[TextVersion], sorted by priority desc
        self.schema = None
        self.index_extra = {}       # metadata fields for the _index.json


def discover_books(root: Path, wanted: set[str] | None = None,
                   excluded: dict[str, str] | None = None):
    """Walk the json folder and group version files per book title â€” by path only,
    so no file contents are read. Layout: json/<catsâ€¦>/<Title>/<Language>/<Version>.json
    """
    books: dict[str, Book] = {}
    json_root = root / "json"
    for version_path in json_root.rglob("*.json"):
        parts = version_path.relative_to(json_root).parts
        if len(parts) < 3:
            continue
        _lang, title = parts[-2], parts[-3]
        if not version_path.stem:
            continue      # (a stray ".json" file in the source library)
        if wanted is not None and title not in wanted:
            continue
        if excluded and title in excluded:
            continue
        book = books.setdefault(title, Book(title))
        book.versions_paths = getattr(book, "versions_paths", [])
        book.versions_paths.append(version_path)
    return books


def blocked_titles(root: Path) -> dict[str, str]:
    """Titles Soferia must not carry: Sofer's never-offered list and split originals."""
    blocked = {}
    for f in (root / "schemas").glob("*.json"):
        try:
            s = json.loads(long_path(f).read_text(encoding="utf-8-sig"))
        except (ValueError, OSError):
            continue
        if not isinstance(s, dict) or not s.get("title"):
            continue
        title = s["title"]
        if s.get("sofer_split_of"):
            # (this schema is a part; the book it was split from is the one left out, as in
            #  Sofer's own library.py - before, the parts were left out by mistake)
            blocked.setdefault(s["sofer_split_of"], "split original (offered in parts)")
        if not_offered.book(_book_of(s)):
            blocked[title] = "not offered (sofer.not_offered)"
    return blocked


def read_book_licences(book: Book):
    """Raw licence field of every edition file, read from the file's start only."""
    raw = {}
    for p in getattr(book, "versions_paths", []):
        try:
            raw[p] = licenses.license_of_file(long_path(p))
        except OSError as e:  # noqa: BLE001
            print(f"  ! cannot read licence of {p}: {e}", flush=True)
            raw[p] = None
    return raw


def load_book_versions(provider: LocalExportProvider, book: Book, raw_licences=None,
                       drop_unknown: bool = False):
    """Read only the redistributable editions through Sofer's provider (corrections
    applied) and sort them by Sefaria's version priority.

    Sofer's licence rules decide what may be redistributed (``sofer.licenses``):
    editions marked Copyright / All rights reserved are left out, and so are the
    translations Sofer never offers (``sofer.not_offered``).  "merged" and
    "Combined editions" are built out of the other editions, so they inherit the
    strictest licence of their parts, and are dropped when any part is restricted.
    """
    raw = raw_licences if raw_licences is not None else read_book_licences(book)
    dropped, inherited = [], []
    blocked_langs = set()
    for p, r in raw.items():
        if p.stem in _DERIVED_EDITIONS:
            continue
        if not licenses.classify(r, version_title=p.stem).may_build:
            blocked_langs.add(p.parent.name)

    versions = []
    for p in sorted(getattr(book, "versions_paths", [])):
        vt, lang = p.stem, p.parent.name
        lic = licenses.classify(raw.get(p), version_title=vt)
        if vt in _DERIVED_EDITIONS:
            if lang in blocked_langs:
                dropped.append({"version": vt, "language": lang,
                                "reason": "derived from a restricted edition"})
                continue
            if lic.commercial_use in (licenses.UNKNOWN, licenses.REQUIRES_REVIEW):
                siblings = [licenses.classify(raw[q], version_title=q.stem)
                            for q in raw
                            if q.parent.name == lang and q.stem not in _DERIVED_EDITIONS]
                siblings = [s for s in siblings if s.may_build]
                if siblings:
                    lic = max(siblings, key=lambda s: _LICENCE_RANK[s.commercial_use])
                    inherited.append({"version": vt, "language": lang,
                                      "from": lic.version_title,
                                      "license": lic.license_raw})
        if not lic.may_build:
            dropped.append({"version": vt, "language": lang,
                            "reason": "rights reserved",
                            "license": lic.license_raw,
                            "display": lic.display})
            continue
        rel = p.relative_to(Path(provider.root) / "json")
        export_path = str(rel.with_suffix("")).replace("\\", "/")
        try:
            v = provider.get_version(export_path)
        except Exception as e:  # noqa: BLE001
            print(f"  ! failed to load {export_path}: {e}", flush=True)
            continue
        if lic.version_title in licenses.LICENSE_CORRECTIONS:
            # (Sefaria's licence field is wrong for these editions; print the corrected one)
            v = dataclasses.replace(v, license=lic.display)
        elif lic.license_raw != (v.license or None):
            raw_value = lic.license_raw or ("Unknown" if lic.commercial_use == licenses.UNKNOWN
                                            else lic.display)
            v = dataclasses.replace(v, license=raw_value)
        versions.append(v)
    book.versions = versions
    book.licence_dropped = dropped
    book.licence_inherited = inherited
    return dropped


def get_schema(provider: LocalExportProvider, book: Book) -> dict:
    """Sofer's tidied schema, via the same code his readers use."""
    return provider.get_schema(book.title)


def sorted_versions(book: Book):
    """Version order: Sofer's merged (corrected) editions first, then Sefaria priority."""
    def key(v):
        merged = 0 if v.version_title == "merged" else 1
        priority = v.extra.get("priority") or 0
        return (merged, -priority, v.language != "he", v.version_title or "")
    return sorted(book.versions, key=key)


# ---------------------------------------------------------------- links

def build_links_index(root: Path, wanted: set[str] | None = None):
    """Map top book title -> list of (ref1, ref2, type) rows from links CSVs."""
    csv = None
    import csv as _csv
    _csv.field_size_limit(min(sys.maxsize, 2 ** 31 - 1))
    index = defaultdict(list)
    links_dir = root / "links"
    if not links_dir.is_dir():
        return index
    files = sorted(links_dir.glob("links*.csv"))
    for f in files:
        with open(f, encoding="utf-8", newline="") as fh:
            reader = _csv.reader(fh)
            next(reader, None)
            for row in reader:
                if len(row) < 3:
                    continue
                r1, r2 = row[0], row[1]
                b1, b2 = book_of_ref(r1), book_of_ref(r2)
                if wanted is not None and b1 not in wanted and b2 not in wanted:
                    continue
                index[b1].append((r1, r2, row[2]))
                index[b2].append((r2, r1, row[2]))
    return index


def book_of_ref(ref: str) -> str:
    """Top-level book of an English ref (title up to first ','-or-space-number)."""
    # cut at first space-number or colon or comma
    m = re.match(r"^(.*?)(?:,|(?=\s)|:\d|:\s)", ref)
    # split off trailing " 1:2"
    t = re.sub(r"\s+\d.*$", "", m.group(1) if m else ref)
    return t.strip()


_REF_SPLIT = re.compile(r"\s+(?=\d)|(?::\d)|(?=:)")


def ref_segments(ref: str):
    """Rough parse of an English ref into (title, [address strings])."""
    ref = ref.strip()
    m = re.search(r"[\d:]", ref)
    if not m:
        return ref, []
    title = ref[: m.start()].strip().rstrip(",")
    addr = ref[m.start():].strip()
    parts = []
    for chunk in re.split(r"(?<=.)[:\s]", addr):
        if chunk:
            parts.append(chunk.strip())
    return title, parts


# ---------------------------------------------------------------- export primitives

def md5_hash8(s: str) -> str:
    import hashlib
    return hashlib.md5(s.encode()).hexdigest()[:8]


def write_json(out_dir: Path, name: str, doc):
    p = out_dir / name
    with open(p, "w", encoding="utf-8", newline="") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))


def simple_link(source_other_ref: str, he_other_ref: str, category_name: str | None,
                source_has_en: bool) -> dict:
    link = {"sourceHeRef": he_other_ref or "", "sourceRef": source_other_ref}
    if category_name in ("Quoting Commentary", "Targum"):
        link["category"] = category_name
    if source_has_en:
        link["sourceHasEn"] = True
    return link


# ---------------------------------------------------------------- exporting a book

class BookReference:
    """Walks a book's schema, producing refs in Sefaria format."""

    def __init__(self, book: Book, schema: dict, he_title: str | None):
        self.book = book
        self.schema = schema
        self.title = book.title
        self.he_title = he_title or book.versions[0].he_title if book.versions else ""
        root = schema.get("schema") or schema
        self.leaves = list(iter_leaves(root))

    # -- composite book names ----------------------------------------
    def leaf_title_parts(self, leaf, path, lang):
        parts = []
        for node in path[1:] + (leaf,):      # skip the root envelope
            if node.get("default"):
                # (a default node adds nothing to the ref, as in Sefaria's: "Tur, Orach Chayim 1",
                #  not "Tur, Orach Chayim, default 1" - nor a Hebrew "א" for its missing name)
                continue
            part = node_ref_part(node, lang, None)
            if part:
                parts.append(part)
        if len(self.leaves) == 1 and not path[1:]:
            # whole book is a single node named like the book: plain title
            return []
        return parts

    def leaf_refs(self, leaf, path):
        """Return (en_prefix, he_prefix) composite ref prefixes for a leaf."""
        en = self.leaf_title_parts(leaf, path, "en")
        he = self.leaf_title_parts(leaf, path, "he")
        return en, he

    def enumerate_top_units(self, leaf, lengths):
        depth = leaf_depth(leaf)
        if depth == 1:
            return [None]  # single top unit: whole leaf
        n = (lengths[0] if lengths else 0) or 0
        # (a Talmud text from 2a: the array's third entry - unit 3, 1-based)
        first = TALMUD_FIRST + 1 if (leaf_address_types(leaf) or [""])[0] == "Talmud" else 1
        return list(range(first, n + 1))


def export_book(book: Book, provider: LocalExportProvider, links_index, out_dir: Path,
                temp_dir: Path) -> tuple[bool, int | None]:
    """Export one book; returns (success, unreadable versions skipped)."""
    try:
        schema = get_schema(provider, book)
    except Exception as e:  # noqa: BLE001
        print(f"  ! no schema for {book.title}: {e}", flush=True)
        return False, None

    root = schema.get("schema") or schema
    versions = sorted_versions(book)
    if not versions:
        return False, None

    he_title = schema.get("heTitle") or None
    refmod = BookReference(book, schema, he_title)
    categories = None

    index_doc = {k: v for k, v in schema.items()}
    # the index file officially excludes these book-level version fields (they live
    # on the per-version objects instead); Sofer's schema files don't carry them.
    index_doc.pop("versions", None)
    content_counts = compute_content_counts(refmod, versions, root)
    if leaf_count(refmod) == 1 and content_counts is not None:
        schema_leaf = root if root.get("nodeType") == "JaggedArrayNode" else None
        index_doc.setdefault("schema", root)
        if schema_leaf is not None:
            schema_leaf = {**schema_leaf, "content_counts": content_counts}
            index_doc["schema"] = schema_leaf
    versions_doc = versions_index(versions, book)
    index_doc["versions"] = versions_doc
    index_doc.setdefault("title", book.title)

    files: list[tuple[str, object]] = []  # (name-in-zip, json string; a section's metadata as a dict)

    def add_file(name: str, doc):
        # (a section's metadata is written out at the end, when link_sections has filled its prev/
        #  next; every other file as it is now - the index before the leaves' lengths are completed)
        files.append((name, doc if name.endswith(".metadata.json")
                      else json.dumps(doc, ensure_ascii=False, separators=(",", ":"))))

    add_file(f"{book.title}_index.json", index_doc)

    # --- per top section --------------------------------------------------
    top_links: list[tuple[str, list]] = []  # rows for this book's own title
    ok = True
    for leaf, path in refmod.leaves:
        en_prefix, he_prefix = refmod.leaf_refs(leaf, path)
        address_types = leaf_address_types(leaf)
        section_names = leaf_section_names(leaf, "en")
        he_section_names = leaf_section_names(leaf, "he")
        depth = leaf_depth(leaf)
        texts = {}
        for v in versions:
            if v.text is None:
                continue
            leaf_text = text_for_leaf(v.text, leaf, path)
            if leaf_text is None:
                continue
            texts[v_id(v)] = dataclasses.replace(v, text=leaf_text)
        lengths = complete_lengths(leaf, [t.text for t in texts.values()], depth)
        # export all texts present (official: include all versions)
        top_count = None
        if depth >= 2:
            top_count = lengths[0]
        elif depth == 1:
            top_count = max(len(v.text) for v in texts.values()) if texts else 0
            if len(refmod.leaves) == 1 and len(texts) > 0:
                # depth-1: the whole book is one section
                pass
        # iterate top units
        units = refmod.enumerate_top_units(leaf, lengths) if depth >= 2 else [None]
        for unit in units:
            unit_idx = None if unit is None else unit - 1
            # en ref: e.g. "Genesis 1"; Talmud: "Berakhot 10a"
            en_parts, he_parts = compose_top_ref(en_prefix, he_prefix, address_types,
                                                 unit, depth, len(refmod.leaves))
            en_ref = join_ref(book.title, en_parts, depth >= 2)
            he_ref = join_ref(he_title or "", he_parts, depth >= 2)
            export_top_section(
                refmod, leaf, path, depth, address_types, section_names,
                he_section_names, en_ref, he_ref, texts, unit_idx, links_index,
                files, add_file)
    link_sections(files)
    # write everything into the zip
    zip_path = out_dir / f"{book.title}.zip"
    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            # A few schemas repeat a leaf title in the same section (e.g. Siddur
            # Ashkenaz has three "Mourner's Kaddish" nodes under Musaf LeShabbat).
            # Official exports write such a file once; keep the last version.
            unique = {}
            for name, doc in files:
                unique[name] = doc if isinstance(doc, str) else json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
            for name, data in unique.items():
                z.writestr(name, data)
    except OSError as e:
        print(f"  ! zip failed {book.title}: {e}", flush=True)
        zip_path.unlink(missing_ok=True)
        return False, None
    size = zip_path.stat().st_size
    return True, size


def link_sections(files):
    """Every section's prev/next across the whole book, as Sefaria's export has them: the nearest
    section before / after it, in the schema's order, that has text - from one node to the next
    ("Ramban on Genesis, Foreword" -> "Ramban on Genesis 1:1") and from one file's sections to the
    next file's ("Rashi on Genesis 26:35" -> "27:1"), skipping sections with no text (Sefaria's
    "48:22" -> "49:1").  A section with no text of its own (metadata only) names its neighbours too,
    so reading goes on from it.  The ends of the book: null."""
    order = []
    for name, doc in files:
        if name.endswith(".metadata.json"):
            order.extend(doc["sections"].values() if "sections" in doc else [doc])
    texted = [i for i, s in enumerate(order) if s.get("versions")]
    k = 0                                  # (texted[k]: the first texted section at or after i)
    for i, s in enumerate(order):
        while k < len(texted) and texted[k] < i:
            k += 1
        before = texted[k - 1] if k > 0 else None
        after_k = k + 1 if k < len(texted) and texted[k] == i else k
        after = texted[after_k] if after_k < len(texted) else None
        s["prev"] = order[before]["ref"] if before is not None else None
        s["next"] = order[after]["ref"] if after is not None else None


def v_id(v):
    return (v.version_title, v.language)


def compose_top_ref(en_prefix, he_prefix, address_types, unit, depth, n_leaves):
    """English/Hebrew ref parts for the top unit `unit` (1-based array position)."""
    if unit is None:
        return en_prefix, he_prefix
    at = address_types[0]
    value = unit - 1 if at == "Talmud" else unit
    en_parts = en_prefix + [format_address(at, value, "en")]
    he_parts = [p for p in he_prefix] + [format_address(at, value, "he")]
    return en_parts, he_parts


def join_ref(title, parts, with_address):
    """A Sefaria ref from a title and its section parts: commas between sections,
    a space before the address ("Siddur Ashkenaz, Weekday, ... Modeh Ani",
    "Mishneh Torah, Foundations of the Torah 1", "Berakhot 2a")."""
    parts = list(parts or [])
    prefix = parts[:-1] if (with_address and parts) else parts
    ref = title or ""
    if prefix:
        ref += ", " + ", ".join(prefix)
    if with_address and parts:
        ref += " " + parts[-1]
    return ref


def first_section_ref(title, schema):
    """The first section ref of a book, exactly as its export files name it
    (the toc's "firstSection": opening a title from a category page uses it)."""
    root = schema.get("schema") or schema
    fake = Book(title)
    fake.versions = []
    refmod = BookReference(fake, schema, schema.get("heTitle") or None)
    he_title = schema.get("heTitle") or title
    if not refmod.leaves:
        return title, he_title
    leaf, path = refmod.leaves[0]
    en_prefix, he_prefix = refmod.leaf_refs(leaf, path)
    depth = leaf_depth(leaf)
    if depth >= 2:
        ats = leaf_address_types(leaf)
        at = ats[0] if ats else "Integer"
        value = TALMUD_FIRST if at == "Talmud" else 1
        en_parts = en_prefix + [format_address(at, value, "en")]
        he_parts = he_prefix + [format_address(at, value, "he")]
        en = join_ref(title, en_parts, True)
        he = join_ref(he_title, he_parts, True)
        if depth >= 3:
            # the export wraps deeper books per top section; the first inner
            # section is part of the first ref ("Rashi on Genesis 1:1")
            at2 = ats[1] if len(ats) > 1 else "Integer"
            value2 = TALMUD_FIRST if at2 == "Talmud" else 1
            en += ":" + format_address(at2, value2, "en")
            he += ":" + format_address(at2, value2, "he")
        return en, he
    return join_ref(title, en_prefix, False), join_ref(he_title, he_prefix, False)


def versions_index(versions, book):
    """The index's `versions` array: full version objects (minus empty strings)."""
    out = []
    for v in versions:
        doc = {
            "language": v.extra.get("language") or v.language,
            "title": book.title,
            "versionSource": v.version_source or "",
            "versionTitle": v.version_title,
            "actualLanguage": v.extra.get("actualLanguage") or v.language,
            "languageFamilyName": v.extra.get("languageFamilyName") or "",
            "isSource": bool(v.extra.get("isSource")),
            "isPrimary": bool(v.extra.get("isPrimary")),
            "direction": v.extra.get("direction") or ("rtl" if (v.language == "he") else "ltr"),
            "status": v.extra.get("status") or "locked",
            "priority": v.extra.get("priority") or 0,
        }
        if v.license:
            doc["license"] = v.license
        he_title = v.extra.get("versionTitleInHebrew") or ""
        if he_title:
            doc["versionTitleInHebrew"] = he_title
        notes = v.extra.get("versionNotes") or ""
        if notes:
            doc["versionNotes"] = notes
        he_notes = v.extra.get("versionNotesInHebrew") or ""
        if he_notes:
            doc["versionNotesInHebrew"] = he_notes
        short = v.extra.get("shortVersionTitle") or ""
        if short:
            doc["shortVersionTitle"] = short
        # remove empty values, as the official exporter does
        for k in list(doc.keys()):
            if isinstance(doc[k], str) and not doc[k]:
                doc.pop(k)
        out.append(doc)
    return out


def compute_content_counts(refmod, versions, root):
    """content_counts for a single-leaf JaggedArrayNode: segment counts per unit."""
    if len(refmod.leaves) != 1:
        return None
    leaf = refmod.leaves[0][0]
    depth = leaf_depth(leaf)
    if depth < 2:
        return None
    texts = [v.text for v in versions if v.text is not None]
    lengths = complete_lengths(leaf, texts, depth)
    counts = [0] * (lengths[0] if lengths else 0)
    if not counts:
        return None
    # use the first version per lang, merged
    for lang in ("he", "en"):
        for v in sorted_versions(refmod.book):
            if (v.language or "") != lang or v.text is None:
                continue
            if not isinstance(v.text, list):
                break            # dict-shaped text: no segment counts
            for i, unit in enumerate(v.text[:len(counts)]):
                if counts[i] == 0 and not is_empty_text(unit):
                    counts[i] = len(unit) if isinstance(unit, list) else 1
            break
    return counts


def leaf_count(refmod):
    return len(refmod.leaves)


def get_text_at(v, indices):
    return text_at(v.text, indices)


# ---------------------------------------------------------------- top-section export

def compose_section_prefixes(refmod, leaf, path):
    en_prefix, he_prefix = refmod.leaf_refs(leaf, path)
    return en_prefix, he_prefix


def export_top_section(refmod, leaf, path, depth, address_types, section_names,
                       he_section_names, en_ref, he_ref, texts, unit_idx, links_index,
                       files, add_file, prev_next=None):
    """Export one top section (depth 1-2) or the {ref, sections:{}} wrapper
    for a deeper leaf section."""
    prev_next = prev_next or {}
    book = refmod.book
    # gather non-empty version chunks at this level
    chunks = {}
    for (vt, lang), v in texts.items():
        t = get_text_at(v, [unit_idx] if unit_idx is not None else [])
        if is_empty_text(t):
            continue
        chunks[(vt, lang)] = t

    if not chunks:
        # empty section: metadata only (officially exported with empty versions,
        # no version files)
        if depth <= 2:
            meta = {
                "ref": en_ref,
                "heRef": he_ref,
                "indexTitle": book.title,
                "heTitle": refmod.he_title or "",
                "sectionRef": en_ref,
                "versions": [],
                "links": [],
                "prev": prev_next.get("prev"),
                "next": prev_next.get("next"),
            }
            add_file(f"{en_ref}.metadata.json", meta)
        return

    at = address_types[0] if (unit_idx is not None and depth >= 2) else None

    if depth <= 2:
        # metadata for the section itself; then per-version files
        meta = {
            "ref": en_ref,
            "heRef": he_ref,
            "indexTitle": book.title,
            "heTitle": refmod.he_title or "",
            "sectionRef": en_ref,
        }
        meta_versions = []
        version_by_id = {}
        for (vt, lang), chunk in chunks.items():
            meta_versions.append({"versionTitle": vt, "language": lang})
            version_by_id[(vt, lang)] = chunk
        # match index version order in metadata
        index_order = [v_id(v) for v in sorted_versions(book)]
        meta_versions.sort(key=lambda d: index_order.index((d["versionTitle"], d["language"]))
                           if (d["versionTitle"], d["language"]) in index_order else 999)
        meta["versions"] = meta_versions
        meta.setdefault("prev", prev_next.get("prev"))
        meta.setdefault("next", prev_next.get("next"))

        # segment arrays: strip stray nesting by mutli-leaf handled above
        seg_lists = {}
        for (vt, lang), chunk in version_by_id.items():
            seg_lists[(vt, lang)] = strip_itags(chunk)
        n_segments = max(len(x) for x in seg_lists.values()) if seg_lists else 0
        # build links for each segment of this section
        links = segment_links(links_index, book, en_ref, n_segments)

        meta["links"] = links
        add_file(f"{en_ref}.metadata.json", meta)
        for (vt, lang), segs in seg_lists.items():
            add_file(f"{en_ref}.{md5_hash8(vt)}.{lang}.json", segs)
        return

    # depth >= 3: wrapper with nested subsections
    # subsections = second-level units (1..n) ... or deeper for depth 4+
    meta_wrapper = {"ref": en_ref, "sections": {}}
    text_wrapper = {}
    for (vt, lang) in chunks:
        text_wrapper[(vt, lang)] = {"ref": en_ref, "sections": {}}
    lengths = leaf_lengths(leaf)
    sub_count = lengths[1] if depth >= 3 else 0
    sub_at = address_types[1]
    sub_value_off = 0 if sub_at == "Talmud" else 1
    present_subs = []
    for sub in range(1, sub_count + 1):
        sub_idx = sub - 1
        sub_value = sub - 1 if sub_at == "Talmud" else sub
        sub_en = f"{en_ref}:{format_address(sub_at, sub_value, 'en')}"
        sub_he = f"{he_ref}:{format_address(sub_at, sub_value, 'he')}"
        sub_sections = {}
        sub_version_chunks = {}
        for (vt, lang), chunk in chunks.items():
            t = text_at(chunk, [sub_idx])
            if is_empty_text(t):
                continue
            sub_version_chunks[(vt, lang)] = t
        if not sub_version_chunks:
            continue
        # build the sub-section metadata like a depth-2 section
        meta_versions = []
        for (vt, lang) in sub_version_chunks:
            meta_versions.append({"versionTitle": vt, "language": lang})
        index_order = [v_id(v) for v in sorted_versions(book)]
        meta_versions.sort(key=lambda d: index_order.index((d["versionTitle"], d["language"]))
                           if (d["versionTitle"], d["language"]) in index_order else 999)
        seg_lists = {(vt, lang): strip_itags(c) for (vt, lang), c in sub_version_chunks.items()}
        n_segments = max(len(x) for x in seg_lists.values())
        sub_meta = {
            "ref": sub_en,
            "heRef": sub_he,
            "indexTitle": book.title,
            "heTitle": refmod.he_title or "",
            "sectionRef": sub_en,
            "versions": meta_versions,
            "links": segment_links(links_index, book, sub_en, n_segments),
        }
        present_subs.append(sub_en)
        meta_wrapper["sections"][sub_en] = sub_meta
        for (vt, lang), segs in seg_lists.items():
            text_wrapper[(vt, lang)]["sections"][sub_en] = segs
    if meta_wrapper["sections"]:
        # neighbours for the subsections, within this wrapper
        for i, s in enumerate(present_subs):
            inner = meta_wrapper["sections"][s]
            inner["prev"] = present_subs[i - 1] if i else None
            inner["next"] = present_subs[i + 1] if i + 1 < len(present_subs) else None
        add_file(f"{en_ref}.metadata.json", meta_wrapper)
        for (vt, lang), doc in text_wrapper.items():
            add_file(f"{en_ref}.{md5_hash8(vt)}.{lang}.json", doc)


_ITAG = re.compile(r"(<i\s[^>]*\bdata-commentator\b[^>]*></i>)|</?i>")


def strip_itags(text):
    """Strip inline itags (format markers like <i>) from a text segment.  A commentary's
    invisible anchor ("<i data-commentator=... data-order=...></i>": Sofer's editors' notes, as the
    phone's own Wikisource books have them) is kept whole - its "</i>" alone taken away left an
    open <i> that swallowed the rest of the paragraph (reader/dibbur.js skips inside it)."""
    if isinstance(text, str):
        return _ITAG.sub(lambda m: m.group(1) or "", text)
    if isinstance(text, list):
        return [strip_itags(x) for x in text]
    if isinstance(text, dict):
        return {k: strip_itags(v) for k, v in text.items()}
    if text is None:
        return text
    return str(text)      # (a stray number in imported texts: keep it as text)


# ---------------------------------------------------------------- links per segment

def segment_links(links_index, book, en_section_ref, n_segments):
    """Links array for one section: list (possibly sparse) per segment."""
    rows = links_index.get(book.title) or []
    per_seg: dict[int, list] = {}
    for r1, r2, _linktype in rows:
        if book_of_ref(r1) == book.title:
            anchor, other = r1, r2
        elif book_of_ref(r2) == book.title:
            anchor, other = r2, r1
        else:
            continue
        title, addrs = ref_segments(anchor)
        if not addrs:
            continue
        seg_num_str = addrs[-1]
        if not seg_num_str.isdigit():
            continue
        seg_num = int(seg_num_str)
        # the anchor must live in this section at the right depth
        sec_addrs = en_section_ref.split(" ", 1)[1] if " " in en_section_ref else ""
        anc_addr = " ".join(addrs[:-1])
        if anc_addr.strip() != sec_addrs.strip():
            continue
        he_other = ""
        cat = None
        per_seg.setdefault(seg_num, []).append(
            simple_link(other, he_other, cat, False))
    if not per_seg:
        return []
    links = []
    last = 0
    for seg in sorted(per_seg):
        while last + 1 < seg:
            links.append(None)
            last += 1
            pass
        links.append(per_seg[seg])
        last = seg
    return links


# ---------------------------------------------------------------- core files

def hebrew_category_map(books: dict[str, Book], schema_cache: dict):
    cat_he = {}
    for title, book in books.items():
        for v in book.versions:
            cats, heCats = (v.extra.get("categories"), (v.extra.get("heCategories")))
            if not cats:
                continue
            try:
                s = None
            except Exception:
                pass
            for c, h in zip(cats, heCats or ()):
                cat_he.setdefault(c, h or c)
            break
    return cat_he


def first_sections_from_zips(titles, out_dir: Path):
    """The first section each book actually contains, as its zip names it.

    A book whose schema starts with empty chapters (many commentaries) must not
    advertise a `firstSection` that was never written - the app opens that ref
    from a category page."""
    first = {}
    for t in titles:
        path = out_dir / f"{t}.zip"
        try:
            with zipfile.ZipFile(path) as z:
                for name in z.namelist():
                    if not name.endswith(".metadata.json"):
                        continue
                    try:
                        meta = json.loads(z.read(name))
                    except ValueError:
                        break
                    subs = meta.get("sections")
                    if isinstance(subs, dict) and subs:
                        first[t] = next(iter(subs))
                    else:
                        ref = meta.get("ref") or meta.get("sectionRef")
                        if ref:
                            first[t] = ref
                    break
        except (OSError, zipfile.BadZipFile):
            continue
    return first


def export_core_files(provider, titles, out_dir: Path, toc_override=None, sizes=None):
    """toc.json, packages.json, last_updated.json (+ friends) for the export."""
    def sz(t):
        v = (sizes or {}).get(t)
        return v[0] if isinstance(v, tuple) else (v or 0)
    ok_titles = [t for t in titles if sz(t)]
    schemas = {}
    for t in ok_titles:
        try:
            schemas[t] = provider.get_schema(t)
        except Exception:  # noqa: BLE001
            pass

    if toc_override is not None:
        toc = toc_override
    else:
        first = first_sections_from_zips(ok_titles, out_dir)
        toc = build_toc(schemas, ok_titles, first)
        write_json(out_dir, "toc.json", toc)
        # (a temporary search filter toc: the same tree; proper filters later)
        write_json(out_dir, "search_toc.json", toc)

    last = {
        "schema_version": SCHEMA_VERSION,
        "comment": "",
        "titles": {
            t: datetime.fromtimestamp((out_dir / f"{t}.zip").stat().st_mtime).isoformat()
            if (out_dir / f"{t}.zip").is_file() else datetime.now().isoformat()
            for t in ok_titles
        },
    }
    write_json(out_dir, "last_updated.json", last)

    packages = [{
        "en": "COMPLETE LIBRARY", "he": "כל הספרייה", "color": "Other",
        "size": sum(sz(t) for t in ok_titles) + index_size(out_dir, "COMPLETE LIBRARY"),
        "indexes": [],
    }]
    for cat_node in [n for n in toc if n.get("category")]:
        cat = cat_node["category"]
        indexes = [t for t in ok_titles
                   if (schemas.get(t, {}).get("categories") or [None])[0] == cat]
        if not indexes:
            continue
        packages.append({
            "en": cat.upper(),
            "he": cat_node.get("heCategory") or cat,
            "color": TOC_COLORS.get(cat, cat),
            "indexes": indexes,
            "size": sum(sz(t) for t in indexes) + index_size(out_dir, cat.upper()),
        })
    write_json(out_dir, "packages.json", packages)
    copy_aux_files(out_dir)
    return toc


AUX_FILES = ("topic_toc.json", "hebrew_categories.json", "people.json", "calendar.json")


def index_size(out_dir: Path, package_name: str) -> int:
    """Bytes of this package's offline search index, if one has been built."""
    path = out_dir / "_index" / f"{package_name}.idx"
    return path.stat().st_size if path.is_file() else 0


def copy_aux_files(out_dir: Path):
    """The app also fetches these core files; they are Sefaria's static metadata
    (topics, Hebrew category names, people, calendar), so copy them from the app's
    bundled sources."""
    app_sources = Path(__file__).resolve().parents[2] / "android" / "app" / "src" / "main" / "assets" / "sources"
    for name in AUX_FILES:
        src = app_sources / name
        if src.is_file():
            shutil.copyfile(src, out_dir / name)


def book_toc_item(title, schema, first_section=None):
    """A book's toc entry."""
    item = {"title": title}
    cats = schema.get("categories") or []
    if cats:
        item["categories"] = list(cats)
    if schema.get("heTitle"):
        item["heTitle"] = schema["heTitle"]
    order = schema.get("order")
    if isinstance(order, list):
        order = order[0] if order else None
    if order:
        item["order"] = order
    if schema.get("compDate"):
        item["compDate"] = schema["compDate"]
    if schema.get("compDateString"):
        item["compDateString"] = schema["compDateString"]
    if schema.get("enDesc"):
        item["enDesc"] = schema["enDesc"]
    if schema.get("heDesc"):
        item["heDesc"] = schema["heDesc"]
    if schema.get("enShortDesc"):
        item["enShortDesc"] = schema["enShortDesc"]
    if schema.get("heShortDesc"):
        item["heShortDesc"] = schema["heShortDesc"]
    dep = (schema.get("dependence") or "").strip()
    if dep:
        item["dependence"] = dep.capitalize()
    if cats:
        item["primary_category"] = "Commentary" if dep.lower() == "commentary" else cats[0]
    coll = schema.get("collective_title")
    if isinstance(coll, dict):
        if coll.get("en"):
            item["collectiveTitle"] = coll["en"]
        if coll.get("he"):
            item["heCollectiveTitle"] = coll["he"]
    bases = schema.get("base_text_titles")
    if bases:
        item["base_text_titles"] = [
            b.get("en") if isinstance(b, dict) else str(b) for b in bases
        ]
    if schema.get("base_text_mapping"):
        item["base_text_mapping"] = schema["base_text_mapping"]
    first_en, _first_he = first_section_ref(title, schema)
    item["firstSection"] = first_section or first_en
    item.setdefault("enShortDesc", "")
    item.setdefault("heShortDesc", "")
    return item


def build_toc(schemas, titles, first_sections=None):
    """A toc tree grouped by the books' own category chains."""
    first_sections = first_sections or {}
    def add(node, cats, item):
        if not cats or (len(cats) == 1):
            node.setdefault("__books__", []).append(item)
            return
        sub = node.setdefault(cats[0], {})
        sub.setdefault("__he__", cats[0])
        add(sub, cats[1:], item)
    root = {}
    for t in sorted(titles):
        s = schemas.get(t)
        if not s:
            continue
        cats = s.get("categories") or ["Reference"]
        add(root, cats, book_toc_item(t, s, first_sections.get(t)))

    def serialize(node, name=None, he_name=None):
        books = node.get("__books__", [])
        out = []
        for cat in sorted(k for k in node if k not in ("__books__", "__he__")):
            sub = node[cat]
            out.append({
                "category": cat,
                "heCategory": hebrew_category_name(cat),
                "color": TOC_COLORS.get(cat, cat),
                "enShortDesc": "",
                "heShortDesc": "",
                "contents": serialize(sub),
            })
        out += books
        return out

    top = []
    for cat in sorted(k for k in root if k not in ("__books__", "__he__")):
        sub = root[cat]
        top.append({
            "category": cat,
            "heCategory": hebrew_category_name(cat),
            "color": TOC_COLORS.get(cat, cat),
            "enShortDesc": "",
            "heShortDesc": "",
            "contents": serialize(sub),
        })
    top += root.get("__books__", [])
    return top


_HEBREW_CATEGORY_FILE = None


def hebrew_category_name(cat):
    """Hebrew name of a category, from Sofer's hardcoded map or Sefaria's file."""
    global _HEBREW_CATEGORY_FILE
    if cat in HEBREW_CATEGORIES:
        return HEBREW_CATEGORIES[cat]
    if _HEBREW_CATEGORY_FILE is None:
        path = (Path(__file__).resolve().parents[2] / "android" / "app" / "src"
                / "main" / "assets" / "sources" / "hebrew_categories.json")
        try:
            _HEBREW_CATEGORY_FILE = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _HEBREW_CATEGORY_FILE = {}
    return _HEBREW_CATEGORY_FILE.get(cat) or cat


TOC_COLORS = {
    "Tanakh": "Tanakh", "Mishnah": "Mishnah", "Talmud": "Talmud", "Midrash": "Midrash",
    "Halakhah": "Halakhah", "Kabbalah": "Kabbalah", "Liturgy": "Liturgy",
    "Jewish Thought": "Philosophy", "Chasidut": "Chasidut", "Musar": "Musar",
    "Responsa": "Responsa", "Second Temple": "Second Temple", "Reference": "Reference",
    "Modern Commentary on Tanakh": "Tanakh", "Acharonim on Tanakh": "Tanakh",
    "Rishonim on Tanakh": "Tanakh", "Targum": "Targum", "Wikitext": "Tanakh",
    "Dicta Library": "Reference", "Otzaria": "Reference", "Givot Olam": "Reference",
    "Dictionary": "Reference", "Dictionary Bet HaLevi": "Reference",
}

HEBREW_CATEGORIES = {
    "Tanakh": "תנ״ך", "Mishnah": "משנה", "Talmud": "תלמוד", "Midrash": "מדרש",
    "Halakhah": "הלכה", "Kabbalah": "קבלה", "Liturgy": "סדר התפילה",
    "Jewish Thought": "מחשבת ישראל", "Chasidut": "חסידות", "Musar": "מוסר",
    "Responsa": "שו״ת", "Second Temple": "בית שני", "Reference": "מקורות ונספחים",
    "Reference View": "מקורות ונספחים", "Commentary": "מפרשים", "Sheets": "דפים",
}


# ---------------------------------------------------------------- bundles

ARCHIVE_SIZE = 100_000_000   # (the official exporter's own bundle cap)


def build_bundles(out_dir: Path):
    """Split the export into downloadable bundles, one per package.

    Layout mirrors the official MobileContentServer:
        <out>/bundles/<Package>/<N>.zip
    each holding the per-title zips of a chunk of the package's indexes.
    """
    packages_path = out_dir / "packages.json"
    if not packages_path.is_file():
        return
    packages = json.loads(packages_path.read_text(encoding="utf-8"))
    bundle_path = out_dir / "bundles"
    bundle_path.mkdir(exist_ok=True)
    for package in packages:
        name = package["en"]
        if name == "COMPLETE LIBRARY":
            titles = sorted(p.stem for p in out_dir.glob("*.zip"))
        else:
            titles = package.get("indexes") or []
            if not titles:
                continue
        pkg_dir = bundle_path / name
        if pkg_dir.exists():
            shutil.rmtree(pkg_dir)
        pkg_dir.mkdir(parents=True)
        # The tiny search index travels as part 0 so it is fetched first.
        index_file = out_dir / "_index" / f"{name}.idx"
        if index_file.is_file():
            with zipfile.ZipFile(pkg_dir / "0.zip", "w", zipfile.ZIP_STORED) as zi:
                zi.write(index_file, arcname=f"{name}_search.idx")
        z = None
        n_files = 0
        i = 0
        chunk_size = 0
        for title in titles:
            book_zip = out_dir / f"{title}.zip"
            if not book_zip.is_file():
                print(f"  ! no zip for {title}; bundle will miss this text", flush=True)
                continue
            # plain-text copy of the book for offline search (build_search.py)
            search_file = out_dir / "_search" / f"{title}.txt"
            entry_size = book_zip.stat().st_size
            if search_file.is_file():
                entry_size += search_file.stat().st_size
            if z is not None and chunk_size and chunk_size + entry_size > ARCHIVE_SIZE:
                z.close()
                z = None
                chunk_size = 0
            if z is None:
                i += 1
                z = zipfile.ZipFile(pkg_dir / f"{i}.zip", "w", zipfile.ZIP_DEFLATED)
            z.write(book_zip, arcname=f"{title}.zip")
            n_files += 1
            if search_file.is_file():
                z.write(search_file, arcname=f"{title}_search.txt")
            chunk_size += entry_size
            if chunk_size > ARCHIVE_SIZE:
                z.close()
                z = None
                chunk_size = 0
        if z:
            z.close()
        print(f"  bundles/{name}: {i} file(s), {n_files} books", flush=True)


# ---------------------------------------------------------------- main runner

def resolve_wanted(spec: str, titles: set[str]) -> set[str]:
    """Resolve a comma separated selection against real titles.

    Book titles often contain commas themselves ("Mishneh Torah, Foundations of
    the Torah"), so plain splitting is wrong.  Join consecutive pieces greedily
    and accept them only when the result is an existing title.
    """
    if not spec:
        return set()
    pieces = [p.strip() for p in spec.split(",") if p.strip()]
    wanted, i = set(), 0
    while i < len(pieces):
        match = None
        for j in range(len(pieces), i, -1):
            candidate = ", ".join(pieces[i:j])
            if candidate in titles:
                match = candidate
                i = j
                break
        if match is None:
            raise SystemExit(f"Unknown book title: {pieces[i]!r} "
                             "(titles must match the Sefaria title exactly)")
        wanted.add(match)
    return wanted


def read_title_file(path: Path) -> list[str]:
    """One title per line; blank lines and # comments ignored."""
    titles = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            titles.append(line)
    return titles


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=r"C:\Users\morde\Sofer\data\sefaria-export")
    ap.add_argument("--out", default=r"C:\Users\morde\Soferia\export-v7")
    ap.add_argument("--books", default="", help="comma separated titles; empty = all")
    ap.add_argument("--books-file", default="",
                    help="file with one exact title per line (commas allowed)")
    ap.add_argument("--patch", action="store_true",
                    help="export selected books only; leave toc/packages/bundles untouched")
    ap.add_argument("--core-only", action="store_true",
                    help="rebuild toc/packages/last_updated/bundles from the zips already in --out")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-links", action="store_true",
                    help="skip cross-reference links (much faster and lighter; links can be added later)")
    ap.add_argument("--no-bundles", action="store_true",
                    help="do not rebuild the download bundles (with --core-only)")
    args = ap.parse_args()

    source = Path(args.source)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    provider = LocalExportProvider(source)
    source = Path(provider.root)   # (the long form, matching the provider)

    print(f"Listing library from {source} ...", flush=True)
    if args.core_only:
        zips = {p.stem: p for p in out_dir.glob("*.zip")}
        if not zips:
            raise SystemExit(f"No book zips found in {out_dir}")
        def _size(t, p):
            n = p.stat().st_size
            search_file = out_dir / "_search" / f"{t}.txt"
            if search_file.is_file():
                n += search_file.stat().st_size
            return (n, 0.0)

        sizes = {t: _size(t, p) for t, p in zips.items()}
        titles = sorted(zips)
        print(f"Rebuilding core files for {len(titles)} exported books ...", flush=True)
        export_core_files(provider, titles, out_dir, sizes=sizes)
        if not args.no_bundles:
            print("Building downloadable bundles ...", flush=True)
            build_bundles(out_dir)
        print("Core files rebuilt ->", out_dir, flush=True)
        return

    blocked = blocked_titles(source)
    books = discover_books(source, None, blocked)
    wanted = resolve_wanted(args.books, set(books))
    if args.books_file:
        from_file = read_title_file(Path(args.books_file))
        missing = [t for t in from_file if t not in books]
        if missing:
            raise SystemExit("Unknown book titles in --books-file:\n  "
                             + "\n  ".join(missing[:20]))
        wanted.update(from_file)
    if wanted:
        blocked = {t: r for t, r in blocked.items() if t in wanted}
        books = {t: b for t, b in books.items() if t in wanted}
    elif args.books or args.books_file:
        raise SystemExit("No matching books for the given selection.")
    selected = list(books)
    if args.limit:
        selected = selected[: args.limit]
    print(f"{len(books)} books in library; exporting {len(selected)}. "
          f"{len(blocked)} left out by Sofer's rules.", flush=True)

    links_index = defaultdict(list)
    if not args.no_links:
        links_index = build_links_index(source, {t for t in selected})
        print(f"Links indexed for {len(links_index)} books.", flush=True)
    else:
        print("Links skipped (--no-links).", flush=True)

    ok, failed = 0, []
    sizes = {}
    dropped_editions = []
    inherited_editions = []
    failed_reason = {}
    t0 = time.time()
    for i, title in enumerate(selected, 1):
        book = books[title]
        t1 = time.time()
        try:
            load_book_versions(provider, book)
            for d in getattr(book, "licence_dropped", []):
                dropped_editions.append({"title": title, **d})
            for d in getattr(book, "licence_inherited", []):
                inherited_editions.append({"title": title, **d})
            success, size = export_book(book, provider, links_index, out_dir, None)
        except Exception as e:  # noqa: BLE001
            (out_dir / f"{title}.zip").unlink(missing_ok=True)
            success, size = False, None
            failed_reason[title] = f"{type(e).__name__}: {e}"
            print(f"  ! {title}: {type(e).__name__}: {e}", flush=True)
            traceback.print_exc()
        book.versions = []          # release the text
        if success:
            ok += 1
            sizes[title] = (size if size else 0, time.time() - t1)
        else:
            failed.append(title)
            if title not in failed_reason:
                if not getattr(book, "licence_dropped", None):
                    failed_reason[title] = "no text read"
                else:
                    failed_reason[title] = "no redistributable edition"
        if i % 25 == 0 or i == len(selected):
            print(f"  [{i}/{len(selected)}] ok={ok} failed={len(failed)} "
                  f"({time.time() - t0:.0f}s) latest: {title}", flush=True)

    print(f"Exported {ok} books ({len(failed)} failed).", flush=True)
    no_edition = [t for t in failed
                  if failed_reason.get(t) == "no redistributable edition"]
    if no_edition:
        print(f"  ({len(no_edition)} of the failed books have no edition that may "
              f"be redistributed; the rest are real errors.)", flush=True)
    if failed:
        print("Failed titles:", json.dumps(failed[:50], ensure_ascii=False, indent=1),
              "..." if len(failed) > 50 else "", flush=True)
    if ok and not args.patch:
        print("Writing core files (toc, packages, last_updated) ...", flush=True)
        export_core_files(provider, [t for t in selected], out_dir, sizes=sizes)
        print("Building downloadable bundles ...", flush=True)
        build_bundles(out_dir)
    elif ok and args.patch:
        print("Patch mode: core files and bundles left untouched.", flush=True)
    write_json(out_dir, "_export_report.json", {
        "ok": ok, "failed": failed, "failed_reason": failed_reason,
        "books_no_eligible_edition": [
            t for t in failed
            if failed_reason.get(t) == "no redistributable edition"
        ],
        "sizes": sizes, "seconds": time.time() - t0,
        "books_left_out": blocked,
        "editions_dropped": dropped_editions,
        "editions_inheriting_licence": inherited_editions,
    })
    print(f"Left out by Sofer's rules: {len(blocked)} books; "
          f"dropped editions: {len(dropped_editions)}.", flush=True)
    print("Export complete ->", out_dir, flush=True)


if __name__ == "__main__":
    main()
