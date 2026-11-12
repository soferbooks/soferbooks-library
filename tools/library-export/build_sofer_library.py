"""Build the "Sofer Library" release: the books only Sofer has, as schema-7 book zips.

Owner's decision (2026-11-11): SoferBooks hosts ONLY the books the app cannot get from their
own source - every other book still comes from its source's server.  Those are the books in
Sofer's library (``C:\\Users\\morde\\Sofer``, read only) that Sefaria's mobile export, Dicta,
Otzaria and Wikisource do not serve:

* ``split``     the books Sofer splits out of a Sefaria book (``sofer.splits.SPLITS``: Ben Ish
                Hai's Derashos and Halachos, the Tur and its five commentaries in four parts,
                Shaar HaBitachon with its commentaries);
* ``ben-david`` Rabbi Eliezer Ben-David's sefarim (``sofer.saba``: his family's Word files);
* ``ben-yehuda`` the Ben-Yehuda collections Sofer gathered (``sofer.benyehuda``);
* ``combined``  Sofer's "Combined editions" (``sofer.combined``): offered as a book of its own,
                "<Title> (Combined editions)" / "<he> (מהדורה משולבת)", next to Sefaria's;
* ``sofer``     anything else Sofer imported from a source the app does not have (the Kiddush
                book from its Word file, Tehillim 119 by a name ...);
* ``wikisource`` the Wikitext books Sofer makes into other books than the page, which the phone's
                Wikisource source does not convert (``wikitext_not_on_phone``, owner 2026-11-12):
                Megillat Antiochus in Rabbi Menashe Zelicha's edition with its Targum, and
                Chashukei Chemed on each masechta, arranged by amud - with their editors' notes.

Everything goes through the existing tools, as thin a layer as possible:

* the books are found from Sofer's own manifests (``data/extra_import_manifest.json``,
  ``data/combined_manifest.json``) and ``sofer.splits``; a book Sefaria's mobile export has
  (``--sefaria-titles``: the ``last_updated.json`` the Sefaria release was built from) or
  that another extra source serves is not taken;
* ``export_v7`` exports them (Sofer's reading-time corrections applied by his own provider;
  Sofer's never-offered books and translations left out: ``sofer.not_offered``);
* licences (``build_sefaria_packs.licence_sofer_library``): editions with an open licence
  (public domain, CC0, CC-BY(-SA), CC-BY-NC(-SA)) and - owner's decision, 2026-11-11 - those
  whose licence is unknown or not given; never one that says it may not be given out (copyright,
  all rights reserved, personal use only ...).  A combined edition: every edition it was made of
  so too.  A book with no such edition, or listed in ``NO_PERMISSION``, is left out
  (``<out>/left-out.json``);
* a translation Sofer keeps as a book of its own (``TRANSLATIONS``: Return to Your Homes) is
  laid out on its original's passages (``align_translation.py``) and given as that book's
  English edition, so the app shows the two side by side;
* the shelves are Sofer's (``sofer.api.catalog.shelf_of``: poems on "שירה ופיוט" ...);
* Sofer's own links of a book (``links/links_wikitext_*.csv``: each piece of Chashukei Chemed on
  its Gemara line) go in its sections' metadata (``add_links``), which the app reads
  (extras/sofer.js linksOf).

Writes ``<out>/release/``: one ``<asset>.zip`` per book (ASCII names: GitHub renames others),
``sofer-library-catalog.json`` (each book: title, Hebrew title, English title and other names,
kind, shelf, licences, size, sha256, md5, first section, the editors'-notes book that comes with it,
and - with ``--previous`` - the earlier zips whose text is the same, ``sameTextAs``) and
``SHA256SUMS.txt``.
Check it with ``verify_release_licences.py --sofer-library <out>/release`` before uploading.

Run with Sofer's own Python (it has his dependencies):

    C:\\Users\\morde\\Sofer\\.venv\\Scripts\\python.exe tools\\library-export\\build_sofer_library.py ^
        --out C:\\Users\\morde\\Soferia\\sofer-library --tag sofer-library-2026-11-11
"""
from __future__ import annotations

import argparse
import copy
import dataclasses
import hashlib
import json
import re
import shutil
import sys
import types
import zipfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import export_v7 as ev  # noqa: E402  (puts Sofer's src on the path)
from build_sefaria_packs import licence_open, licence_sofer_library, sha256  # noqa: E402
from align_translation import align  # noqa: E402

from sofer import licenses, not_offered, splits, saba  # noqa: E402
from sofer.library import Library  # noqa: E402
from sofer.text_providers.local_export import LocalExportProvider  # noqa: E402

# sofer.api's __init__ starts Sofer's web server (FastAPI); only its catalogue module is needed
if "sofer.api" not in sys.modules:
    _api = types.ModuleType("sofer.api")
    _api.__path__ = [str(Path(ev.SOFER_SRC) / "sofer" / "api")]
    sys.modules["sofer.api"] = _api
from sofer.api import catalog as sofer_catalog  # noqa: E402

SOFER_DATA = Path(r"C:\Users\morde\Sofer\data")
SOURCE_ID = "sofer_library"            # sources.js / extras/sofer.js
CATALOG_NAME = "sofer-library-catalog.json"
NOTES_PREFIX = "הערות המהדיר על "
COMBINED = "Combined editions"
COMBINED_EN = " (Combined editions)"
COMBINED_HE = " (מהדורה משולבת)"
CATALOG_FORMAT = 1
# Hebrew names of shelves Sofer's catalogue has no Hebrew name for
SHELF_HE = {"Tehillim": "תהלים"}

# Books with no clear permission to give them out publicly (left out, reported).  (2026-11-11:
# Rabbi Yaakov Feitman gave permission for Out of the Iron Furnace, and Return to Your Homes is
# confirmed - none is left.)
NO_PERMISSION: dict[str, str] = {}

# A translation Sofer keeps as a book of its own -> (its original, the edition's name): given as
# the original's English edition, passage by passage (owner, 2026-11-11)
TRANSLATIONS = {
    "Return to Your Homes": ("Shuvu Lachem LeOhaleichem", "Return to Your Homes (English translation, family edition)"),
}


def source_of(version_title: str) -> str:
    """The app's source of an edition Sofer imported (build_extras.source_of)."""
    v = version_title.lower()
    if v.startswith("dicta library") or "dicta" in v and "nakdan" not in v:
        return "dicta"
    if v.startswith("otzaria"):
        return "otzaria"
    if "wikisource" in v or "wikitext" in v or "ויקיטקסט" in v:
        return "wikisource"
    return "sofer"


def wikitext_not_on_phone() -> dict[str, str]:
    """{title: Hebrew title in the app} of the books Sofer imports from Wikitext pages the phone's
    Wikisource source does not convert (wikisource_books.py leaves them out): a page holding a sefer
    in several versions (``wikisource.VERSIONS``: Megillat Antiochus, Rabbi Menashe Zelicha's
    edition - the sefer and its Targum) and a book split by masechta (``wikisource.BY_MASECHTA``:
    Chashukei Chemed on each masechta), with their editors' notes.  Exported here from Sofer's own
    import, as Sofer converts them (owner, 2026-11-12).  A version of a sefer the library has from
    Sefaria under the same Hebrew name ("מגילת אנטיוכוס") keeps its edition in its Hebrew name, as
    its English one does, so the app keeps it beside Sefaria's copy (extras/catalog.js: one copy
    of each Hebrew name) - the combined editions' rule.  A title that is a prefix ends with " ":
    every book whose title starts with it."""
    from sofer import wikisource as ws
    out: dict[str, str] = {}
    for page, versions in ws.VERSIONS.items():
        edition = re.search(r"\s*\([^()]*\)$", page)
        for en, he, *_ in versions.values():
            out[en] = he + (edition.group(0) if edition else "")
            out[NOTES_PREFIX + he] = ""             # (the editors' notes on it: named as Sofer names them)
    for en, he in ws.BY_MASECHTA.values():
        out[f"{en} on "] = ""
        out[f"{NOTES_PREFIX}{he} על "] = ""
    return out


def wikitext_he_title(title: str, table: dict[str, str]) -> str | None:
    """None: not one of wikitext_not_on_phone's books; '': Sofer's own Hebrew title; else the app's."""
    if title in table:
        return table[title]
    return "" if any(k.endswith(" ") and title.startswith(k) for k in table) else None


def kind_of(version_title: str) -> str:
    if version_title == saba.VERSION:
        return "ben-david"
    if "ben-yehuda" in version_title.lower():
        return "ben-yehuda"
    return "sofer"


def sofer_only_books(data: Path, sefaria_titles: set[str]) -> dict[str, str]:
    """{title: kind} of the books only Sofer has ({title + COMBINED_EN: 'combined'} for the
    combined editions, which are versions of a Sefaria book)."""
    out: dict[str, str] = {}
    for parts in splits.SPLITS.values():
        for p in parts:
            out[p["title"]] = "split"
    manifest = json.loads((data / "extra_import_manifest.json").read_text(encoding="utf-8-sig"))
    by_title: dict[str, set] = {}
    for p in manifest.get("files", []):
        parts = p.replace("\\", "/").split("/")
        if parts[0] == "json" and len(parts) >= 4:
            by_title.setdefault(parts[-3], set()).add(parts[-1][: -len(".json")])
    not_on_phone = wikitext_not_on_phone()
    for title, versions in by_title.items():
        if title in out or title in sefaria_titles:
            continue
        if wikitext_he_title(title, not_on_phone) is not None and all(source_of(v) == "wikisource" for v in versions):
            out[title] = "wikisource"           # (Wikitext books the phone's Wikisource does not convert)
            continue
        if any(source_of(v) != "sofer" for v in versions):
            continue                        # (served by Dicta / Otzaria / Wikisource itself)
        out[title] = kind_of(sorted(versions)[0])
    combined = data / "combined_manifest.json"
    if combined.is_file():
        for p in json.loads(combined.read_text(encoding="utf-8-sig")):
            parts = p.replace("\\", "/").split("/")
            if parts[0] == "json" and len(parts) >= 4 and parts[-1] == f"{COMBINED}.json":
                out[parts[-3] + COMBINED_EN] = "combined"
    return out


def is_open(v) -> bool:
    """May this edition be given out publicly (a combined edition: every edition in it)?"""
    if v.version_title == COMBINED:
        parts = v.extra.get("sofer_combined") or []
        return bool(parts) and all(
            licence_sofer_library(licenses.LICENSE_CORRECTIONS.get(p.get("versionTitle"), p.get("license")))
            for p in parts)
    return licence_sofer_library(v.license)


def translation_edition(provider, found: dict, original_text, title: str, name: str):
    """A translation book's text laid out on its original's passages, as an edition of the
    original (None when it cannot be given out); with the alignment's report."""
    book = found.get(title)
    if book is None:
        return None, None
    ev.load_book_versions(provider, book)
    versions = [v for v in book.versions if is_open(v)]
    book.versions = []
    if not versions:
        return None, None
    v = versions[0]
    text, report = align(original_text, v.text)
    return dataclasses.replace(v, text=text, version_title=name, title=TRANSLATIONS[title][0]), report


def translation_names(provider, title: str) -> list[str]:
    """A translation book's names in its own schema (its Hebrew one: "שובו לכם לאהליכם (באנגלית)")."""
    try:
        schema = provider.get_schema(title)
    except Exception:  # noqa: BLE001
        return []
    root = schema.get("schema") if isinstance(schema.get("schema"), dict) else {}
    return [t.get("text") for t in root.get("titles") or [] if t.get("text") and t.get("text") != title]


class RenamedProvider:
    """Sofer's provider, with one book's schema under another title (a combined edition)."""

    def __init__(self, provider, original: str, title: str, he_title: str):
        self.provider, self.original, self.title, self.he_title = provider, original, title, he_title
        self.root = provider.root

    def get_schema(self, title):
        if title != self.title:
            return self.provider.get_schema(title)
        s = copy.deepcopy(self.provider.get_schema(self.original))
        s["title"], s["heTitle"] = self.title, self.he_title
        root = s.get("schema")
        if isinstance(root, dict):
            root["key"] = self.title
            for t in root.get("titles") or []:
                if t.get("primary"):
                    t["text"] = self.title if t.get("lang") == "en" else self.he_title
        return s

    def __getattr__(self, name):
        return getattr(self.provider, name)


def asset_name(title: str) -> str:
    """An ASCII asset name for a book (GitHub keeps only these characters)."""
    slug = re.sub(r"[^A-Za-z0-9]+", "-", title).strip("-")[:60]
    digest = hashlib.md5(title.encode("utf-8")).hexdigest()[:8]
    return f"{slug}-{digest}.zip" if slug else f"book-{digest}.zip"


def stamp_source(zip_path: Path, title: str) -> None:
    """Mark the book's editions as the Sofer Library's ("Report an error" goes to SoferBooks)."""
    name = f"{title}_index.json"
    tmp = zip_path.with_suffix(".tmp")
    with zipfile.ZipFile(zip_path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == name:
                index = json.loads(data)
                index["librarySource"] = SOURCE_ID
                for v in index.get("versions") or []:
                    v["librarySource"] = SOURCE_ID
                data = json.dumps(index, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            zout.writestr(item.filename, data)
    tmp.replace(zip_path)


# Sofer's own links of the books it imported (importers: "links/links_wikitext_<name>.csv" - each
# piece of Chashukei Chemed tied to its Gemara line, Mordy 2026-11-12: "lay it out by the word, so
# mikraos look prints and connections in app"); Sefaria's own links files are not read here
OWN_LINKS = "links_wikitext_*.csv"
_TALMUD_REF = re.compile(r"^(?P<title>.+) (?P<daf>\d+)(?P<side>[ab]):(?P<seg>\d+)$")


def own_links(root: Path) -> dict[str, list[tuple[str, str]]]:
    """{book title: [(its passage's ref, the ref it is linked to)]} from Sofer's own links files."""
    import csv
    out: dict[str, list[tuple[str, str]]] = {}
    for f in sorted((root / "links").glob(OWN_LINKS)):
        with open(f, encoding="utf-8", newline="") as fh:
            rows = csv.reader(fh)
            next(rows, None)
            for row in rows:
                if len(row) >= 4 and row[0] and row[1]:
                    out.setdefault(row[3], []).append((row[0], row[1]))
    return out


def he_talmud_ref(ref: str, he_titles: dict[str, str]) -> str:
    """A Gemara passage's Hebrew name as Sefaria gives it ("Berakhot 56a:15" -> "ברכות נ״ו א:ט״ו")."""
    m = _TALMUD_REF.match(ref)
    if not m or m["title"] not in he_titles:
        return ""
    ai = 2 * int(m["daf"]) - 2 + (m["side"] == "b")
    return f"{he_titles[m['title']]} {ev.format_address('Talmud', ai, 'he')}:{ev.format_address('Integer', int(m['seg']), 'he')}"


def add_links(zip_path: Path, title: str, links: list[tuple[str, str]], he_titles: dict[str, str]) -> int:
    """The book's own links put in its sections' metadata, as Sefaria's export has them (each
    passage's list of {sourceRef, sourceHeRef}): the app shows them in the book's connections and,
    from them, the book under the passage each is on (extras/sofer.js linksOf).  -> links added."""
    by_section: dict[str, dict[int, list]] = {}
    for a, t in links:
        section, _, seg = a.rpartition(":")
        if section.startswith(title + " ") and seg.isdigit():
            by_section.setdefault(section, {}).setdefault(int(seg), []).append(
                {"sourceRef": t, "sourceHeRef": he_talmud_ref(t, he_titles) or t})
    added = 0
    tmp = zip_path.with_suffix(".tmp")
    with zipfile.ZipFile(zip_path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            section = item.filename[: -len(".metadata.json")] if item.filename.endswith(".metadata.json") else None
            if section in by_section:
                meta = json.loads(data)
                segs = by_section[section]
                meta["links"] = [segs.get(n) for n in range(1, max(segs) + 1)]
                added += sum(len(v) for v in segs.values())
                data = json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            zout.writestr(item.filename, data)
    tmp.replace(zip_path)
    return added


_LATIN = re.compile(r"[A-Za-z]")
_HEBREW = re.compile(r"[֐-׿]")


def is_english(name) -> bool:
    return bool(name) and bool(_LATIN.search(name)) and not _HEBREW.search(name)


def catalog_titles(schema: dict, title: str, kind: str, translations: list[str]) -> dict:
    """The book's names for the catalogue, from Sofer's schema: ``enTitle`` (its English title,
    when it has one: English interfaces show it instead of the Hebrew) and ``titleVariants`` /
    ``heTitleVariants`` (its other names, so a title search finds the book by them - Ben-David's
    English translation, "Return to Your Homes", finds "Shuvu Lachem LeOhaleichem", whose English
    edition it is).  A combined edition is named as its title says, with no other names (they are
    Sefaria's book's, next to it)."""
    root = schema.get("schema") if isinstance(schema.get("schema"), dict) else {}
    names = list(root.get("titles") or schema.get("titles") or [])
    en_primary = next((t.get("text") for t in names if t.get("lang") == "en" and t.get("primary")), None)
    en = title if kind == "combined" or is_english(title) else en_primary
    out = {"enTitle": en} if is_english(en) else {}
    if kind == "combined":
        return out
    seen = {title, en, schema.get("heTitle"), root.get("heTitle")}
    variants, he_variants = [], []
    for name in [t.get("text") for t in names] + list(schema.get("titleVariants") or [])             + list(schema.get("heTitleVariants") or []) + translations:
        if not name or name in seen:
            continue
        seen.add(name)
        (variants if is_english(name) else he_variants).append(name)
    if variants:
        out["titleVariants"] = variants
    if he_variants:
        out["heTitleVariants"] = he_variants
    return out


DEFAULT_NAME = ", default"                 # (how earlier releases named a default node's files)


def section_texts(zip_path: Path) -> dict:
    """A book zip's section text (every edition's segments, by section), with the names earlier
    releases gave a default node's files (", default") taken out: what the reader shows, without
    the sections' metadata (prev/next, Hebrew refs) and the index."""
    out = {}
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            if name.endswith(".metadata.json") or name.endswith("_index.json") or not name.endswith(".json"):
                continue
            doc = json.loads(z.read(name))
            if isinstance(doc, dict) and isinstance(doc.get("sections"), dict):
                doc = {k.replace(DEFAULT_NAME, ""): v for k, v in doc["sections"].items()}
            out[name.replace(DEFAULT_NAME, "")] = doc
    return out


def same_text_as(previous: Path | None, entries: list, books_dir: Path) -> int:
    """Each book (and its notes) whose text is the same as in the release this one replaces gets
    that release's zip in ``sameTextAs`` (with the zips it was the same as): a phone that has it
    is not sent the book again for changes in the metadata alone (extras/index.js booksToUpdate).
    -> how many."""
    if not previous:
        return 0
    old = json.loads((previous / CATALOG_NAME).read_text(encoding="utf-8"))
    old_by_title = {b["title"]: b for e in old["books"] for b in [e] + e.get("companions", [])}
    same = 0
    for e in entries:
        for b in [e] + e.get("companions", []):
            o = old_by_title.get(b["title"])
            if not o or o.get("sha256") == b["sha256"] or not (previous / o["file"]).is_file():
                continue
            if section_texts(previous / o["file"]) == section_texts(books_dir / f"{b['title']}.zip"):
                b["sameTextAs"] = sorted({o["sha256"], *(o.get("sameTextAs") or [])})
                same += 1
    return same


def shelf(lib: Library, title: str) -> tuple[list, list]:
    """The book's shelf (English, Hebrew), as Sofer's own catalogue shows it."""
    book = lib.get(title)
    path = list(sofer_catalog.shelf_of(book))
    he_names = sofer_catalog._he_names(lib)
    he = []
    for i, c in enumerate(path):
        name = he_names.get(tuple(path[: i + 1]))
        if not name and i < len(book.he_categories) and tuple(book.categories[: i + 1]) == tuple(path[: i + 1]):
            name = book.he_categories[i]
        he.append(name or SHELF_HE.get(c) or c)
    return path, he


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=r"C:\Users\morde\Soferia\sofer-library")
    ap.add_argument("--source-library", default=str(SOFER_DATA / "sefaria-export"))
    ap.add_argument("--sefaria-titles", default=r"C:\Users\morde\Soferia\sefaria-packs\core\last_updated.json",
                    help="Sefaria's last_updated.json: the books the app gets from Sefaria")
    ap.add_argument("--tag", default=f"sofer-library-{datetime.now(timezone.utc):%Y-%m-%d}")
    ap.add_argument("--books", default="", help="only these titles (separated by '|'), for tests")
    ap.add_argument("--skip-export", action="store_true", help="reuse the zips already in <out>/books")
    ap.add_argument("--previous", default="",
                    help="a downloaded copy of the release this one replaces (its catalogue and zips): "
                         "books whose text is unchanged name its zip in sameTextAs")
    args = ap.parse_args()

    out = Path(args.out)
    books_dir = out / "books"
    release = out / "release"
    books_dir.mkdir(parents=True, exist_ok=True)
    src = Path(args.source_library)
    provider = LocalExportProvider(src)
    lib = Library(provider, cache=out / "_sofer_library_index.json")     # (never Sofer's own cache)
    sefaria_titles = set(json.loads(Path(args.sefaria_titles).read_text(encoding="utf-8"))["titles"])

    wanted = sofer_only_books(SOFER_DATA, sefaria_titles)
    not_on_phone = wikitext_not_on_phone()
    if args.books:
        only = set(args.books.split("|"))
        wanted = {t: k for t, k in wanted.items() if t in only}
    originals = {t: (t[: -len(COMBINED_EN)] if k == "combined" else t) for t, k in wanted.items()}
    blocked = ev.blocked_titles(Path(provider.root))
    found = ev.discover_books(Path(provider.root), set(originals.values()) | set(TRANSLATIONS), None)
    alignments = {}
    linked = own_links(src)
    he_titles = {b.title: b.he_title for b in lib.books.values()} if linked else {}
    print(f"{len(wanted)} Sofer-only books found", flush=True)

    left_out: dict[str, str] = {}
    exported: dict[str, dict] = {}
    for title, kind in sorted(wanted.items()):
        original = originals[title]
        if title in NO_PERMISSION:
            left_out[title] = NO_PERMISSION[title]
            continue
        if title in TRANSLATIONS:
            continue                       # (an edition of its original: below)
        if original in blocked or title in blocked:
            left_out[title] = blocked.get(original) or blocked[title]
            continue
        if any(ch in title for ch in '\\/:*?"<>|'):
            left_out[title] = "its title cannot be a file name"
            continue
        book = found.get(original)
        sofer_book = lib.get(original)
        if book is None or sofer_book is None:
            left_out[title] = "not in Sofer's library"
            continue
        if not_offered.book(sofer_book):
            left_out[title] = "not offered (sofer.not_offered)"
            continue
        if kind == "combined":
            book.versions_paths = [p for p in book.versions_paths if p.stem == COMBINED]
        ev.load_book_versions(provider, book)
        # (an edition with no licence is said to have an unknown one, as Sefaria writes it)
        kept = [v if v.license else dataclasses.replace(v, license="Unknown") for v in book.versions if is_open(v)]
        closed = sorted({f"{v.version_title} ({v.license or 'no licence'})" for v in book.versions if not is_open(v)})
        if not kept:
            left_out[title] = "no edition whose licence allows giving it out: " + "; ".join(closed)
            book.versions = []
            continue
        for tr, (orig, name) in TRANSLATIONS.items():
            if orig == original and kept:
                edition, report = translation_edition(provider, found, kept[0].text, tr, name)
                if edition is not None:
                    kept.append(edition)
                    alignments[tr] = {"edition of": orig, **report}
        he_title = sofer_book.he_title + (COMBINED_HE if kind == "combined" else "")
        prov = provider
        if kind == "combined":
            prov = RenamedProvider(provider, original, title, he_title)
            book.title = title
            # (the combined edition's licence: the parts', as Sofer prints it; "Unknown" when any
            #  part's licence is unknown - included under the owner's 2026-11-11 rule)
            kept = [dataclasses.replace(v, license=v.license if all(
                licence_open(p.get("license")) for p in v.extra.get("sofer_combined") or []) else "Unknown")
                for v in kept]
        wiki_he = wikitext_he_title(title, not_on_phone) if kind == "wikisource" else None
        if wiki_he:
            he_title = wiki_he             # (an edition beside Sefaria's copy: its edition in its name)
            prov = RenamedProvider(provider, original, title, he_title)
        book.versions = kept
        zip_path = books_dir / f"{title}.zip"
        if not (args.skip_export and zip_path.is_file()):
            success, _size = ev.export_book(book, prov, {}, books_dir, None)
            if not success:
                left_out[title] = "the export failed"
                book.versions = []
                continue
            stamp_source(zip_path, title)
            if linked.get(original):
                print(f"    {add_links(zip_path, title, linked[original], he_titles)} links to the text it is on",
                      flush=True)
        schema = prov.get_schema(title)
        cats, he_cats = shelf(lib, original)
        # (a translation given as this book's edition: its names find this book)
        translated = [n for tr, (orig, _name) in TRANSLATIONS.items() if orig == original
                      for n in [tr, *translation_names(provider, tr)]]
        exported[title] = {
            "title": title,
            "heTitle": he_title,
            **catalog_titles(schema, title, kind, translated),
            "kind": kind,
            "categories": cats,
            "heCategories": he_cats,
            "license": sorted({v.license for v in kept}),
            "versions": [{"versionTitle": v.version_title, "language": v.language, "license": v.license,
                          **({"parts": [{"versionTitle": p.get("versionTitle"), "license": p.get("license")}
                                        for p in v.extra.get("sofer_combined") or []]}
                             if v.version_title == COMBINED else {})}
                         for v in kept],
            "droppedVersions": closed,
            "firstSection": ev.first_section_ref(title, schema)[0],
            **({"dependence": sofer_book.dependence} if sofer_book.dependence in ("Commentary", "Targum") else {}),
            **({"base_text_titles": list(sofer_book.bases)} if sofer_book.bases else {}),
            "_sofer_he": sofer_book.he_title,
        }
        book.versions = []
        print(f"  {kind}: {title} ({len(kept)} editions)", flush=True)

    # the editors' notes on a book ("הערות המהדיר על X") come with it, as Wikisource's do
    by_he = {e["heTitle"]: t for t, e in exported.items()}
    by_he.update({e["_sofer_he"]: t for t, e in exported.items() if e["_sofer_he"] not in by_he})
    for e in exported.values():
        e.pop("_sofer_he")                  # (Sofer's own Hebrew title: its notes book is named by it)
    for title in list(exported):
        if title.startswith(NOTES_PREFIX) and by_he.get(title[len(NOTES_PREFIX):]):
            main = exported[by_he[title[len(NOTES_PREFIX):]]]
            note = exported.pop(title)
            note["companionOf"] = main["title"]
            note["categories"], note["heCategories"] = main["categories"], main["heCategories"]
            main.setdefault("companions", []).append(note)
    for title in [t for t in exported if t.startswith(NOTES_PREFIX)]:
        left_out[title] = "editors' notes on a book that is not offered"
        exported.pop(title)

    if release.exists():
        shutil.rmtree(release)
    release.mkdir()
    entries = []
    for title, e in sorted(exported.items()):
        for b in [e] + e.get("companions", []):
            zp = books_dir / f"{b['title']}.zip"
            b["file"] = asset_name(b["title"])
            shutil.copyfile(zp, release / b["file"])
            b["size"] = zp.stat().st_size
            b["sha256"] = sha256(zp)
            b["md5"] = hashlib.md5(zp.read_bytes()).hexdigest()
        entries.append(e)
    same = same_text_as(Path(args.previous) if args.previous else None, entries, books_dir)
    catalog = {
        "format": CATALOG_FORMAT,
        "source": SOURCE_ID,
        "tag": args.tag,
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "schema_version": ev.SCHEMA_VERSION,
        "partial": bool(args.books),
        "books": entries,
    }
    (release / CATALOG_NAME).write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "left-out.json").write_text(json.dumps(left_out, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "alignments.json").write_text(json.dumps(alignments, ensure_ascii=False, indent=1), encoding="utf-8")
    with (release / "SHA256SUMS.txt").open("w", encoding="utf-8", newline="\n") as fh:
        for f in sorted(release.iterdir()):
            if f.name != "SHA256SUMS.txt":
                fh.write(f"{sha256(f)}  {f.name}\n")
    counts: dict[str, int] = {}
    for e in entries:
        counts[e["kind"]] = counts.get(e["kind"], 0) + 1
    total = sum(f.stat().st_size for f in release.iterdir())
    print(f"{len(entries)} books ({counts}), "
          f"{sum(len(e.get('companions', [])) for e in entries)} notes books with them; "
          f"{len(left_out)} left out (left-out.json); {total / 1e6:.1f} MB -> {release}; "
          f"{same} with the same text as in --previous", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
