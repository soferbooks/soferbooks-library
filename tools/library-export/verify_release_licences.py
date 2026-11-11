"""Check that a built release carries no text of versions the licence filter excludes.

Reads every Sefaria zip in <work>/zips (each version's "license" in <Title>_index.json),
then every hosted file of <work>/release:

* search-*.zip: every line's version (field 4) must have an open licence in that book;
* corrections.zip: every patched section file (<stem>.<version hash>.<lang>) must belong
  to an open version of that book, and no excluded version title may occur anywhere in it;
* the .idx files are not checked: they hold trigram hashes and book ids only.

    python tools/library-export/verify_release_licences.py --work C:\\Users\\morde\\Soferia\\sefaria-packs

The Sofer Library release (build_sofer_library.py) is checked with --sofer-library <release dir>:
every book (and editors'-notes book) in sofer-library-catalog.json must be there with its size
and sha256; every edition in its <Title>_index.json must have a licence the Sofer Library may
carry (a combined edition: every edition it was made of too) and be one the catalogue lists -
an open licence or, by the owner's decision of 2026-11-11 ("treat unknown licences leniently"),
an unknown or missing one, never one that forbids giving it out (bsp.licence_sofer_library); every section file
(<ref>.<version hash>.<lang>.json) must belong to one of those editions; and the release may hold
no other file.

    python tools/library-export/verify_release_licences.py --sofer-library C:\\Users\\morde\\Soferia\\sofer-library\\release
Exit code 1 if anything excluded is found.
"""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_sefaria_packs as bsp  # noqa: E402
import sofer_corrections as sc  # noqa: E402

EXAMPLES = ("On Your Way", "The Tosefta according to codex Vienna",
            "THE JPS TANAKH: Gender-Sensitive Edition", "Steinsaltz", "Koren")


def verify_sofer_library(release: Path) -> int:
    """The Sofer Library release: only editions it may carry, only the files the catalogue lists.
    (Owner, 2026-11-11: unknown licences are accepted; anything that forbids distribution is not.)"""
    catalog = json.loads((release / "sofer-library-catalog.json").read_text(encoding="utf-8"))
    problems = []
    books = []
    for b in catalog["books"]:
        books += [b] + list(b.get("companions") or [])
    listed = {"sofer-library-catalog.json", "SHA256SUMS.txt"}
    editions = 0
    for b in books:
        title, path = b["title"], release / b["file"]
        listed.add(b["file"])
        if not path.is_file():
            problems.append(f"{title}: {b['file']} is missing")
            continue
        if path.stat().st_size != b["size"] or bsp.sha256(path) != b["sha256"]:
            problems.append(f"{title}: {b['file']} is not the file the catalogue describes")
        catalogued = {(v["language"], v["versionTitle"]): v for v in b["versions"]}
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            if f"{title}_index.json" not in names:
                problems.append(f"{title}: no {title}_index.json")
                continue
            lic = bsp.book_licences(z)
        hashes = set()
        for (lang, vt), licence in lic.items():
            editions += 1
            hashes.add((sc.version_hash(vt), lang))
            cat = catalogued.get((lang, vt))
            if cat is None:
                problems.append(f"{title}: edition {vt!r} ({lang}) is not in the catalogue")
            elif "parts" in cat and not (cat["parts"] and all(bsp.licence_sofer_library(p["license"]) for p in cat["parts"])):
                problems.append(f"{title}: combined edition {vt!r} is made of an edition it may not carry")
            if not bsp.licence_sofer_library(licence):
                problems.append(f"{title}: edition {vt!r} ({lang}) has licence {licence!r}")
        for name in names:
            if name.endswith("_index.json") or name.endswith(".metadata.json"):
                continue
            parts = name[: -len(".json")].rsplit(".", 2) if name.endswith(".json") else []
            if len(parts) != 3 or (parts[1], parts[2]) not in hashes:
                problems.append(f"{title}: {name} belongs to no open edition")
    for f in release.iterdir():
        if f.name not in listed:
            problems.append(f"{f.name}: in the release but not in the catalogue")
    for p in problems[:50]:
        print("  !", p)
    print(f"sofer library: {len(books)} books, {editions} editions, {len(problems)} problems")
    print("FAIL" if problems else "OK: only editions the Sofer Library may carry (open or unknown licence)")
    return 1 if problems else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=r"C:\Users\morde\Soferia\sefaria-packs")
    ap.add_argument("--sofer-library", default="", help="check a Sofer Library release folder instead")
    args = ap.parse_args()
    if args.sofer_library:
        return verify_sofer_library(Path(args.sofer_library))
    work = Path(args.work)
    release = work / "release"
    manifest = json.loads((release / "manifest.json").read_text(encoding="utf-8"))
    names = json.loads((work / "core" / "last_updated.json").read_text(encoding="utf-8"))["titles"]

    open_versions: dict[str, set] = {}
    excluded_titles_anywhere, open_titles_anywhere = set(), set()
    for title in names:
        zp = work / "zips" / f"{bsp.fs_name(title)}.zip"
        if not zp.is_file():
            continue
        with zipfile.ZipFile(zp) as z:
            lic = bsp.book_licences(z)
        ok = {k for k, v in lic.items() if bsp.licence_open(v)}
        open_versions[title] = ok
        for k, v in lic.items():
            (open_titles_anywhere if k in ok else excluded_titles_anywhere).add(k[1])
    never_open = excluded_titles_anywhere - open_titles_anywhere
    print(f"{len(open_versions)} books; {len(never_open)} version titles excluded in every book they are in")

    bad_lines, lines, files = 0, 0, 0
    examples = {}
    for shard in manifest["search"]["shards"].values():
        for a in shard["assets"]:
            with zipfile.ZipFile(release / a["name"]) as z:
                for entry in z.namelist():
                    title = entry[: -len("_search.txt")]
                    ok = open_versions.get(title, set())
                    files += 1
                    for line in z.read(entry).decode("utf-8").splitlines():
                        f = line.split("\t", 4)
                        if len(f) < 5:
                            continue
                        lines += 1
                        if (f[2], f[3]) not in ok:
                            bad_lines += 1
                            if bad_lines <= 10:
                                print(f"  ! {a['name']} {title}: {f[2]} {f[3]!r}")
                        for ex in EXAMPLES:
                            if ex in f[3]:
                                examples.setdefault(ex, set()).add(f[3])
    print(f"search: {files} files, {lines:,} lines, {bad_lines} lines of excluded versions")
    for ex, vts in sorted(examples.items()):
        print(f"  hosted version titles containing {ex!r}: {sorted(vts)}")

    # (some version titles are junk or common words - "hi", "\\", "Introduction" - so only
    #  distinctive ones are looked for)
    long_titles = [vt for vt in never_open if len(vt.strip()) >= 20]
    bad_ops = bad_titles = 0
    corr = release / "corrections.zip"
    if corr.is_file():
        with zipfile.ZipFile(corr) as z:
            for entry in z.namelist():
                raw = z.read(entry).decode("utf-8")
                data = json.loads(raw)
                ok = {(sc.version_hash(vt), lang) for lang, vt in open_versions.get(data["title"], set())}
                for name in data["files"]:
                    parts = name.rsplit(".", 2)
                    if len(parts) != 3 or (parts[1], parts[2]) not in ok:
                        bad_ops += 1
                        print(f"  ! corrections {data['title']}: {name}")
                for vt in long_titles:
                    if vt in raw:
                        bad_titles += 1
                        print(f"  ! corrections {data['title']} mentions {vt!r}")
    print(f"corrections: {bad_ops} patched files of excluded versions, "
          f"{bad_titles} excluded version titles mentioned")
    failed = bad_lines or bad_ops or bad_titles
    print("FAIL" if failed else "OK: no excluded version in the hosted files")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
