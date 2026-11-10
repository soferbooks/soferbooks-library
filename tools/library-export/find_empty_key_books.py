"""Find books whose Sefaria version text stores a section under the empty key "".

Sefaria uses the key "" for a schema node with no name ("default": true).  An
older export of ours did not unwrap that envelope, so those sections were lost
(and a few books came out completely empty).  The raw JSON is scanned without
parsing it, which is much faster than walking the library through the exporter.

Writes one book title per line to empty-key-books.txt.
"""
import os
import re
import time

ROOT = r"C:\Users\morde\Sofer\data\sefaria-export\json"
OUT = r"C:\Users\morde\Soferia\empty-key-books.txt"
PAT = re.compile(rb'"":\s*[\[\{]')

def main():
    titles = set()
    files = 0
    hits = 0
    t0 = time.time()
    for dirpath, _dirnames, filenames in os.walk(ROOT):
        for fn in filenames:
            if not fn.endswith(".json"):
                continue
            p = os.path.join(dirpath, fn)
            try:
                with open(p, "rb") as fh:
                    b = fh.read()
            except OSError:
                continue
            files += 1
            if PAT.search(b):
                hits += 1
                titles.add(os.path.basename(os.path.dirname(dirpath)))
        if time.time() - t0 > 60:
            print(f"  ... {files} files, {hits} hits, {len(titles)} books, "
                  f"{time.time() - t0:.0f}s", flush=True)
            t0 = time.time()
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(sorted(titles)))
    print(f"files {files}, version files with empty-key text {hits}, books {len(titles)}",
          flush=True)


if __name__ == "__main__":
    main()
