"""Which of Otzaria's books may be offered: extras/otzariaRules.json for the app.

The phone lists Otzaria's books from the library's own catalogue (extras/otzaria.js) before it
has downloaded any of them, so it cannot read a book's own notice ("personal study only",
"all rights reserved" ...) until the book is opened. This script reads every book once on the
PC with Sofer's own rule (sofer.importers.restricted) and the permissions Sofer records
(sofer.licenses.PERMISSIONS: Rav Yosef Peretz's books) and writes the result, a list of names
only, for the app to bundle. The phone checks each book again when it downloads it, so a book
added to Otzaria after this list was made is still checked.

    python tools\\library-export\\otzaria_rules.py                       # Sofer's copy of the release
    python tools\\library-export\\otzaria_rules.py --zip <otzaria_latest.zip>

Keys are "<Sofer's collection name>|<the book's Hebrew name>", the collection as the release's
SourcesBooks.csv names it (Ben-Yehuda, MoreBooks ...), as extras/otzaria.js COLLECTIONS does.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import zipfile
from pathlib import Path

SOFER_SRC = Path(r"C:\Users\morde\Sofer\src")
DEFAULT_ZIP = Path(r"C:\Users\morde\Sofer\data\otzaria\otzaria_latest.zip")
OUT = Path(__file__).resolve().parents[2] / "extras" / "otzariaRules.json"
SKIPPED = {"Dicta"}            # Otzaria's copies of Dicta's books belong to the Dicta source


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--zip", type=Path, default=DEFAULT_ZIP)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--sofer-data", type=Path, default=SOFER_SRC.parent / "data")
    args = ap.parse_args()
    sys.path.insert(0, str(SOFER_SRC))
    from sofer.importers import restricted, norm_title   # noqa: E402  (Sofer's own rules, reused)
    from sofer.licenses import PERMISSIONS          # noqa: E402

    restricted_keys, permitted, in_sefaria = [], {}, []
    sefaria_names = sefaria_hebrew_names(args.sofer_data)
    with zipfile.ZipFile(args.zip) as z:
        src_csv = next(n for n in z.namelist() if n.endswith("SourcesBooks.csv"))
        rows = list(csv.reader(io.StringIO(z.read(src_csv).decode("utf-8-sig"))))[1:]
        for name, path, source, _lines in rows:
            if source in SKIPPED:
                continue
            he = name[:-4] if name.endswith(".txt") else name
            try:
                text = z.read(path).decode("utf-8-sig", errors="replace")
            except KeyError:
                continue
            key = f"{source}|{he}"
            if norm_title(he) in sefaria_names:
                in_sefaria.append(key)
            # (licenses.permitted reads the notice at the start of the text)
            lic = next((lic for notice, lic in PERMISSIONS if notice.search(text[:5000])), None)
            if lic:
                permitted[key] = lic
            elif restricted(text):
                restricted_keys.append(key)
    provenance = args.zip.parent / "otzaria_release_provenance.json"
    release = None
    if provenance.exists():
        release = json.loads(provenance.read_text(encoding="utf-8")).get("tag")
    out = {"made_from": release or args.zip.name, "restricted": sorted(restricted_keys),
           "permitted": dict(sorted(permitted.items())), "in_sefaria": sorted(in_sefaria)}
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(restricted_keys)} restricted, {len(permitted)} permitted, {len(in_sefaria)} in Sefaria -> {args.out}")
    return 0


def sefaria_hebrew_names(sofer_data: Path) -> set:
    """The Hebrew names (and Hebrew other names) of Sefaria's books, as Sofer's importers.run
    counts them "in the library already" - from Sofer's copy of Sefaria's schemas, leaving out
    the books Sofer's own imports wrote. The phone's toc has each book's main Hebrew name only,
    so the other names come from here."""
    from sofer.importers import norm_title          # noqa: E402
    ours = set()
    manifest = sofer_data / "extra_import_manifest.json"
    if manifest.exists():
        for f in json.loads(manifest.read_text(encoding="utf-8"))["files"]:
            f = f.replace("\\", "/")
            if f.startswith("schemas/"):
                ours.add(f)
    names = set()
    for p in (sofer_data / "sefaria-export" / "schemas").glob("*.json"):
        if f"schemas/{p.name}" in ours:
            continue
        try:
            s = json.loads(p.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            continue
        if not isinstance(s, dict) or s.get("sofer_import") or s.get("sofer_split_of"):
            continue
        he = [s.get("heTitle") or ""]
        node = s.get("schema") or {}
        he += [t.get("text", "") for t in node.get("titles") or [] if re.search("[א-ת]", t.get("text", ""))]
        names.update(norm_title(n) for n in he if n)
    return names


if __name__ == "__main__":
    raise SystemExit(main())
