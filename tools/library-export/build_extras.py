"""Package the books Sefaria does not have ("SoferBooks extras") for a GitHub Release.

Sofer's importers (``C:\\Users\\morde\\Sofer\\src\\sofer\\importers.py``, ``splits.py``) write
the Dicta, Otzaria, Wikitext, Ben-Yehuda and split books into Sofer's library in Sefaria's
export layout and list the files they wrote in ``data/extra_import_manifest.json`` and
``data/split_manifest.json``.  This script is a thin wrapper around the existing tools:

1. reads those manifests -> the extra titles, grouped by source (dicta / otzaria /
   wikisource / soferbooks);
2. ``export_v7.py --books-file ... --patch`` -> schema-7 ``<Title>.zip`` per book (Sofer's
   corrections and licence rules applied, as for the old full export);
3. ``export_v7.py --core-only --no-bundles`` -> ``toc.json`` / ``last_updated.json`` /
   ``packages.json`` for the extras only;
4. ``build_search.py`` + ``build_search_index.write_index`` -> search text and one trigram
   index per source;
5. writes ``<out>/release/``: ``extras-<source>[-n].zip`` (book zips + their
   ``<Title>_search.txt``; split below GitHub's 2 GiB limit), ``index-extras-<source>.idx``,
   ``extras-toc.json``, ``extras-last-updated.json``, ``extras-manifest.json``, ``SHA256SUMS.txt``.

Usage:
    python tools/library-export/build_extras.py --out C:\\Users\\morde\\Soferia\\extras --limit 5
    python tools/library-export/build_extras.py --out C:\\Users\\morde\\Soferia\\extras --sources otzaria
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_search_index  # noqa: E402
from build_sefaria_packs import asset, sha256  # noqa: E402

SOFER_DATA = Path(r"C:\Users\morde\Sofer\data")
SOURCES = ("dicta", "otzaria", "wikisource", "soferbooks")
LONG_PATH_PREFIX = "\\\\?\\" if os.name == "nt" else ""   # (paths over Windows' 260-letter limit)


def source_of(version_title: str) -> str:
    v = version_title.lower()
    if v.startswith("dicta library") or "dicta" in v and "nakdan" not in v:
        return "dicta"
    if v.startswith("otzaria"):
        return "otzaria"
    if "wikisource" in v or "wikitext" in v or "ויקיטקסט" in v:
        return "wikisource"
    return "soferbooks"


def extra_titles(data: Path, library: Path) -> dict[str, str]:
    """{title: source} for every book Sofer added to the Sefaria library (and still has)."""
    found: dict[str, set] = {}
    extra = json.loads((data / "extra_import_manifest.json").read_text(encoding="utf-8-sig"))
    paths = [(p, False) for p in extra.get("files", [])]
    split = data / "split_manifest.json"
    if split.is_file():
        paths += [(p, True) for p in json.loads(split.read_text(encoding="utf-8-sig"))]
    for p, is_split in paths:
        parts = p.split("/")
        if parts[0] != "json" or len(parts) < 4:
            continue
        title, version = parts[-3], parts[-1][: -len(".json")]
        if not os.path.isfile(LONG_PATH_PREFIX + str((library / Path(*parts)).resolve())):
            continue      # (a manifest entry the importers have since replaced)
        found.setdefault(title, set()).add("soferbooks" if is_split else source_of(version))
    # a book with editions from several sources goes with the first in SOURCES order
    return {t: next(s for s in SOURCES if s in srcs) for t, srcs in found.items()}


def run(*args):
    print("  $", " ".join(str(a) for a in args), flush=True)
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    subprocess.run([sys.executable, *map(str, args)], check=True, env=env)


def pack(source: str, titles: list[str], out: Path, release: Path, part_size: int) -> list[Path]:
    parts, z, used, n = [], None, 0, 0
    for title in titles:
        files = [(out / f"{title}.zip", f"{title}.zip"),
                 (out / "_search" / f"{title}.txt", f"{title}_search.txt")]
        files = [(f, a) for f, a in files if f.is_file()]
        if not files or not files[0][0].name.endswith(".zip"):
            continue
        size = sum(f.stat().st_size for f, _a in files)
        if z is not None and used + size > part_size:
            z.close()
            z = None
        if z is None:
            n += 1
            path = release / (f"extras-{source}.zip" if n == 1 else f"extras-{source}-{n}.zip")
            parts.append(path)
            z = zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED)
            used = 0
        for f, a in files:
            z.write(f, arcname=a)
        used += size
    if z is not None:
        z.close()
    return parts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="working folder (book zips, _search, release/)")
    ap.add_argument("--source-library", default=str(SOFER_DATA / "sefaria-export"))
    ap.add_argument("--sources", default="", help=f"comma separated, of {', '.join(SOURCES)}")
    ap.add_argument("--limit", type=int, default=0, help="first N books of each source (tests)")
    ap.add_argument("--links", action="store_true", help="export links too (needs much RAM)")
    ap.add_argument("--skip-export", action="store_true", help="reuse the zips already in --out")
    ap.add_argument("--part-size", type=int, default=1_500_000_000,
                    help="largest asset (bytes, uncompressed input); GitHub's limit is 2 GiB")
    ap.add_argument("--tag", default="")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    wanted_sources = [s.strip() for s in args.sources.split(",") if s.strip()] or list(SOURCES)
    by_source: dict[str, list[str]] = {s: [] for s in wanted_sources}
    for title, source in sorted(extra_titles(SOFER_DATA, Path(args.source_library)).items()):
        if source in by_source:
            by_source[source].append(title)
    if args.limit:
        by_source = {s: t[: args.limit] for s, t in by_source.items()}
    titles = sorted(t for ts in by_source.values() for t in ts)
    print(f"{len(titles)} extra books: " + ", ".join(f"{s} {len(t)}" for s, t in by_source.items()),
          flush=True)

    titles_file = out / "_extras_titles.txt"
    titles_file.write_text("\n".join(titles) + "\n", encoding="utf-8")
    if not args.skip_export:
        run(HERE / "export_v7.py", "--source", args.source_library, "--out", out,
            "--books-file", titles_file, "--patch", *([] if args.links else ["--no-links"]))
    exported = {t for t in titles if (out / f"{t}.zip").is_file()}
    run(HERE / "export_v7.py", "--source", args.source_library, "--out", out, "--core-only",
        "--no-bundles")
    run(HERE / "build_search.py", "--export", out, "--books-file", titles_file, "--no-bundles")

    release = out / "release"
    if release.exists():
        shutil.rmtree(release)
    release.mkdir()
    ordered = sorted(exported)
    postings = build_search_index.collect_postings(out, ordered)
    gid = {t: i for i, t in enumerate(ordered)}
    sources_out = {}
    for source, src_titles in by_source.items():
        src_titles = [t for t in src_titles if t in exported]
        if not src_titles:
            continue
        parts = pack(source, src_titles, out, release, args.part_size)
        local = [-1] * len(ordered)
        for j, t in enumerate(src_titles):
            local[gid[t]] = j
        idx = release / f"index-extras-{source}.idx"
        build_search_index.write_index(idx, src_titles, postings, local)
        sources_out[source] = {
            "books": len(src_titles),
            "assets": [asset(p) for p in parts],
            "index": asset(idx, file=f"SoferBooks extras {source}_search.idx"),
        }
        print(f"  {source}: {len(src_titles)} books, "
              f"{sum(p.stat().st_size for p in parts) / 1e6:.1f} MB in {len(parts)} part(s)", flush=True)

    for src, dest in (("toc.json", "extras-toc.json"), ("last_updated.json", "extras-last-updated.json"),
                      ("packages.json", "extras-packages.json")):
        if (out / src).is_file():
            shutil.copyfile(out / src, release / dest)
    tag = args.tag or f"extras-{datetime.now(timezone.utc):%Y-%m-%d}"
    manifest = {
        "format": 1,
        "kind": "extras",
        "tag": tag,
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "schema_version": "7",
        "partial": bool(args.limit or args.sources),
        "core": {name: asset(release / name) for name in
                 ("extras-toc.json", "extras-last-updated.json", "extras-packages.json")
                 if (release / name).is_file()},
        "sources": sources_out,
    }
    (release / "extras-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1),
                                                  encoding="utf-8")
    with (release / "SHA256SUMS.txt").open("w", encoding="utf-8", newline="\n") as fh:
        for f in sorted(release.iterdir()):
            if f.name != "SHA256SUMS.txt":
                fh.write(f"{sha256(f)}  {f.name}\n")
    total = sum(f.stat().st_size for f in release.iterdir())
    print(f"extras release {tag}: {total / 1e6:.1f} MB -> {release}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
