import re
import time
from pathlib import Path

NIQQUD = re.compile(r"[\u0591-\u05C7\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5]")
HEBREW_PUNCT = re.compile(r"[\u05F3\u05F4'\"]")
WORD_RUN = re.compile(r"[A-Za-z0-9\u05D0-\u05EA]+")


def fnv3(a, b, c):
    h = 2166136261
    for ch in (a, b, c):
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return (h ^ (h >> 16)) & 0xFFFF


def line_hashes(text):
    norm = HEBREW_PUNCT.sub("", NIQQUD.sub("", text.lower()))
    hashes = set()
    for run in WORD_RUN.findall(norm):
        if len(run) < 3:
            continue
        for tri in zip(run, run[1:], run[2:]):
            hashes.add(fnv3(*tri))
    return hashes


p = Path(r"C:\Users\morde\Soferia\export-v7\_search\דור המלקטים על אורח חיים.txt")
t0 = time.time()
seen = set()
n_lines = 0
with p.open(encoding="utf-8") as f:
    for line in f:
        n_lines += 1
        fields = line.rstrip("\n").split("\t")
        if len(fields) < 5:
            continue
        seen |= line_hashes(fields[4])
dt = time.time() - t0
size = p.stat().st_size
print(f"{size/1e6:.1f} MB, {n_lines} lines, {len(seen)} trigrams, {dt:.1f}s -> {size/1e6/dt:.1f} MB/s")
print(f"extrapolated 6.5 GB: {6500/(size/1e6/dt)/60:.0f} min")
