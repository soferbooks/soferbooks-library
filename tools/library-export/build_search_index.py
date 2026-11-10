"""Build the per-package offline search index.

For every package (COMPLETE LIBRARY and each top-level category) this writes
`_index/<PACKAGE>.idx`, a compact trigram index over that package's
`_search/<Title>.txt` files.  The app uses it to skip books that cannot
contain a query word instead of reading every search file.

Format (little endian):

    b"SFI1"
    u32 title_count
    title_count * (u16 byte_length, UTF-8 title)
    u32 entry_count
    entry_count * (u16 trigram_hash, u16 posting_count, posting_count * u16 title_id)

Entries are sorted by hash and posting lists by title id, so the app can read
one u16 list per trigram and intersect lists.

Only trigrams made of word characters (ASCII letters/digits, Hebrew letters)
are stored: a query word never contains a space or punctuation, so trigrams
that cross a word boundary can never be looked up.  Text is normalized exactly
like the app normalizes a query: lower case, vowel points and Hebrew/ASCII
quote marks removed.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import time
from array import array
from pathlib import Path

MAGIC = b"SFI1"
NIQQUD = re.compile(r"[\u0591-\u05C7\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5]")
HEBREW_PUNCT = re.compile(r"[\u05F3\u05F4'\"]")
WORD_RUN = re.compile(r"[A-Za-z0-9\u05D0-\u05EA]+")
WORD_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    + "".join(chr(c) for c in range(0x05D0, 0x05EB))
)


def fnv3(tri: tuple[str, str, str]) -> int:
    h = 2166136261
    for ch in tri:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return (h ^ (h >> 16)) & 0xFFFF


def normalize(text: str) -> str:
    return HEBREW_PUNCT.sub("", NIQQUD.sub("", text.lower()))


def text_hashes(text: str) -> set[int]:
    """The distinct searchable trigrams of one segment's text."""
    hashes = set()
    for run in WORD_RUN.findall(normalize(text)):
        if len(run) < 3:
            continue
        for tri in zip(run, run[1:], run[2:]):
            hashes.add(fnv3(tri))
    return hashes


def collect_postings(out_dir: Path, titles: list[str]) -> list[array]:
    """hash -> sorted global title ids, read from the per-book search files."""
    postings = [array("H") for _ in range(65536)]
    search_dir = out_dir / "_search"
    total = len(titles)
    t0 = time.time()
    missing = 0
    for book_id, title in enumerate(titles):
        path = search_dir / f"{title}.txt"
        if not path.is_file():
            missing += 1
            continue
        seen: set[int] = set()
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                fields = line.rstrip("\n").split("\t")
                if len(fields) < 5:
                    continue
                seen |= text_hashes(fields[4])
        for h in seen:
            postings[h].append(book_id)
        if (book_id + 1) % 500 == 0:
            elapsed = time.time() - t0
            print(f"  {book_id + 1}/{total} books, {elapsed / 60:.1f} min", flush=True)
    if missing:
        print(f"  ! {missing} book(s) have no search file", flush=True)
    return postings


def write_index(path: Path, titles: list[str], postings: list[array],
                local_id: list[int]) -> int:
    """Write one package index.  `local_id[global_id]` is the package-local id."""
    entries = []
    for h in range(65536):
        post = postings[h]
        if not post:
            continue
        kept = array("H", (local_id[g] for g in post if local_id[g] >= 0))
        if kept:
            entries.append((h, kept))

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        fh.write(MAGIC)
        fh.write(struct.pack("<I", len(titles)))
        for title in titles:
            data = title.encode("utf-8")
            fh.write(struct.pack("<H", len(data)))
            fh.write(data)
        fh.write(struct.pack("<I", len(entries)))
        for h, kept in entries:
            fh.write(struct.pack("<HH", h, len(kept)))
            fh.write(kept.tobytes())
    return path.stat().st_size


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", default=r"C:\Users\morde\Soferia\export-v7")
    ap.add_argument("--packages", default="",
                    help="comma separated package names; empty = all")
    ap.add_argument("--only-complete", action="store_true",
                    help="only rebuild COMPLETE LIBRARY")
    args = ap.parse_args()

    out_dir = Path(args.export)
    packages = json.loads((out_dir / "packages.json").read_text(encoding="utf-8"))
    all_titles = sorted(p.stem for p in out_dir.glob("*.zip"))
    global_id = {title: i for i, title in enumerate(all_titles)}

    wanted = {p.strip() for p in args.packages.split(",") if p.strip()}
    if args.only_complete:
        wanted = {"COMPLETE LIBRARY"}
    if wanted:
        packages = [p for p in packages if p["en"] in wanted]

    print(f"Indexing {len(all_titles)} books ...", flush=True)
    postings = collect_postings(out_dir, all_titles)

    sizes = {}
    sizes_path = out_dir / "_index" / "sizes.json"
    if sizes_path.is_file():
        sizes = json.loads(sizes_path.read_text(encoding="utf-8"))

    for package in packages:
        name = package["en"]
        if name == "COMPLETE LIBRARY":
            titles = all_titles
            local_id = list(range(len(all_titles)))
        else:
            titles = [t for t in (package.get("indexes") or []) if t in global_id]
            local_id = [-1] * len(all_titles)
            for local, title in enumerate(titles):
                local_id[global_id[title]] = local
        if not titles:
            continue
        print(f"  {name}: {len(titles)} books ...", flush=True)
        size = write_index(out_dir / "_index" / f"{name}.idx", titles, postings, local_id)
        sizes[name] = size
        print(f"  {name}: {size / 1e6:.1f} MB", flush=True)

    sizes_path.parent.mkdir(parents=True, exist_ok=True)
    sizes_path.write_text(json.dumps(sizes, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"index sizes -> {sizes_path}", flush=True)


if __name__ == "__main__":
    main()
