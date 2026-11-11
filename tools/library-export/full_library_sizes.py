"""How big each extra source's books are, for the "full library" download estimate.

Dicta's books.json, Otzaria's files_manifest.json and Wikisource's catalogue list no file sizes
(the Sofer Library's catalogue does), so the phone is given a small table, made here from the
files Sofer downloaded from the same servers (``C:\\Users\\morde\\Sofer\\data``, read only):

* otzaria     each book's text file, from Otzaria's release (``otzaria/otzaria_latest.zip``),
              by its Hebrew name (the catalogue's heTitle);
* dicta       each book's zip of pages and zip of pages with nikud (``dicta/files``,
              ``dicta/nikud``), by its fileName (the catalogue's id);
* wikisource  each book's pages as the site's API sent them (``wikisource/books``), by its page.

Sizes are kB.  ``ratios`` (the space a book takes on the phone after it is converted - its zip
and its search lines - for each byte downloaded) come from ``full_library_sizes.js``, which
converts sample books with the app's own code (``--samples`` writes them).  That script then
adds ``totals``: each source's books after the app's own choices (Sefaria's copies, licences,
the default content filter) with their download and phone sizes.

    python -I tools\\library-export\\full_library_sizes.py --samples C:\\tmp\\size-samples ^
        --sofer-release C:\\Users\\morde\\Soferia\\sofer-library-b\\release
    node -r @babel/register tools\\library-export\\full_library_sizes.js C:\\tmp\\size-samples
"""
from __future__ import annotations

import argparse
import json
import zipfile
from datetime import date
from pathlib import Path

SOFER_DATA = Path(r"C:\Users\morde\Sofer\data")
OUT = Path(__file__).resolve().parents[2] / "fullLibrarySizes.json"
SAMPLES = {"otzaria": 6, "dicta": 5, "wikisource": 4}


def kb(n: int) -> int:
    return max(1, round(n / 1024))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", default="", help="also write a few real books here, to measure the conversion")
    ap.add_argument("--sofer-release", default="", help="a Sofer Library release folder (samples of it too)")
    args = ap.parse_args()
    samples = Path(args.samples) if args.samples else None

    otzaria: dict[str, int] = {}
    with zipfile.ZipFile(SOFER_DATA / "otzaria" / "otzaria_latest.zip") as z:
        infos = [i for i in z.infolist() if i.filename.endswith(".txt") and "/אודות התוכנה/" not in i.filename]
        for i in infos:
            otzaria[Path(i.filename).stem] = kb(i.file_size)
        if samples:
            d = samples / "otzaria"
            d.mkdir(parents=True, exist_ok=True)
            picked = sorted(infos, key=lambda i: i.file_size)
            step = max(1, len(picked) // (SAMPLES["otzaria"] + 1))
            for i in picked[step::step][: SAMPLES["otzaria"]]:
                (d / f"{Path(i.filename).stem}.txt").write_bytes(z.read(i))

    dicta: dict[str, int] = {}
    for f in sorted((SOFER_DATA / "dicta" / "files").glob("*.zip")):
        n = f.stat().st_size
        nik = SOFER_DATA / "dicta" / "nikud" / f.name
        if nik.is_file():
            n += nik.stat().st_size
        dicta[f.stem] = kb(n)
    if samples:
        d = samples / "dicta"
        d.mkdir(parents=True, exist_ok=True)
        files = sorted((SOFER_DATA / "dicta" / "files").glob("*.zip"), key=lambda f: f.stat().st_size)
        step = max(1, len(files) // (SAMPLES["dicta"] + 1))
        for f in files[step::step][: SAMPLES["dicta"]]:
            doc = {"fileName": f.stem, "download": f.stat().st_size}
            for kind, path in (("pages", f), ("nikud", SOFER_DATA / "dicta" / "nikud" / f.name)):
                if path.is_file():
                    with zipfile.ZipFile(path) as z:
                        names = sorted(n for n in z.namelist() if n.endswith(".txt"))
                        doc[kind] = [z.read(n).decode("utf-8-sig") for n in names]
                    if kind == "nikud":
                        doc["download"] += path.stat().st_size
            (d / f"{f.stem}.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")

    wikisource: dict[str, int] = {}
    books = sorted((SOFER_DATA / "wikisource" / "books").glob("*.json"), key=lambda f: f.stat().st_size)
    for f in books:
        try:
            title = json.loads(f.read_text(encoding="utf-8")).get("title") or f.stem
        except ValueError:
            continue
        wikisource[title] = kb(f.stat().st_size)
    if samples:
        d = samples / "wikisource"
        d.mkdir(parents=True, exist_ok=True)
        step = max(1, len(books) // (SAMPLES["wikisource"] + 1))
        for f in books[step::step][: SAMPLES["wikisource"]]:
            (d / f.name).write_bytes(f.read_bytes())

    if samples and args.sofer_release:
        # (Sofer Library books come ready made: their files, to measure the search lines added)
        d = samples / "sofer_library"
        d.mkdir(parents=True, exist_ok=True)
        rel = Path(args.sofer_release)
        cat = json.loads((rel / "sofer-library-catalog.json").read_text(encoding="utf-8"))
        books = sorted(cat["books"], key=lambda b: b["size"])
        step = max(1, len(books) // 5)
        for b in books[step::step][:4]:
            with zipfile.ZipFile(rel / b["file"]) as z:
                files = {n: json.loads(z.read(n)) for n in z.namelist()}
            (d / b["file"].replace(".zip", ".json")).write_text(
                json.dumps({"title": b["title"], "download": b["size"], "files": files}, ensure_ascii=False),
                encoding="utf-8")

    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.is_file() else {}
    OUT.write_text(json.dumps({
        "made": date.today().isoformat(),
        "unit": "kB",
        "ratios": old.get("ratios", {}),
        "totals": old.get("totals", {}),
        "otzaria": otzaria, "dicta": dicta, "wikisource": wikisource,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{OUT}: otzaria {len(otzaria)}, dicta {len(dicta)}, wikisource {len(wikisource)} books; "
          f"{OUT.stat().st_size / 1024:.0f} kB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
