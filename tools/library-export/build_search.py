"""Build the plain-text search files for an exported v7 library.

The app searches what it has downloaded.  For every book this script writes

    <export>/_search/<Title>.txt

with one line per text segment:

    enRef <TAB> heRef <TAB> lang <TAB> versionTitle <TAB> text

Only the primary version of each language is indexed (the one the reader shows
by default), so translations that are never displayed are not duplicated.

The resulting files are added to the download bundles next to the book zips
(<Title>_search.txt), which means the app has them on disk as soon as a package
finishes downloading - without having to unpack 8,000 book zips first.

Usage:
    python tools/library-export/build_search.py --export C:\\Users\\morde\\Soferia\\export-v7
    python tools/library-export/build_search.py --export ... --books "Genesis,Berakhot"
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
import zipfile
from pathlib import Path

_TAG = re.compile(r"<[^>]*>")
_SPACES = re.compile(r"[ \t\r\n]+")


def clean(text) -> str:
    """One line of displayable text: no HTML, no tabs, no line breaks."""
    if text is None:
        return ""
    if isinstance(text, (list, tuple)):
        return " ".join(clean(part) for part in text if part is not None)
    text = str(text)
    text = _TAG.sub("", text)
    text = html.unescape(text)
    return _SPACES.sub(" ", text).strip()


def version_hash(version_title: str) -> str:
    return hashlib.md5(version_title.encode("utf-8")).hexdigest()[:8]


def text_units(text):
    """A section's text as a flat list of strings.

    Depth 2 sections are a list of segments; depth 1 sections are a single
    string; some payloads nest one more level (commentaries on a verse).
    """
    if isinstance(text, str):
        return [text]
    if isinstance(text, list):
        if all(not isinstance(x, (list, dict)) for x in text):
            return text
        return [clean(x) for x in text]
    if isinstance(text, dict):
        return [clean(x) for x in text.values()]
    return []


def section_entries(metadata):
    """(ref, heRef, [version objects]) for each section in a metadata file."""
    if isinstance(metadata.get("sections"), dict):
        for ref, sub in metadata["sections"].items():
            yield ref, sub.get("heRef") or ref, sub.get("versions") or []
    else:
        ref = metadata.get("ref") or metadata.get("sectionRef")
        if ref:
            yield ref, metadata.get("heRef") or ref, metadata.get("versions") or []


def primary_versions(versions):
    """First (highest priority) version of each language."""
    seen = set()
    out = []
    for v in versions:
        lang = v.get("language")
        title = v.get("versionTitle")
        if not lang or not title or lang in seen:
            continue
        seen.add(lang)
        out.append((lang, title))
    return out


def segments_for_section(z: zipfile.ZipFile, names: set, stem: str, ref: str,
                         lang: str, version_title: str):
    """The segment texts of one section in one version."""
    name = f"{stem}.{version_hash(version_title)}.{lang}.json"
    if name not in names:
        # fall back on any file for this version/language (hash mismatch)
        prefix = f"{stem}."
        candidates = [n for n in names
                      if n.startswith(prefix) and n.endswith(f".{lang}.json")
                      and n.count(".") == stem.count(".") + 2]
        if not candidates:
            return []
        name = candidates[0]
    try:
        payload = json.loads(z.read(name))
    except (ValueError, KeyError):
        return []
    if isinstance(payload, dict):
        payload = payload.get("sections", {}).get(ref, payload.get("text"))
    return [clean(unit) for unit in text_units(payload)]


def build_book(zip_path: Path, out_path: Path) -> int:
    """Write the search text of one book; returns the number of indexed lines."""
    lines = []
    with zipfile.ZipFile(zip_path) as z:
        names = set(z.namelist())
        for meta_name in names:
            if not meta_name.endswith(".metadata.json"):
                continue
            stem = meta_name[: -len(".metadata.json")]
            try:
                metadata = json.loads(z.read(meta_name))
            except ValueError:
                continue
            for ref, he_ref, versions in section_entries(metadata):
                for lang, version_title in primary_versions(versions):
                    units = segments_for_section(z, names, stem, ref, lang, version_title)
                    for i, unit in enumerate(units, start=1):
                        if not unit:
                            continue
                        lines.append(f"{ref}:{i}\t{he_ref}:{i}\t{lang}\t{version_title}\t{unit}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))
        if lines:
            fh.write("\n")
    return len(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True, help="folder built by export_v7.py")
    ap.add_argument("--books", default="", help="comma separated titles (default: all)")
    ap.add_argument("--books-file", default="", help="file with one title per line")
    ap.add_argument("--no-bundles", action="store_true",
                    help="only write _search files, do not rebuild bundles")
    args = ap.parse_args()
    out = Path(args.export)
    search_dir = out / "_search"

    titles = sorted(p.stem for p in out.glob("*.zip"))
    if args.books:
        wanted = {t.strip() for t in args.books.split(",") if t.strip()}
        titles = [t for t in titles if t in wanted]
    if args.books_file:
        wanted = {line.strip() for line in
                  Path(args.books_file).read_text(encoding="utf-8-sig").splitlines()
                  if line.strip()}
        titles = [t for t in titles if t in wanted]

    started = time.time()
    total_lines = 0
    for i, title in enumerate(titles, 1):
        try:
            n = build_book(out / f"{title}.zip", search_dir / f"{title}.txt")
        except (OSError, zipfile.BadZipFile) as e:
            print(f"  ! {title}: {e}", flush=True)
            continue
        total_lines += n
        if i % 200 == 0 or i == len(titles):
            print(f"  [{i}/{len(titles)}] {total_lines:,} lines "
                  f"({time.time() - started:.0f}s)", flush=True)

    size = sum(p.stat().st_size for p in search_dir.glob("*.txt"))
    print(f"search text: {len(titles)} books, {total_lines:,} lines, "
          f"{size / 1e9:.2f} GB -> {search_dir}", flush=True)

    if not args.no_bundles:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import export_v7  # noqa: E402
        print("Rebuilding bundles with the search files ...", flush=True)
        export_v7.build_bundles(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
