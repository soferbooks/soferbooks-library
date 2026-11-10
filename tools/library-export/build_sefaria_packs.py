"""Build the SoferBooks release for Sefaria-downloaded books: search packs + corrections.

The app downloads Sefaria's books straight from Sefaria's mobile server.  Those zips
have no search text, and Sofer's corrections are not in them.  This script downloads
the very same zips (so every ref, segment and version is exactly what the phone has),
and writes a folder ready to upload as one GitHub Release:

    <out>/release/
        manifest.json               what is in the release (sizes, sha256, Sefaria dates)
        sefaria-last-updated.json   Sefaria's last_updated.json the release was built from
        corrections.zip             _corrections/<Title>.json per corrected book
        search-<shard>[-<n>].zip    <Title>_search.txt for the books of one shard
        index-<package>.idx         the package's trigram index (build_search_index.py)
        SHA256SUMS.txt

Shards: Sefaria's packages overlap ("TANAKH with Rashi" is inside "TANAKH and all
commentaries", every book is in COMPLETE LIBRARY), so each book's search text is stored
once, in the shard of books that belong to exactly the same packages; a package's search
pack is the list of its shards (manifest "packages").  A shard larger than --part-size
(uncompressed) is split into parts, so every asset stays far below GitHub's 2 GiB limit.

The search files, the index format and the per-book text are the existing tools'
(build_search.build_book, build_search_index.write_index); the corrections come from
Sofer's own code (sofer_corrections.py) and are applied to the search text too.

Usage (a few books first; the full library downloads ~1.5 GB from Sefaria):
    python tools/library-export/build_sefaria_packs.py --work C:\\Users\\morde\\Soferia\\sefaria-packs --books "Genesis,Zohar"
    python tools/library-export/build_sefaria_packs.py --work C:\\Users\\morde\\Soferia\\sefaria-packs
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_search  # noqa: E402
import build_search_index  # noqa: E402
import sofer_corrections  # noqa: E402

SEFARIA_EXPORT = "https://readonly.sefaria.org/static/ios-export/7"
MANIFEST_FORMAT = 1
USER_AGENT = "SoferBooks-library-builder/1.0"


# ---------------------------------------------------------------- download

def fetch(url: str, dest: Path, tries: int = 4) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as r, tmp.open("wb") as fh:
                shutil.copyfileobj(r, fh, 1 << 20)
            tmp.replace(dest)
            return
        except OSError:
            if attempt == tries - 1:
                raise
            time.sleep(2 * (attempt + 1))


_UNSAFE = re.compile(r'[<>:"/\|?*]')


def fs_name(title: str) -> str:
    """The title as a Windows file name ("One People? ..." -> "One People%3F ..."); the
    names inside the release zips keep the real title, as the phone needs it."""
    return _UNSAFE.sub(lambda m: f"%{ord(m.group()):02X}", title)


def book_url(server: str, title: str) -> str:
    return f"{server}/{urllib.parse.quote(title)}.zip"


def sync_zips(server: str, titles: list[str], dates: dict, zips_dir: Path, workers: int) -> list[str]:
    """Download the books whose zip is missing or older than Sefaria's last_updated."""
    state_path = zips_dir / "_dates.json"
    have = json.loads(state_path.read_text(encoding="utf-8")) if state_path.is_file() else {}
    todo = [t for t in titles
            if have.get(t) != dates.get(t) or not (zips_dir / f"{fs_name(t)}.zip").is_file()]
    print(f"Sefaria zips: {len(titles) - len(todo)} up to date, {len(todo)} to download", flush=True)
    failed = []

    def one(title):
        fetch(book_url(server, title), zips_dir / f"{fs_name(title)}.zip")
        return title

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(one, t): t for t in todo}
        for i, fut in enumerate(concurrent.futures.as_completed(futures), 1):
            title = futures[fut]
            try:
                fut.result()
                have[title] = dates.get(title)
            except OSError as e:
                failed.append(title)
                print(f"  ! {title}: {e}", flush=True)
            if i % 200 == 0:
                state_path.write_text(json.dumps(have, ensure_ascii=False), encoding="utf-8")
                print(f"  {i}/{len(todo)} downloaded", flush=True)
    zips_dir.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(have, ensure_ascii=False), encoding="utf-8")
    return failed


# ---------------------------------------------------------------- helpers

def slug(name: str) -> str:
    """A GitHub-safe asset name part ("TANAKH with Rashi" -> "tanakh-with-rashi")."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "x"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def asset(path: Path, **extra) -> dict:
    return {"name": path.name, "size": path.stat().st_size, "sha256": sha256(path), **extra}


def make_shards(packages: list[dict], titles: list[str]) -> dict[str, dict]:
    """Group books by the exact set of (non-COMPLETE) packages they are in.

    Returns {shard id: {"packages": [...], "titles": [...]}}; ids are the slug of the
    smallest package of the set ("other" for books only in COMPLETE LIBRARY)."""
    member = {t: [] for t in titles}
    sizes = {}
    for p in packages:
        name = p["en"]
        if name == "COMPLETE LIBRARY":
            continue
        sizes[name] = len(p.get("indexes") or [])
        for t in p.get("indexes") or []:
            if t in member:
                member[t].append(name)
    groups: dict[tuple, list] = {}
    for t in titles:
        groups.setdefault(tuple(sorted(member[t])), []).append(t)
    shards, used = {}, set()
    for key in sorted(groups, key=lambda k: (len(k), k)):
        base = slug(min(key, key=lambda n: (sizes[n], n))) if key else "other"
        sid, n = base, 2
        while sid in used:
            sid, n = f"{base}-{n}", n + 1
        used.add(sid)
        shards[sid] = {"packages": list(key), "titles": sorted(groups[key])}
    return shards


def write_shard(sid: str, titles: list[str], search_dir: Path, release: Path,
                part_size: int) -> list[Path]:
    """search-<sid>[-<n>].zip with <Title>_search.txt entries, split at part_size bytes."""
    parts, z, used, n = [], None, 0, 0
    for title in titles:
        src = search_dir / f"{fs_name(title)}.txt"
        if not src.is_file() or src.stat().st_size == 0:
            continue
        size = src.stat().st_size
        if z is not None and used + size > part_size:
            z.close()
            z = None
        if z is None:
            n += 1
            path = release / (f"search-{sid}.zip" if n == 1 else f"search-{sid}-{n}.zip")
            parts.append(path)
            z = zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9)
            used = 0
        z.write(src, arcname=f"{title}_search.txt")
        used += size
    if z is not None:
        z.close()
    return parts


# ---------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=r"C:\Users\morde\Soferia\sefaria-packs",
                    help="working folder: zips/ (Sefaria's books, kept for the next run), "
                         "_search/, _corrections/, release/")
    ap.add_argument("--server", default=SEFARIA_EXPORT, help="Sefaria's mobile export folder")
    ap.add_argument("--books", default="", help="comma separated titles (test runs)")
    ap.add_argument("--packages", default="", help="comma separated package names (test runs)")
    ap.add_argument("--tag", default="", help="release tag (default: library-YYYY-MM-DD)")
    ap.add_argument("--part-size", type=int, default=1_000_000_000,
                    help="largest uncompressed search text per asset (bytes)")
    ap.add_argument("--workers", type=int, default=6, help="parallel downloads from Sefaria")
    ap.add_argument("--no-download", action="store_true", help="use the zips already in --work")
    ap.add_argument("--no-corrections", action="store_true")
    args = ap.parse_args()

    work = Path(args.work)
    zips_dir, search_dir = work / "zips", work / "_search"
    corr_dir, release = work / "_corrections", work / "release"
    work.mkdir(parents=True, exist_ok=True)

    # 1. Sefaria's own core files
    core = work / "core"
    if not args.no_download:
        for name in ("packages.json", "last_updated.json"):
            fetch(f"{args.server}/{name}", core / name)
    packages = json.loads((core / "packages.json").read_text(encoding="utf-8"))
    last_updated = json.loads((core / "last_updated.json").read_text(encoding="utf-8"))
    dates = last_updated.get("titles") or {}
    all_titles = sorted(dates)

    titles = all_titles
    partial = bool(args.books or args.packages)
    if args.books:
        wanted = {t.strip() for t in re.split(r",(?! )", args.books) if t.strip()}
        titles = [t for t in all_titles if t in wanted]
    if args.packages:
        names = {p.strip() for p in args.packages.split(",") if p.strip()}
        in_pkgs = {t for p in packages if p["en"] in names for t in (p.get("indexes") or [])}
        titles = [t for t in titles if t in in_pkgs]
    if not titles:
        raise SystemExit("No matching books.")
    print(f"{len(all_titles)} books in Sefaria's export; building {len(titles)}.", flush=True)

    # 2. the books themselves, exactly as the phone gets them
    if not args.no_download:
        failed = sync_zips(args.server, titles, dates, zips_dir, args.workers)
        titles = [t for t in titles if t not in failed]
    titles = [t for t in titles if (zips_dir / f"{fs_name(t)}.zip").is_file()]

    # 3. corrections + search text, book by book
    if release.exists():
        shutil.rmtree(release)
    release.mkdir(parents=True)
    if corr_dir.exists():
        shutil.rmtree(corr_dir)
    t0 = time.time()
    n_ops = n_corrected = 0
    lines = 0
    for i, title in enumerate(titles, 1):
        zp = zips_dir / f"{fs_name(title)}.zip"
        files = {}
        try:
            if not args.no_corrections:
                files = sofer_corrections.book_ops(zp, title)
            if files:
                sofer_corrections.write_book_patch(corr_dir / f"{fs_name(title)}.json", title, files,
                                                   dates.get(title))
                n_corrected += 1
                n_ops += sum(len(v) for v in files.values())
            lines += build_search.build_book(zp, search_dir / f"{fs_name(title)}.txt", files)
        except (OSError, zipfile.BadZipFile, ValueError) as e:
            print(f"  ! {title}: {type(e).__name__}: {e}", flush=True)
        if i % 250 == 0 or i == len(titles):
            print(f"  [{i}/{len(titles)}] {lines:,} search lines, {n_ops} corrections "
                  f"in {n_corrected} books ({time.time() - t0:.0f}s)", flush=True)

    # 4. corrections.zip
    corrections_asset = None
    if corr_dir.is_dir() and any(corr_dir.iterdir()):
        path = release / "corrections.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for f in sorted(corr_dir.glob("*.json")):
                title = json.loads(f.read_text(encoding="utf-8"))["title"]
                z.write(f, arcname=f"_corrections/{title}.json")
        corrections_asset = asset(path, books=n_corrected, ops=n_ops)

    # 5. search shards and per-package indexes
    built = set(titles)
    shards = make_shards(packages, [t for t in all_titles if t in built])
    shard_out = {}
    for sid, shard in shards.items():
        parts = write_shard(sid, shard["titles"], search_dir, release, args.part_size)
        if not parts:
            continue
        shard_out[sid] = {
            "packages": shard["packages"],
            "books": len(shard["titles"]),
            # a book whose search file shows the shard is on the phone (after deletions too)
            "probe": next((t for t in shard["titles"]
                           if (search_dir / f"{fs_name(t)}.txt").is_file()
                           and (search_dir / f"{fs_name(t)}.txt").stat().st_size), None),
            "sefaria_last_updated": max((dates.get(t) or "") for t in shard["titles"]),
            "assets": [asset(p) for p in parts],
        }
        print(f"  shard {sid}: {len(shard['titles'])} books, "
              f"{sum(p.stat().st_size for p in parts) / 1e6:.1f} MB in {len(parts)} part(s)", flush=True)

    global_ids = {t: i for i, t in enumerate(sorted(built))}
    postings = build_search_index.collect_postings(work, [fs_name(t) for t in sorted(built)])
    package_out = {}
    for p in packages:
        name = p["en"]
        if name == "COMPLETE LIBRARY":
            pkg_titles = sorted(built)
            pkg_shards = sorted(shard_out)
        else:
            pkg_titles = [t for t in (p.get("indexes") or []) if t in built]
            pkg_shards = sorted(s for s, v in shard_out.items() if name in v["packages"])
        if not pkg_titles:
            continue
        local = [-1] * len(global_ids)
        for j, t in enumerate(pkg_titles):
            local[global_ids[t]] = j
        idx = release / f"index-{slug(name)}.idx"
        build_search_index.write_index(idx, pkg_titles, postings, local)
        package_out[name] = {
            "shards": pkg_shards,
            "books": len(pkg_titles),
            "index": asset(idx, file=f"{name}_search.idx"),
            "download_size": sum(a["size"] for s in pkg_shards for a in shard_out[s]["assets"])
                             + idx.stat().st_size,
        }

    # 6. manifest
    shutil.copyfile(core / "last_updated.json", release / "sefaria-last-updated.json")
    tag = args.tag or f"library-{datetime.now(timezone.utc):%Y-%m-%d}"
    manifest = {
        "format": MANIFEST_FORMAT,
        "tag": tag,
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "partial": partial,
        "sefaria": {
            "server": args.server,
            "schema_version": str(last_updated.get("schema_version")),
            "last_updated": max((dates.get(t) or "") for t in built),
            "last_updated_file": asset(release / "sefaria-last-updated.json"),
            "books": len(built),
        },
        "corrections": corrections_asset,
        "search": {"shards": shard_out, "packages": package_out},
    }
    (release / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1),
                                           encoding="utf-8")
    with (release / "SHA256SUMS.txt").open("w", encoding="utf-8", newline="\n") as fh:
        for f in sorted(release.iterdir()):
            if f.name != "SHA256SUMS.txt":
                fh.write(f"{sha256(f)}  {f.name}\n")
    total = sum(f.stat().st_size for f in release.iterdir())
    biggest = max(release.iterdir(), key=lambda f: f.stat().st_size)
    print(f"release {tag}: {len(list(release.iterdir()))} assets, {total / 1e6:.1f} MB "
          f"(largest {biggest.name} {biggest.stat().st_size / 1e6:.1f} MB) -> {release}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
