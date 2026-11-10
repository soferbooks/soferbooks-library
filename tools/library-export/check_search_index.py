"""Sanity-check a built offline search index.

The index must never miss a book that contains a query word, otherwise search
would silently hide results.  This reads random books, takes every word in
them, and checks that each of the word's trigrams lists the book.

Run:  python tools\\library-export\\check_search_index.py --export <dir> [--index <name>]
"""

from __future__ import annotations

import argparse
import random
import struct
from pathlib import Path

from build_search_index import WORD_RUN, normalize, text_hashes


def parse_index(path: Path):
    data = path.read_bytes()
    if data[:4] != b"SFI1":
        raise SystemExit(f"{path}: bad magic")
    off = 4
    (title_count,) = struct.unpack_from("<I", data, off)
    off += 4
    titles = []
    for _ in range(title_count):
        (length,) = struct.unpack_from("<H", data, off)
        off += 2
        titles.append(data[off:off + length].decode("utf-8"))
        off += length
    if len(set(titles)) != len(titles):
        raise SystemExit(f"{path}: duplicate titles")
    (entry_count,) = struct.unpack_from("<I", data, off)
    off += 4
    postings = {}
    last_hash = -1
    for _ in range(entry_count):
        h, count = struct.unpack_from("<HH", data, off)
        off += 4
        if h <= last_hash:
            raise SystemExit(f"{path}: entries are not sorted ({h} after {last_hash})")
        last_hash = h
        ids = struct.unpack_from(f"<{count}H", data, off)
        off += count * 2
        if any(i >= title_count for i in ids):
            raise SystemExit(f"{path}: posting id out of range")
        postings[h] = set(ids)
    if off != len(data):
        raise SystemExit(f"{path}: {len(data) - off} trailing bytes")
    return titles, postings


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", default=r"C:\Users\morde\Soferia\export-v7")
    ap.add_argument("--index", default="COMPLETE LIBRARY.idx")
    ap.add_argument("--books", type=int, default=100)
    args = ap.parse_args()

    out = Path(args.export)
    titles, postings = parse_index(out / "_index" / args.index)
    print(f"{args.index}: {len(titles)} titles, {len(postings)} trigrams")

    rng = random.Random(20261109)
    sample = rng.sample(titles, min(args.books, len(titles)))
    checked_words = 0
    checked_trigrams = 0
    title_id = {title: i for i, title in enumerate(titles)}

    for title in sample:
        path = out / "_search" / f"{title}.txt"
        if not path.is_file():
            continue
        book_id = title_id[title]
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                fields = line.rstrip("\n").split("\t")
                if len(fields) < 5:
                    continue
                for word in WORD_RUN.findall(normalize(fields[4])):
                    if len(word) < 3:
                        continue
                    checked_words += 1
                    for h in text_hashes(word):
                        checked_trigrams += 1
                        if book_id not in postings.get(h, ()):
                            raise SystemExit(
                                f"MISSING: {title!r} contains {word!r} "
                                f"but trigram {h} does not list it")
    print(f"checked {len(sample)} books, {checked_words} words, "
          f"{checked_trigrams} trigram memberships: OK")


if __name__ == "__main__":
    main()
